/**
 * message-events.ts — Discord message shapes + the gateway-push seam (ADR-0010).
 *
 * The REST DiscordClient only fetches on demand; to wait for a human in real
 * time we need messages PUSHED as they arrive. `MessageEventSource` is the DI
 * boundary: the real adapter backs it with a discord.js gateway `Client`
 * (`messageCreate`), tests back it with a hand-driven fake. The dispatcher /
 * PushInbox consume it to make the human's turn an awaited event, not a poll.
 */

/** A single inbound message from a REST fetch — the shape
 *  `DiscordClient.fetchMessages` returns (mapped from Discord API's Message). */
export interface InboundMessage {
  /** Discord user (snowflake) ID of the message author. */
  readonly userId: string;
  /** The raw text content of the message. */
  readonly content: string;
  /** The Discord message snowflake ID (used for last-seen tracking). */
  readonly messageId: string;
}

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
