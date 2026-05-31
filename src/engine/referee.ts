import { actorId as brandActor, type ActorId, type SceneId } from "../domain/ids.js";
import type { Post } from "../domain/post.js";
import type { TurnContext, CheckCall } from "../domain/agent.js";
import type { SubstratePort } from "../ports/substrate.js";
import type { NpcPort } from "../ports/npc.js";
import type { HumanInboxPort } from "../ports/human-inbox.js";
import type { SealDicePort } from "../ports/sealdice.js";
import type { CardStore, CharacterSheet } from "../ports/card-store.js";
import { SceneBook } from "./scenes.js";
import type { Roster, ActorKind } from "./roster.js";
import type { ControllerRegistry } from "./controller.js";
import { runCombatRound, type SlotResult } from "./combat-round.js";
import type { PauseState } from "./pacing.js";

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
  readonly dice?: SealDicePort;
  /** Read-only mechanical sheets — the DM reads via `read_card` (ADR-0001/0002). */
  readonly cards?: CardStore;
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

export class Referee {
  private readonly scenes = new SceneBook();
  /** Scene-scoped visibility is active once any membership is configured. Until
   *  then the engine is single-scene / all-visible (the walking-skeleton mode). */
  private readonly scoped: boolean;
  /** Checks the DM has called (喊检定) but no one has rolled yet, keyed by the
   *  actor who must roll. An actor may only resolve ITS OWN pending entry. */
  private readonly pendingChecks = new Map<ActorId, CheckCall>();

  constructor(private readonly deps: RefereeDeps) {
    const config = deps.scenes ?? {};
    this.scoped = Object.keys(config).length > 0;
    for (const [scene, members] of Object.entries(config)) {
      for (const member of members) {
        this.scenes.addMember(scene as SceneId, brandActor(member));
      }
    }
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
