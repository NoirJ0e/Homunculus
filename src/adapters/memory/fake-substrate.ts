import type { Post } from "../../domain/post.js";
import type { SubstratePort } from "../../ports/substrate.js";

/**
 * In-memory substrate: records every emitted post into an ordered transcript.
 * This is the headless stand-in for Discord — the thing tests assert against.
 */
export class FakeSubstrate implements SubstratePort {
  readonly transcript: Post[] = [];

  async emit(post: Post): Promise<void> {
    this.transcript.push(post);
  }
}
