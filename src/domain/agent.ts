import type { ActorId, SceneId } from "./ids.js";
import type { Post } from "./post.js";

/**
 * Control signals are the out-of-band pacing channel of ADR-0003. Only the
 * AIDM emits them: `awaiting` opens a barrier on a set of actors; `continue`
 * advances the beat once the barrier has released.
 */
export type ControlSignal =
  | { readonly kind: "awaiting"; readonly actors: readonly ActorId[] }
  | { readonly kind: "continue" };

/**
 * What an actor (AIDM or NPC) returns when asked to take its turn.
 * - `prose`  — narrative contribution; absent when passing.
 * - `control`— pacing signal; in practice only the AIDM sets this.
 * - `pass`   — an explicit, deliberate "I have nothing to add" (ADR-0003).
 */
export interface AgentResponse {
  readonly prose?: string;
  readonly control?: ControlSignal;
  readonly pass?: boolean;
}

/** The slice of the world an actor sees when asked to act. */
export interface TurnContext {
  readonly sceneId: SceneId;
  readonly actorId: ActorId;
  /** Posts visible to this actor so far (no visibility filtering yet — see #6). */
  readonly transcript: readonly Post[];
}
