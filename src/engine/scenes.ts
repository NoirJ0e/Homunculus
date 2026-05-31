import type { ActorId, SceneId } from "../domain/ids.js";
import type { Post } from "../domain/post.js";

/**
 * 场景簿 (SceneBook) — the canonical visibility state (ADR-0005).
 *
 * A scene's records are visible only to its members. An actor's knowledge
 * horizon is therefore the union of the scenes it belongs to — anti-metagaming
 * falls out for free (a party-split group literally cannot see the other's
 * posts). Membership is mutated by the AIDM via tool calls and maintained here.
 *
 * The AIDM is omniscient and is handled by the engine (full log), not modelled
 * as a member of every scene.
 */
export class SceneBook {
  private readonly members = new Map<SceneId, Set<ActorId>>();
  private readonly log: Post[] = [];

  addMember(scene: SceneId, actor: ActorId): void {
    let set = this.members.get(scene);
    if (!set) {
      set = new Set();
      this.members.set(scene, set);
    }
    set.add(actor);
  }

  removeMember(scene: SceneId, actor: ActorId): void {
    this.members.get(scene)?.delete(actor);
  }

  isMember(scene: SceneId, actor: ActorId): boolean {
    return this.members.get(scene)?.has(actor) ?? false;
  }

  membersOf(scene: SceneId): ReadonlySet<ActorId> {
    return this.members.get(scene) ?? new Set();
  }

  /** Append a post to the global record under its own scene. */
  record(post: Post): void {
    this.log.push(post);
  }

  /** Posts visible to an actor: those in scenes it currently belongs to,
   *  in global order. */
  horizon(actor: ActorId): Post[] {
    return this.log.filter((p) => this.isMember(p.sceneId, actor));
  }

  /** The full record — the omniscient (AIDM) view. */
  fullLog(): readonly Post[] {
    return this.log;
  }
}
