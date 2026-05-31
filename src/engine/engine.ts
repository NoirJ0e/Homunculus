import type { ActorId, SceneId } from "../domain/ids.js";
import type { Post } from "../domain/post.js";
import type { AgentPort } from "../ports/agent.js";
import type { SubstratePort } from "../ports/substrate.js";
import type { SealDicePort } from "../ports/sealdice.js";
import { openBarrier, recordAction, isReleased, type BarrierState } from "./barrier.js";

/** Ports the engine drives. It depends only on these interfaces — never on a
 *  concrete LLM / Discord / SealDice, which keeps the engine pure and testable. */
export interface EngineDeps {
  readonly agent: AgentPort;
  readonly substrate: SubstratePort;
  readonly dice: SealDicePort;
}

/** Observable authoritative state transitions of a beat (ADR-0003 pacing). */
export type EngineEvent =
  | { readonly kind: "barrier-opened"; readonly waiting: readonly ActorId[] }
  | { readonly kind: "actor-acted"; readonly actorId: ActorId }
  | { readonly kind: "actor-passed"; readonly actorId: ActorId }
  | { readonly kind: "barrier-released" }
  | { readonly kind: "aidm-woke" };

export interface BeatRequest {
  readonly sceneId: SceneId;
  readonly aidmId: ActorId;
}

export interface BeatResult {
  readonly events: readonly EngineEvent[];
}

/**
 * The deterministic engine: events in, authoritative state + routing out.
 *
 * #14 runs a single scene, one beat, everyone visible:
 *   AIDM narrates & awaits → barrier opens → each awaited NPC acts or passes →
 *   barrier releases → AIDM is woken to advance.
 */
export class Engine {
  private readonly transcript: Post[] = [];

  constructor(private readonly deps: EngineDeps) {}

  async runBeat(req: BeatRequest): Promise<BeatResult> {
    const { sceneId, aidmId } = req;
    const events: EngineEvent[] = [];

    // 1. The AIDM narrates and hands the beat to a set of actors.
    const opening = await this.deps.agent.takeTurn({
      sceneId,
      actorId: aidmId,
      transcript: [...this.transcript],
    });
    await this.post(sceneId, aidmId, opening.prose);

    if (opening.control?.kind !== "awaiting") {
      // No barrier requested: nothing to wait on. (Richer cases land in #2.)
      return { events };
    }

    // 2. Open the barrier on the awaited actors.
    const awaited = opening.control.actors;
    let barrier: BarrierState = openBarrier(awaited);
    events.push({ kind: "barrier-opened", waiting: [...awaited] });

    // 3. Each awaited actor acts or explicitly passes, in order.
    for (const actor of awaited) {
      const turn = await this.deps.agent.takeTurn({
        sceneId,
        actorId: actor,
        transcript: [...this.transcript],
      });
      if (turn.pass) {
        events.push({ kind: "actor-passed", actorId: actor });
      } else {
        await this.post(sceneId, actor, turn.prose);
        events.push({ kind: "actor-acted", actorId: actor });
      }
      barrier = recordAction(barrier, actor);
    }

    // 4. Barrier releases once everyone has acted/passed; wake the AIDM.
    if (!isReleased(barrier)) {
      throw new Error("Engine: beat ended with an unreleased barrier");
    }
    events.push({ kind: "barrier-released" });

    const advance = await this.deps.agent.takeTurn({
      sceneId,
      actorId: aidmId,
      transcript: [...this.transcript],
    });
    await this.post(sceneId, aidmId, advance.prose);
    events.push({ kind: "aidm-woke" });

    return { events };
  }

  private async post(sceneId: SceneId, actorId: ActorId, prose: string | undefined): Promise<void> {
    if (prose === undefined) return;
    const p: Post = { sceneId, actorId, prose };
    this.transcript.push(p);
    await this.deps.substrate.emit(p);
  }
}
