import type { Post } from "../domain/post.js";

/**
 * Substrate port — where posts surface to participants (Discord in #4, an
 * in-memory capture in tests). The engine emits; the substrate routes/records.
 */
export interface SubstratePort {
  emit(post: Post): Promise<void>;
}
