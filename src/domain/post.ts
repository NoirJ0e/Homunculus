import type { ActorId, SceneId } from "./ids.js";

/**
 * A post is one actor's prose contribution to a scene — the only thing
 * players and NPCs ever write (ADR-0002: pure narrative). Authoritative state
 * is never written here; that is the AIDM's job via tool calls.
 */
export interface Post {
  readonly sceneId: SceneId;
  readonly actorId: ActorId;
  readonly prose: string;
}
