import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * stream-input.ts — a pushed-string → `AsyncIterable<SDKUserMessage>` adapter for
 * the SDK's STREAMING-INPUT mode (the conversational concierge + card-creation
 * runners pass `prompt: channel.iterable` to `query()`).
 *
 * It is a single-consumer async queue: `push(text)` enqueues a user turn; the
 * async iterable yields each as a properly-shaped `SDKUserMessage`; `close()`
 * drains the buffer then ends iteration. Pure — no SDK call here, so it is fully
 * unit-tested. The live `query()` wiring that consumes the iterable is the glue.
 */
function toSdkUserMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

export class StreamInputChannel {
  private readonly buffer: SDKUserMessage[] = [];
  private waiter: ((result: IteratorResult<SDKUserMessage>) => void) | undefined;
  private closed = false;

  /** Enqueue a user turn (a raw string from Discord). No-op once closed. */
  push(text: string): void {
    if (this.closed) return;
    const message = toSdkUserMessage(text);
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve({ value: message, done: false });
      return;
    }
    this.buffer.push(message);
  }

  /** End the stream. A buffered backlog is still drained before completion. */
  close(): void {
    this.closed = true;
    if (this.waiter && this.buffer.length === 0) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve({ value: undefined, done: true });
    }
  }

  /** The streaming-input prompt to hand to `query({ prompt: channel.iterable })`. */
  readonly iterable: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: (): AsyncIterator<SDKUserMessage> => ({
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        const buffered = this.buffer.shift();
        if (buffered !== undefined) {
          return Promise.resolve({ value: buffered, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiter = resolve;
        });
      },
    }),
  };
}
