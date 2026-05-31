import { actorId as brandActor, type ActorId, type SceneId } from "../domain/ids.js";
import type { Post } from "../domain/post.js";
import type { SubstratePort } from "../ports/substrate.js";
import { SceneBook } from "./scenes.js";

/**
 * Referee — the engine's shared state + the tool handlers the DM/NPC agents
 * call (ADR-0009). The control flow is half-inverted: the engine no longer
 * directs a beat; instead it exposes capabilities as in-process MCP tools whose
 * handlers are same-process TS closures over this shared state, and only
 * referees the invariants (visibility / sole-writer / pacing).
 *
 * This slice (#15) stands up the skeleton with the first tool, `narrate`. Later
 * slices hang more methods off the same shared state: `await_actors` (#17),
 * `call_check` / `roll` / `read_card` (#18), spine / scene / clock writes (#19).
 *
 * Purity (CI guard): this module lives under the engine and therefore imports
 * only ports + pure kernels — never the Agent SDK or a concrete substrate. The
 * MCP wrapping lives in the agent-sdk adapter layer, one ring out.
 */
export interface RefereeDeps {
  /** The AIDM — the sole narrator and authoritative-state writer (ADR-0002). */
  readonly aidmId: ActorId;
  /** Where narrated posts surface (Discord in #4, an in-memory capture in tests). */
  readonly substrate: SubstratePort;
  /** Initial scene membership (sceneId → actor ids); the AIDM grows/shrinks it. */
  readonly scenes?: Record<string, readonly string[]>;
}

export class Referee {
  private readonly scenes = new SceneBook();

  constructor(private readonly deps: RefereeDeps) {
    for (const [scene, members] of Object.entries(deps.scenes ?? {})) {
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
    const post: Post = { sceneId: scene, actorId: this.deps.aidmId, prose };
    this.scenes.record(post);
    await this.deps.substrate.emit(post);
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
