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
import { pauseFrom, type PauseState } from "./pacing.js";
import type { CampaignBible } from "../domain/campaign.js";
import {
  initCursor,
  completeCurrent,
  discoverLead,
  type MilestoneCursorState,
} from "./milestone-cursor.js";
import { initClock, tick, dmView, playerSignal, type WorldClockState } from "./world-clock.js";

/** True when prose is empty or only whitespace — nothing worth posting (#51). */
function isBlank(prose: string): boolean {
  return prose.trim().length === 0;
}

/** Stable key for a player's check intent (#54): one entry per actor+skill. */
function intentKey(actor: ActorId, skill: string): string {
  return `${actor}::${skill}`;
}

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
  /**
   * Resolves the NpcPort that drives a given actor (#51 修共脑 Bug1). Each AI
   * teammate is its OWN agent — its own persona, its own horizon — so the engine
   * looks the port up per actor instead of holding one shared `npc`. Returns
   * undefined when the actor has no agent backing (→ the slot passes). This seam
   * is what locks "绝不共脑": two teammates can never collapse onto one brain.
   */
  readonly npcFor?: (actor: ActorId) => NpcPort | undefined;
  /** Inbound side for awaited humans; `undefined` poll = silence (ADR-0003). */
  readonly humanInbox?: HumanInboxPort;
  /** Who is human vs AI (ADR-0003). Unknown actors default to AI. */
  readonly roster?: Roster;
  /**
   * The non-DM actors at the table this session (#52). `nominate` resets each
   * round's `remaining` to this set, so the round invariants (only nominate a
   * present actor, full coverage before a new round) have an authoritative roster
   * to check against. When omitted, the round roster falls back to scene
   * membership. The AIDM is never included.
   */
  readonly presentActors?: readonly ActorId[];
  /** Soul→controller bindings (ADR-0006); supersedes `roster` and adds `inert`. */
  readonly controllers?: ControllerRegistry;
  /** The dice/judge authority — resolves called checks (ADR-0001 修订, v1 = NativeDice). */
  readonly dice?: DicePort;
  /**
   * Resolve which present actors a piece of prose @-mentions (#57 协商通道). When
   * an actor's post mentions a teammate, the engine queues that post as a directed
   * `<extraInstruction>` for the teammate (injected when it is next nominated),
   * while the post itself stays in the shared record (方案 R). Returns the
   * mentioned actors (excluding the speaker). Omit → no coordination channel.
   */
  readonly mentionsOf?: (prose: string, speaker: ActorId) => readonly ActorId[];
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
 * The result of one `nominate` call (#52, 串行点名). Every variant carries the
 * round's remaining (not-yet-nominated) actors so the DM always knows who is
 * left this round — and, except when held/rejected, the nominated actor's actual
 * this-beat result, so the DM SEES what happened (修 Bug2「失明」) and can decide
 * whether to 喊检定 / how to point next.
 */
export type NominateResult =
  /** Nomination refused by the round invariant (点重复 / 点不在场). State unchanged. */
  | {
      readonly kind: "rejected";
      readonly reason: string;
      readonly remaining: readonly ActorId[];
      readonly dmText: string;
    }
  /** A silent human (真人无限期等 = 暂停/存档). The slot stays open for resume. */
  | {
      readonly kind: "held";
      readonly actor: ActorId;
      readonly pause: PauseState;
      readonly remaining: readonly ActorId[];
      readonly dmText: string;
    }
  /** The actor contributed prose. */
  | {
      readonly kind: "acted";
      readonly actor: ActorId;
      readonly prose: string;
      readonly remaining: readonly ActorId[];
      readonly dmText: string;
    }
  /** The actor passed (explicit pass / wake-gated / blank / agent had nothing). */
  | {
      readonly kind: "passed";
      readonly actor: ActorId;
      readonly remaining: readonly ActorId[];
      readonly dmText: string;
    }
  /** The actor rolled a check the AIDM had called; the dice authority resolved it. */
  | {
      readonly kind: "checked";
      readonly actor: ActorId;
      readonly skill: string;
      readonly total: number;
      readonly success: boolean;
      readonly detail: string;
      readonly remaining: readonly ActorId[];
      readonly dmText: string;
    };

/** A {@link NominateResult} variant before the engine renders its `dmText`. */
type NominateOutcome = NominateResult extends infer T
  ? T extends { dmText: string }
    ? Omit<T, "dmText">
    : never
  : never;

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
  /**
   * Checks a PLAYER explicitly requested but the DM has not yet answered (#54,
   * 检定硬请求地板). Keyed by `actor::skill` so a repeat request is idempotent and
   * different skills accumulate. The DM cannot silently drop these: they are
   * surfaced on every `nominate` until the DM answers with `call_check` (which
   * sets the DC and clears the matching intent). This is the floor that stops
   * 「我明确要检定却被无视」.
   */
  private readonly checkIntents = new Map<string, { actor: ActorId; skill: string }>();
  /** Per-branch milestone cursor (ADR-0007), or null when no campaign is loaded. */
  private cursor: MilestoneCursorState | null = null;
  /** The campaign's world clocks, keyed by id; advanced via `advanceClock`. */
  private readonly clocks = new Map<string, WorldClockState>();
  /** The last barrier hold state, updated on every held `await_actors`. */
  private lastPause: PauseState | null = null;
  /**
   * This round's not-yet-nominated actors (#52). `null` until the first
   * `nominate` of a round starts it; emptied as actors are nominated; reset to
   * the full round roster when the next `nominate` opens a fresh round. This is
   * the engine invariant that backs serial 点名: 全员必覆盖才进下一轮、不重复点。
   */
  private roundRemaining: Set<ActorId> | null = null;
  /**
   * Directed instructions queued per actor by teammates who @-mentioned it (#57).
   * Filled when a post mentions someone (via `deps.mentionsOf`); drained into the
   * actor's TurnContext when it is next pulled up, then cleared (consumed once).
   */
  private readonly injections = new Map<ActorId, string[]>();

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
  async callCheck(
    actor: ActorId,
    skill: string,
    difficulty?: string,
    mode?: "check" | "attack",
  ): Promise<void> {
    this.pendingChecks.set(actor, {
      actor,
      skill,
      ...(difficulty !== undefined && { difficulty }),
      ...(mode !== undefined && { mode }),
    });
    // The DM answered a player's hard request (if any) — clear that intent (#54).
    this.checkIntents.delete(intentKey(actor, skill));
  }

  /**
   * `requestCheck` — a PLAYER explicitly requests a check that does not yet exist
   * (#54, e.g. `/check 侦查` with nothing pending). The engine registers it as a
   * pending intent which it then forces in front of the DM (via `nominate`) until
   * answered. The DM still sets the DC (this does NOT auto-resolve anything); it
   * only guarantees the request is not silently ignored. Idempotent per actor+skill.
   */
  requestCheck(actor: ActorId, skill: string): void {
    this.checkIntents.set(intentKey(actor, skill), { actor, skill });
  }

  /** The player-requested checks the DM has not yet answered (#54), in request
   *  order. Read-only — the `nominate` tool surfaces these so the DM can't drop them. */
  pendingIntents(): readonly { actor: ActorId; skill: string }[] {
    return [...this.checkIntents.values()].map((i) => ({ ...i }));
  }

  /**
   * The pending check the AIDM 喊'd on an actor (if any), or undefined. Read-only
   * inspection — the `/check` slash handler uses it to tell whether the invoker
   * has anything to roll before injecting a roll turn (ADR-0013). Pure, no I/O.
   */
  pendingCheckFor(actor: ActorId): CheckCall | undefined {
    const pending = this.pendingChecks.get(actor);
    return pending ? { ...pending } : undefined;
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
   * With a matching pending and a dice port: consume the pending, build the full
   * {@link RollRequest} — merging the pending check's WHAT (skill/difficulty/mode,
   * declared by the AIDM via `call_check`) with the roll turn's HOW (`advantage`,
   * declared by the rolling actor) — resolve via the dice authority, post the
   * structured detail as that actor, emit `check-resolved`. No own pending (or no
   * dice port) → there is nothing to roll; it stays a pass.
   */
  private async resolveRoll(
    scene: SceneId,
    actor: ActorId,
    events: AwaitEvent[],
    advantage?: "advantage" | "disadvantage",
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
      ...(pending.mode !== undefined && { mode: pending.mode }),
      ...(advantage !== undefined && { advantage }),
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

  /**
   * `nominate` — DM-only tool (#52, 改写 ADR-0003 节奏：平行涌现 → 串行点名).
   * The AIDM points at ONE actor with an in-fiction cue (`desc`) and the engine
   * blocks that single slot until the actor acts / passes / rolls (or, for a
   * silent human, holds indefinitely = 暂停). It returns the actor's actual
   * result + the round's remaining actors, so the DM sees each beat as it happens
   * and never goes blind (修 Bug2).
   *
   * Round invariants the engine enforces (so the DM can't miscount): the round's
   * `remaining` starts as the full present roster; only an actor still in
   * `remaining` may be nominated (点重复/点不在场 → rejected); the round is over
   * when `remaining` empties; the next `nominate` after that opens a fresh round
   * (remaining reset to 全员). 后手看前手 is automatic: each acted post is recorded
   * immediately, so the next nominee's horizon already includes it.
   */
  async nominate(scene: SceneId, actor: ActorId, desc?: string): Promise<NominateResult> {
    // Open a fresh round if none is running or the previous one is complete.
    if (this.roundRemaining === null || this.roundRemaining.size === 0) {
      this.roundRemaining = new Set(this.roundRoster(scene));
    }

    if (!this.roundRemaining.has(actor)) {
      const reason = this.roundRoster(scene).includes(actor)
        ? `${actor} 本轮已行动，不能重复点名`
        : `${actor} 不在场，无法点名`;
      return this.receipt({ kind: "rejected", reason, remaining: [...this.roundRemaining] });
    }

    // Post the in-fiction point cue (drama, + the @mention in production) before
    // pulling the actor up, so the nominee's horizon includes it (后手看前手). The
    // nominee is tagged in `mentions` so the substrate @-pings the real player (#56).
    if (desc !== undefined && !isBlank(desc)) {
      await this.post(scene, this.deps.aidmId, desc, [actor]);
    }

    const events: AwaitEvent[] = [];
    const drive = this.driveOf(actor);
    const result =
      drive === "inert"
        ? ({ kind: "passed" } as SlotResult)
        : drive === "human"
          ? await this.resolveHuman(scene, actor, events)
          : await this.resolveAi(scene, actor, events);

    // Silent human → infinite hold (= 暂停/存档). The slot stays open: the actor
    // is NOT removed from remaining so a resume re-points the same person.
    if (result.kind === "silent") {
      const pause = pauseFrom(scene, this.deps.aidmId, [actor], new Map([[actor, "silent"]]));
      this.lastPause = pause;
      return this.receipt({ kind: "held", actor, pause, remaining: [...this.roundRemaining] });
    }

    // Acted/passed/rolled → the actor is done this round.
    this.roundRemaining.delete(actor);
    const remaining = [...this.roundRemaining];

    const resolved = events.find((e) => e.kind === "check-resolved");
    if (resolved && resolved.kind === "check-resolved") {
      return this.receipt({
        kind: "checked",
        actor,
        skill: resolved.skill,
        total: resolved.total,
        success: resolved.success,
        detail: resolved.detail,
        remaining,
      });
    }
    if (result.kind === "acted") {
      return this.receipt({ kind: "acted", actor, prose: result.post.prose, remaining });
    }
    return this.receipt({ kind: "passed", actor, remaining });
  }

  /**
   * Render the DM-facing beat receipt for a nominate outcome (arch-C3). The
   * DM's view of the engine — this-beat result, 本轮还剩谁, and the #54 floor
   * (any player-requested check the DM hasn't answered rides EVERY receipt, so
   * it cannot be silently dropped) — is rendered HERE, inside the engine's
   * test surface, not re-invented per DM front-end (MCP adapter, scripts…).
   */
  private receipt(outcome: NominateOutcome): NominateResult {
    const left =
      outcome.remaining.length > 0
        ? `还剩：${outcome.remaining.join("、")}`
        : "本轮已全部点完";
    let text: string;
    switch (outcome.kind) {
      case "rejected":
        text = `点名被拒：${outcome.reason}。${left}`;
        break;
      case "held":
        text = `${outcome.actor} 沉默（真人未回应）→ 屏障挂起=暂停/存档；轮到他时仍等他。`;
        break;
      case "acted":
        text = `${outcome.actor}：${outcome.prose}\n${left}`;
        break;
      case "passed":
        text = `${outcome.actor} 过（没有要说/做的）。${left}`;
        break;
      case "checked":
        text = `${outcome.actor} 掷 ${outcome.skill}：${outcome.detail}（${outcome.success ? "成功" : "失败"}，total=${outcome.total}）\n${left}`;
        break;
    }
    // #54 检定硬请求地板：把玩家显式请求、DM 还没回应的检定顶到眼前，不可静默丢弃。
    const intents = this.pendingIntents();
    if (intents.length > 0) {
      const lines = intents.map((i) => `${i.actor} 请求「${i.skill}」`).join("；");
      text += `\n⚠ 待你回应的玩家检定请求（你来定 DC，别忽略）：${lines}`;
    }
    return { ...outcome, dmText: text };
  }

  /** The full set of non-DM actors a `nominate` round covers: the configured
   *  present roster (#52), falling back to scene membership when unset. */
  private roundRoster(scene: SceneId): readonly ActorId[] {
    if (this.deps.presentActors) return this.deps.presentActors;
    return [...this.scenes.membersOf(scene)].filter((a) => a !== this.deps.aidmId);
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
      return this.resolveRoll(scene, actor, events, turn.advantage);
    }
    if (isBlank(turn.prose)) {
      // 空 prose 守卫 (#51, 修 Bug4): a blank human turn is a pass, not a post.
      events.push({ kind: "actor-passed", actorId: actor });
      return { kind: "passed" };
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
    const npc = this.deps.npcFor?.(actor);
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
    if (turn.kind === "pass" || isBlank(turn.prose)) {
      // 空 prose 守卫 (#51, 修 Bug4): empty/whitespace prose never reaches the
      // substrate (which rejects "Cannot send an empty message") — it is a pass.
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
    // #57: drain any directed instructions queued for this actor (consume once).
    const pending = this.injections.get(actor);
    if (pending !== undefined && pending.length > 0) this.injections.delete(actor);
    return {
      sceneId: scene,
      actorId: actor,
      transcript,
      ...(pending !== undefined && pending.length > 0 && { extraInstructions: pending }),
    };
  }

  private async post(
    scene: SceneId,
    actor: ActorId,
    prose: string,
    mentions?: readonly ActorId[],
  ): Promise<Post> {
    const post: Post = {
      sceneId: scene,
      actorId: actor,
      prose,
      ...(mentions !== undefined && mentions.length > 0 && { mentions }),
    };
    this.scenes.record(post);
    await this.deps.substrate.emit(post);
    // #57 协商通道: a teammate's post that @-mentions another present actor queues
    // a directed instruction for them (injected when they're next nominated). The
    // DM's own narration/cue is exempt (it's not a teammate request).
    if (actor !== this.deps.aidmId && this.deps.mentionsOf) {
      for (const target of this.deps.mentionsOf(prose, actor)) {
        if (target !== actor) this.queueInstruction(target, `${actor} 对你说：${prose}`);
      }
    }
    return post;
  }

  /**
   * Queue a directed instruction for an actor (#57 协商通道). Called by the engine
   * when a teammate @-mentions someone, and by the live gateway when a PLAYER
   * @-mentions a bot. Held until the actor is next nominated, then injected into
   * its prompt as `<extraInstruction>` and consumed.
   */
  queueInstruction(target: ActorId, text: string): void {
    const q = this.injections.get(target) ?? [];
    q.push(text);
    this.injections.set(target, q);
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
