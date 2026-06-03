import { actorId as brandActor, type ActorId, type SceneId } from "../domain/ids.js";
import type { Post } from "../domain/post.js";
import type { TurnContext, CheckCall } from "../domain/agent.js";
import type { SubstratePort } from "../ports/substrate.js";
import type { NpcPort } from "../ports/npc.js";
import type { HumanInboxPort } from "../ports/human-inbox.js";
import type { DicePort } from "../ports/dice.js";
import type { CardStore, CharacterSheet } from "../ports/card-store.js";
import { SceneBook } from "./scenes.js";
import type { Roster, ActorKind } from "./roster.js";
import type { ControllerRegistry } from "./controller.js";
import { runCombatRound, type SlotResult } from "./combat-round.js";
import type { PauseState } from "./pacing.js";
import type { CampaignBible } from "../domain/campaign.js";
import {
  initCursor,
  completeCurrent,
  discoverLead,
  type MilestoneCursorState,
} from "./milestone-cursor.js";
import { initClock, tick, dmView, playerSignal, type WorldClockState } from "./world-clock.js";

/**
 * Referee — the engine's shared state + the tool handlers the DM/NPC agents
 * call (ADR-0009). The control flow is half-inverted: the DM is a self-driving
 * Agent-SDK loop that calls these tools to push the table; the engine no longer
 * directs a beat, it only referees the invariants (visibility / sole-writer /
 * pacing) and, on `await_actors`, paces a simplified combat round that pulls up
 * the NPCs itself.
 *
 * Purity (CI guard): this module lives under the engine and therefore imports
 * only ports + pure kernels — never the Agent SDK or a concrete substrate. The
 * MCP wrapping lives in the agent-sdk adapter layer, one ring out.
 */
export interface RefereeDeps {
  /** The AIDM — the sole narrator and authoritative-state writer (ADR-0002). */
  readonly aidmId: ActorId;
  /** Where narrated/spoken posts surface (Discord in #4, in-memory in tests). */
  readonly substrate: SubstratePort;
  /** Initial scene membership (sceneId → actor ids); the AIDM grows/shrinks it. */
  readonly scenes?: Record<string, readonly string[]>;
  /** Drives NPCs the engine pulls up in `await_actors`. */
  readonly npc?: NpcPort;
  /** Inbound side for awaited humans; `undefined` poll = silence (ADR-0003). */
  readonly humanInbox?: HumanInboxPort;
  /** Who is human vs AI (ADR-0003). Unknown actors default to AI. */
  readonly roster?: Roster;
  /** Soul→controller bindings (ADR-0006); supersedes `roster` and adds `inert`. */
  readonly controllers?: ControllerRegistry;
  /** The dice/judge authority — resolves called checks (ADR-0001 修订, v1 = NativeDice). */
  readonly dice?: DicePort;
  /** Read-only mechanical sheets — the DM reads via `read_card` (ADR-0001/0002). */
  readonly cards?: CardStore;
  /** The plot spine (ADR-0007). When present, the referee tracks a per-branch
   *  milestone cursor and the campaign's world clocks. */
  readonly campaign?: CampaignBible;
}

/** Observable authoritative pacing transitions of an awaited round (ADR-0003). */
export type AwaitEvent =
  | { readonly kind: "barrier-opened"; readonly waiting: readonly ActorId[] }
  | { readonly kind: "actor-acted"; readonly actorId: ActorId }
  | { readonly kind: "actor-passed"; readonly actorId: ActorId }
  | { readonly kind: "actor-gated"; readonly actorId: ActorId }
  | { readonly kind: "actor-inert"; readonly actorId: ActorId }
  | { readonly kind: "actor-silent"; readonly actorId: ActorId }
  | { readonly kind: "barrier-released" }
  | { readonly kind: "beat-held" }
  | { readonly kind: "check-called"; readonly actorId: ActorId; readonly skill: string; readonly difficulty?: string }
  | {
      readonly kind: "check-resolved";
      readonly actorId: ActorId;
      readonly skill: string;
      readonly total: number;
      readonly success: boolean;
      readonly detail: string;
    };

/**
 * The result of `await_actors`. `released` means every awaited actor acted or
 * explicitly passed and the tool returns to the DM. `held` means a silent human
 * — the round overflowed and the barrier holds indefinitely; in the real Agent
 * SDK the tool call simply never returns. The `pause` IS the save state.
 */
export type AwaitOutcome =
  | { readonly status: "released"; readonly posts: readonly Post[]; readonly events: readonly AwaitEvent[] }
  | { readonly status: "held"; readonly pause: PauseState; readonly events: readonly AwaitEvent[] };

/**
 * A fully serializable snapshot of a Referee's playable state at one beat.
 *
 * ADR-0003: an indefinite hold IS the pause/save state. This object captures
 * everything needed to rebuild a Referee that can continue from the same beat
 * after a process restart. It is intentionally a plain record — no methods,
 * JSON-round-trippable, storable to `data/campaigns/<id>/pause.json`.
 *
 * Fields captured:
 * - `aidmId`         — the configured AIDM actor (informational; restore callers
 *                      pass it back via `RefereeDeps`).
 * - `sceneMembership`— every scene → member list (visibility state).
 * - `sceneLog`       — the full ordered post log (the omniscient record).
 * - `pendingChecks`  — checks the DM called but no one has rolled yet.
 * - `cursor`         — milestone cursor (null when no campaign loaded).
 * - `clocks`         — world clock states (position + spec).
 * - `pauseState`     — the last barrier hold state (null when not paused).
 */
export interface RefereeSnapshot {
  readonly aidmId: ActorId;
  readonly sceneMembership: Record<string, readonly ActorId[]>;
  readonly sceneLog: readonly import("../domain/post.js").Post[];
  readonly pendingChecks: readonly CheckCall[];
  readonly cursor: MilestoneCursorState | null;
  readonly clocks: readonly WorldClockState[];
  readonly pauseState: PauseState | null;
}

export class Referee {
  private readonly scenes = new SceneBook();
  /** Scene-scoped visibility is active once any membership is configured. Until
   *  then the engine is single-scene / all-visible (the walking-skeleton mode). */
  private scoped: boolean;
  /** Checks the DM has called (喊检定) but no one has rolled yet, keyed by the
   *  actor who must roll. An actor may only resolve ITS OWN pending entry. */
  private readonly pendingChecks = new Map<ActorId, CheckCall>();
  /** Per-branch milestone cursor (ADR-0007), or null when no campaign is loaded. */
  private cursor: MilestoneCursorState | null = null;
  /** The campaign's world clocks, keyed by id; advanced via `advanceClock`. */
  private readonly clocks = new Map<string, WorldClockState>();
  /** The last barrier hold state, updated on every held `await_actors`. */
  private lastPause: PauseState | null = null;

  constructor(private readonly deps: RefereeDeps) {
    const config = deps.scenes ?? {};
    this.scoped = Object.keys(config).length > 0;
    for (const [scene, members] of Object.entries(config)) {
      for (const member of members) {
        this.scenes.addMember(scene as SceneId, brandActor(member));
      }
    }
    if (deps.campaign) {
      this.cursor = initCursor(deps.campaign);
      for (const spec of deps.campaign.worldClocks) {
        this.clocks.set(spec.id, initClock(spec));
      }
    }
  }

  /**
   * Capture the full playable state as a plain, JSON-serializable snapshot.
   * No I/O — pure extraction from in-memory state. Suitable for persisting to
   * `data/campaigns/<id>/pause.json` via the file-store adapter layer.
   */
  snapshot(): RefereeSnapshot {
    return {
      aidmId: this.deps.aidmId,
      sceneMembership: this.scenes.membershipSnapshot(),
      sceneLog: [...this.scenes.fullLog()],
      pendingChecks: [...this.pendingChecks.values()].map((c) => ({ ...c })),
      cursor: this.cursor ? { ...this.cursor } : null,
      clocks: [...this.clocks.values()].map((c) => ({ ...c })),
      pauseState: this.lastPause ? { ...this.lastPause } : null,
    };
  }

  /**
   * Rebuild a Referee from a previously captured snapshot (e.g. after process
   * restart). The caller supplies fresh I/O deps (substrate, humanInbox, npc,
   * etc.); only pure playable state is rehydrated from the snapshot. The
   * campaign dep is needed if cursor/clocks are to be meaningful; if omitted
   * the cursor and clocks are still restored from the snapshot's raw values.
   *
   * The returned Referee is ready to continue from the same beat — same scene
   * membership, same full log (horizon is correct), same pending checks.
   */
  static restore(deps: RefereeDeps, snap: RefereeSnapshot): Referee {
    // Omit `scenes` entirely so the constructor's scene-init path is skipped;
    // we rebuild membership from the snapshot below. `exactOptionalPropertyTypes`
    // prohibits explicit `undefined`, so we destructure it out instead.
    const { scenes: _omit, ...depsWithoutScenes } = deps;
    const ref = new Referee(depsWithoutScenes);

    // Restore scene membership (skip the constructor's scenes config path —
    // we directly call addMember to mirror the exact saved membership).
    for (const [scene, members] of Object.entries(snap.sceneMembership)) {
      for (const member of members) {
        ref.scenes.addMember(scene as SceneId, member as ActorId);
      }
    }

    // If the snapshot had any scene membership, the referee is scene-scoped.
    if (Object.keys(snap.sceneMembership).length > 0) {
      ref.scoped = true;
    }

    // Restore the full scene log — every post in order, re-recorded into the
    // SceneBook so horizon() and fullLog() return the right results.
    for (const post of snap.sceneLog) {
      ref.scenes.record(post);
    }

    // Restore pending checks.
    for (const c of snap.pendingChecks) {
      ref.pendingChecks.set(c.actor, { ...c });
    }

    // Restore cursor and clocks (override what the constructor initialised from
    // the campaign dep — the snapshot's values are the authoritative runtime
    // state and may differ from initCursor/initClock defaults).
    ref.cursor = snap.cursor ? { ...snap.cursor } : null;
    ref.clocks.clear();
    for (const clock of snap.clocks) {
      ref.clocks.set(clock.id, { ...clock });
    }

    // Restore the last pause state.
    ref.lastPause = snap.pauseState ? { ...snap.pauseState } : null;

    return ref;
  }

  /**
   * `advance_milestone` — DM-only tool (ADR-0007/0009). The AIDM judges the
   * current load-bearing beat complete and the engine advances the cursor.
   */
  advanceMilestone(): void {
    if (this.cursor && this.deps.campaign) {
      this.cursor = completeCurrent(this.cursor, this.deps.campaign);
    }
  }

  /** `discover_lead` — DM-only tool. Records a breadcrumb on the cursor. */
  discoverLead(lead: string): void {
    if (this.cursor) this.cursor = discoverLead(this.cursor, lead);
  }

  /** `advance_clock` — DM-only tool. Ticks one named world clock (ADR-0007). */
  advanceClock(clockId: string): void {
    const clock = this.clocks.get(clockId);
    if (clock) this.clocks.set(clockId, tick(clock));
  }

  /** `add_member` — DM-only tool. Adds an actor to a scene (ADR-0005); its
   *  visibility horizon then includes that scene's posts. */
  addMember(scene: SceneId, actor: ActorId): void {
    this.scenes.addMember(scene, actor);
  }

  /** `remove_member` — DM-only tool. Removes an actor from a scene (ADR-0005);
   *  the scene's posts drop out of its horizon. */
  removeMember(scene: SceneId, actor: ActorId): void {
    this.scenes.removeMember(scene, actor);
  }

  /** The per-branch milestone cursor, or null if no campaign is loaded. */
  cursorState(): MilestoneCursorState | null {
    return this.cursor;
  }

  /** The omniscient (AIDM) view of a world clock — raw numbers — or null. */
  clockDmView(clockId: string): ReturnType<typeof dmView> | null {
    const clock = this.clocks.get(clockId);
    return clock ? dmView(clock) : null;
  }

  /** The player-facing signal of a world clock — a qualitative band only, never
   *  the raw number (ADR-0007) — or null if the clock is unknown. */
  clockPlayerSignal(clockId: string): ReturnType<typeof playerSignal> | null {
    const clock = this.clocks.get(clockId);
    return clock ? playerSignal(clock) : null;
  }

  /** An actor's visibility horizon — the posts in scenes it belongs to. */
  horizonOf(actor: ActorId): readonly Post[] {
    return this.scenes.horizon(actor);
  }

  /**
   * `narrate` — DM-only tool (ADR-0002/0009). The AIDM contributes narrative:
   * the post is recorded into the scene book (so visibility/horizon hold) and
   * emitted to the substrate. NPC agents have no `narrate` tool — pure-narrative
   * co-governance is enforced at the tool boundary, not by prompt etiquette.
   */
  async narrate(scene: SceneId, prose: string): Promise<void> {
    await this.post(scene, this.deps.aidmId, prose);
  }

  /**
   * `call_check` — DM-only tool (ADR-0001/0002). The AIDM 喊检定 on an actor but
   * does NOT roll: it registers a pending check keyed by the actor who must roll.
   * The actor resolves it later by emitting its own `roll` during `await_actors`.
   * A re-call on the same actor replaces the prior pending entry.
   */
  async callCheck(actor: ActorId, skill: string, difficulty?: string): Promise<void> {
    this.pendingChecks.set(actor, { actor, skill, ...(difficulty !== undefined && { difficulty }) });
  }

  /**
   * `read_card` — DM-only, READ-ONLY view of an actor's mechanical sheet
   * (ADR-0001/0002). There is deliberately no companion write: the dice
   * authority (NativeDice in v1) is the sole writer of the sheet.
   */
  readCard(actor: ActorId): CharacterSheet | undefined {
    return this.deps.cards?.read(actor);
  }

  /**
   * Resolve an actor's `roll` against ITS OWN pending check (后手只能掷自己的).
   * With a matching pending and a dice port: consume the pending, resolve via the
   * dice authority, post the structured detail as that actor, emit `check-resolved`.
   * No own pending (or no dice port) → there is nothing to roll; it stays a pass.
   */
  private async resolveRoll(
    scene: SceneId,
    actor: ActorId,
    events: AwaitEvent[],
  ): Promise<SlotResult> {
    const pending = this.pendingChecks.get(actor);
    if (!pending || !this.deps.dice) {
      events.push({ kind: "actor-passed", actorId: actor });
      return { kind: "passed" };
    }
    this.pendingChecks.delete(actor);
    const result = await this.deps.dice.roll({
      actorId: actor,
      skill: pending.skill,
      ...(pending.difficulty !== undefined && { difficulty: pending.difficulty }),
    });
    const post = await this.post(scene, actor, result.detail);
    events.push({
      kind: "check-resolved",
      actorId: actor,
      skill: result.skill,
      total: result.total,
      success: result.success,
      detail: result.detail,
    });
    return { kind: "acted", post };
  }

  /**
   * `await_actors` — DM-only tool (ADR-0009). Opens the barrier and paces one
   * simplified combat round (ADR-0003) over `order`: each actor is pulled up in
   * turn — AIs via the wake-gate then a single out-turn, humans via the inbox —
   * with later actors seeing earlier actors' just-made posts (后手看前手). All
   * acted/passed → released; a silent human → the round overflows to completion
   * then holds, yielding a serializable pause.
   */
  async awaitActors(scene: SceneId, order: readonly ActorId[]): Promise<AwaitOutcome> {
    const events: AwaitEvent[] = [{ kind: "barrier-opened", waiting: [...order] }];

    const produce = async (actor: ActorId): Promise<SlotResult> => {
      const drive = this.driveOf(actor);
      if (drive === "inert") {
        events.push({ kind: "actor-inert", actorId: actor });
        return { kind: "passed" };
      }
      if (drive === "human") return this.resolveHuman(scene, actor, events);
      return this.resolveAi(scene, actor, events);
    };

    const round = await runCombatRound(scene, this.deps.aidmId, order, (actor) => produce(actor));

    if (round.status === "held") {
      events.push({ kind: "beat-held" });
      this.lastPause = round.pause ?? null;
      return { status: "held", pause: round.pause!, events };
    }
    events.push({ kind: "barrier-released" });
    return { status: "released", posts: round.posts, events };
  }

  private async resolveHuman(
    scene: SceneId,
    actor: ActorId,
    events: AwaitEvent[],
  ): Promise<SlotResult> {
    const turn = this.deps.humanInbox ? await this.deps.humanInbox.poll(actor, scene) : undefined;
    if (turn === undefined) {
      events.push({ kind: "actor-silent", actorId: actor });
      return { kind: "silent" };
    }
    if (turn.kind === "pass") {
      events.push({ kind: "actor-passed", actorId: actor });
      return { kind: "passed" };
    }
    if (turn.kind === "roll") {
      return this.resolveRoll(scene, actor, events);
    }
    const post = await this.post(scene, actor, turn.prose);
    events.push({ kind: "actor-acted", actorId: actor });
    return { kind: "acted", post };
  }

  private async resolveAi(
    scene: SceneId,
    actor: ActorId,
    events: AwaitEvent[],
  ): Promise<SlotResult> {
    const npc = this.deps.npc;
    if (!npc) {
      events.push({ kind: "actor-passed", actorId: actor });
      return { kind: "passed" };
    }
    // Cheap wake-gate first: only "speakers" pay for full generation.
    const willSpeak = npc.shouldSpeak ? await npc.shouldSpeak(this.ctx(scene, actor)) : true;
    if (!willSpeak) {
      events.push({ kind: "actor-gated", actorId: actor });
      return { kind: "passed" };
    }
    const turn = await npc.takeTurn(this.ctx(scene, actor));
    if (turn.kind === "roll") {
      return this.resolveRoll(scene, actor, events);
    }
    if (turn.kind === "pass") {
      events.push({ kind: "actor-passed", actorId: actor });
      return { kind: "passed" };
    }
    const post = await this.post(scene, actor, turn.prose);
    events.push({ kind: "actor-acted", actorId: actor });
    return { kind: "acted", post };
  }

  /** How an awaited actor is driven this round. Controllers (ADR-0006) supersede
   *  the static roster and add the `inert` ("别管我") drive. */
  private driveOf(actor: ActorId): "human" | "ai" | "inert" {
    if (this.deps.controllers) return this.deps.controllers.controllerOf(actor).kind;
    const kind: ActorKind = this.deps.roster ? this.deps.roster.kindOf(actor) : "ai";
    return kind;
  }

  /** What an NPC sees when pulled up: its scene horizon — which already includes
   *  earlier actors' posts made this round, since each acted post is recorded
   *  immediately (后手看前手, ADR-0003). */
  private ctx(scene: SceneId, actor: ActorId): TurnContext {
    const transcript = this.scoped ? this.scenes.horizon(actor) : [...this.scenes.fullLog()];
    return { sceneId: scene, actorId: actor, transcript };
  }

  private async post(scene: SceneId, actor: ActorId, prose: string): Promise<Post> {
    const post: Post = { sceneId: scene, actorId: actor, prose };
    this.scenes.record(post);
    await this.deps.substrate.emit(post);
    return post;
  }

  /** The omniscient (AIDM) view of the full record — for inspection / assertions. */
  fullLog(): readonly Post[] {
    return this.scenes.fullLog();
  }

  /** Canonical scene membership (for inspection / assertions). */
  membersOf(scene: SceneId): ActorId[] {
    return [...this.scenes.membersOf(scene)];
  }
}
