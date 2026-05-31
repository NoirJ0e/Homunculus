import { actorId as brandActor, type ActorId, type SceneId } from "../domain/ids.js";
import type { Post } from "../domain/post.js";
import type { TurnContext, SceneEffect } from "../domain/agent.js";
import type { AgentPort } from "../ports/agent.js";
import type { SubstratePort } from "../ports/substrate.js";
import type { SealDicePort } from "../ports/sealdice.js";
import type { HumanInboxPort } from "../ports/human-inbox.js";
import type { Roster, ActorKind } from "./roster.js";
import type { CampaignBible } from "../domain/campaign.js";
import { SceneBook } from "./scenes.js";
import { classifyBeat, pauseFrom, type TurnOutcome, type PauseState } from "./pacing.js";
import {
  initCursor,
  completeCurrent,
  discoverLead,
  type MilestoneCursorState,
} from "./milestone-cursor.js";
import { initClock, tick, dmView, type WorldClockState } from "./world-clock.js";

/** Ports the engine drives. It depends only on these interfaces — never on a
 *  concrete LLM / Discord / SealDice, which keeps the engine pure and testable.
 *  `roster` and `humanInbox` are optional: with neither, every awaited actor is
 *  treated as an always-speaking AI (the #14 walking-skeleton behaviour). */
export interface EngineDeps {
  readonly agent: AgentPort;
  readonly substrate: SubstratePort;
  readonly dice: SealDicePort;
  readonly roster?: Roster;
  readonly humanInbox?: HumanInboxPort;
  /** Initial scene membership (sceneId → actor ids). Defaults to empty; the
   *  AIDM grows/shrinks it via `effects`. With no scenes configured the engine
   *  behaves single-scene (every actor sees everything — #14 behaviour). */
  readonly scenes?: Record<string, readonly string[]>;
  /** The plot spine (ADR-0007). When present, the engine tracks a milestone
   *  cursor and the campaign's world clocks. */
  readonly campaign?: CampaignBible;
}

/** Observable authoritative state transitions of a beat (ADR-0003 pacing). */
export type EngineEvent =
  | { readonly kind: "barrier-opened"; readonly waiting: readonly ActorId[] }
  | { readonly kind: "actor-acted"; readonly actorId: ActorId }
  | { readonly kind: "actor-passed"; readonly actorId: ActorId }
  | { readonly kind: "actor-gated"; readonly actorId: ActorId }
  | { readonly kind: "actor-silent"; readonly actorId: ActorId }
  | { readonly kind: "barrier-released" }
  | { readonly kind: "beat-held" }
  | { readonly kind: "stall-detected" }
  | { readonly kind: "aidm-woke" };

export interface BeatRequest {
  readonly sceneId: SceneId;
  readonly aidmId: ActorId;
}

/**
 * The outcome of a beat: either the barrier released and the AIDM advanced, or
 * it is `held` (a silent human) and carries the serializable pause state.
 */
export type BeatResult =
  | { readonly status: "advanced"; readonly events: readonly EngineEvent[] }
  | {
      readonly status: "held";
      readonly events: readonly EngineEvent[];
      readonly pause: PauseState;
    };

/**
 * The deterministic engine: events in, authoritative state + routing out.
 *
 * One beat: AIDM narrates & awaits → barrier opens → each awaited actor resolves
 * (AI via wake-gate + generation; human via inbox, where absence = silence) →
 * the barrier releases (all acted/passed) and the AIDM advances, or it holds
 * (a silent human) and the beat becomes a serializable pause.
 */
export class Engine {
  private readonly scenes = new SceneBook();
  /** Scene-scoped visibility is active once any membership is configured. Until
   *  then the engine is single-scene / all-visible (the #14 behaviour). */
  private readonly scoped: boolean;

  private cursor: MilestoneCursorState | null = null;
  private readonly clocks = new Map<string, WorldClockState>();

  constructor(private readonly deps: EngineDeps) {
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

  /** Canonical scene membership (for inspection / assertions). */
  membersOf(scene: SceneId): ActorId[] {
    return [...this.scenes.membersOf(scene)];
  }

  /** The per-branch milestone cursor, or null if no campaign is loaded. */
  cursorState(): MilestoneCursorState | null {
    return this.cursor;
  }

  /** The omniscient (AIDM) view of a world clock, or null if unknown. */
  clockView(clockId: string): ReturnType<typeof dmView> | null {
    const clock = this.clocks.get(clockId);
    return clock ? dmView(clock) : null;
  }

  async runBeat(req: BeatRequest): Promise<BeatResult> {
    const { sceneId, aidmId } = req;
    const events: EngineEvent[] = [];

    // 1. The AIDM narrates and either advances or hands the beat off.
    const opening = await this.deps.agent.takeTurn(this.ctx(sceneId, aidmId, true));
    this.applyEffects(opening.effects);
    await this.post(sceneId, aidmId, opening.prose);
    if (opening.control?.kind !== "awaiting") {
      return { status: "advanced", events };
    }

    // 2. Open the barrier; resolve each awaited actor in order.
    const awaited = opening.control.actors;
    events.push({ kind: "barrier-opened", waiting: [...awaited] });

    const outcomes = new Map<ActorId, TurnOutcome>();
    for (const actor of awaited) {
      const outcome =
        this.kindOf(actor) === "human"
          ? await this.resolveHuman(sceneId, actor, events)
          : await this.resolveAi(sceneId, actor, events);
      outcomes.set(actor, outcome);
    }

    // 3. A silent human holds the beat → serializable pause, AIDM not woken.
    if (classifyBeat(outcomes) === "held") {
      events.push({ kind: "beat-held" });
      return {
        status: "held",
        events,
        pause: pauseFrom(sceneId, aidmId, awaited, outcomes),
      };
    }

    // 4. Released. If nobody actually acted, the party stalled (拖延) → the
    //    hidden world clocks advance (ADR-0007 soft gravity).
    events.push({ kind: "barrier-released" });
    const anyActed = [...outcomes.values()].some((o) => o === "acted");
    if (!anyActed) {
      events.push({ kind: "stall-detected" });
      for (const [id, clock] of this.clocks) this.clocks.set(id, tick(clock));
    }
    const advance = await this.deps.agent.takeTurn(this.ctx(sceneId, aidmId, true));
    this.applyEffects(advance.effects);
    await this.post(sceneId, aidmId, advance.prose);
    events.push({ kind: "aidm-woke" });
    return { status: "advanced", events };
  }

  private applyEffects(effects: readonly SceneEffect[] | undefined): void {
    if (!effects) return;
    for (const e of effects) {
      switch (e.kind) {
        case "add-member":
          this.scenes.addMember(e.sceneId, e.actor);
          break;
        case "remove-member":
          this.scenes.removeMember(e.sceneId, e.actor);
          break;
        case "complete-milestone":
          if (this.cursor && this.deps.campaign) {
            this.cursor = completeCurrent(this.cursor, this.deps.campaign);
          }
          break;
        case "discover-lead":
          if (this.cursor) this.cursor = discoverLead(this.cursor, e.lead);
          break;
        case "advance-clock": {
          const clock = this.clocks.get(e.clockId);
          if (clock) this.clocks.set(e.clockId, tick(clock));
          break;
        }
      }
    }
  }

  private async resolveHuman(
    sceneId: SceneId,
    actor: ActorId,
    events: EngineEvent[],
  ): Promise<TurnOutcome> {
    const turn = this.deps.humanInbox
      ? await this.deps.humanInbox.poll(actor, sceneId)
      : undefined;
    if (turn === undefined) {
      events.push({ kind: "actor-silent", actorId: actor });
      return "silent";
    }
    if (turn.kind === "pass") {
      events.push({ kind: "actor-passed", actorId: actor });
      return "passed";
    }
    await this.post(sceneId, actor, turn.prose);
    events.push({ kind: "actor-acted", actorId: actor });
    return "acted";
  }

  private async resolveAi(
    sceneId: SceneId,
    actor: ActorId,
    events: EngineEvent[],
  ): Promise<TurnOutcome> {
    // Cheap wake-gate first: only "speakers" pay for full generation.
    const willSpeak = this.deps.agent.shouldSpeak
      ? await this.deps.agent.shouldSpeak(this.ctx(sceneId, actor))
      : true;
    if (!willSpeak) {
      events.push({ kind: "actor-gated", actorId: actor });
      return "passed";
    }
    const turn = await this.deps.agent.takeTurn(this.ctx(sceneId, actor));
    if (turn.pass) {
      events.push({ kind: "actor-passed", actorId: actor });
      return "passed";
    }
    await this.post(sceneId, actor, turn.prose);
    events.push({ kind: "actor-acted", actorId: actor });
    return "acted";
  }

  private kindOf(actor: ActorId): ActorKind {
    return this.deps.roster ? this.deps.roster.kindOf(actor) : "ai";
  }

  /** Assemble what an actor sees. The AIDM (omniscient) and the unscoped #14
   *  mode see the full record; everyone else sees only their scene horizon. */
  private ctx(sceneId: SceneId, actorId: ActorId, omniscient = false): TurnContext {
    const transcript =
      omniscient || !this.scoped ? [...this.scenes.fullLog()] : this.scenes.horizon(actorId);
    return { sceneId, actorId, transcript };
  }

  private async post(sceneId: SceneId, actorId: ActorId, prose: string | undefined): Promise<void> {
    if (prose === undefined) return;
    const p: Post = { sceneId, actorId, prose };
    this.scenes.record(p);
    await this.deps.substrate.emit(p);
  }
}
