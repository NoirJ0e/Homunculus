/**
 * message-events.ts — the gateway-push seam (ADR-0010).
 *
 * The REST DiscordClient only fetches on demand; to wait for a human in real
 * time we need messages PUSHED as they arrive. `MessageEventSource` is the DI
 * boundary: the real adapter backs it with a discord.js gateway `Client`
 * (`messageCreate`), tests back it with a hand-driven fake. `GatewayInbox`
 * consumes it to make the human's turn an awaited event rather than a poll.
 */
export interface GatewayMessage {
  /** Discord thread (or channel) snowflake the message was posted in. */
  readonly threadId: string;
  /** Discord user snowflake of the author. */
  readonly userId: string;
  /** Raw message text. */
  readonly content: string;
  /** Discord message snowflake. */
  readonly messageId: string;
}

export interface MessageEventSource {
  /** Register a handler invoked for every inbound gateway message. */
  onMessage(handler: (message: GatewayMessage) => void): void;
}
