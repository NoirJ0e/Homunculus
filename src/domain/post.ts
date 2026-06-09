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
  /**
   * Actors this post directs at — rendered as real @-mentions by the substrate
   * (#56 cue @真人). The engine stays id-only (no Discord ids): `nominate` tags
   * the nominee here, and the Discord substrate maps each id → its persona's
   * `discordUserId` to ping the real player. Absent/empty on ordinary posts.
   */
  readonly mentions?: readonly ActorId[];
}
