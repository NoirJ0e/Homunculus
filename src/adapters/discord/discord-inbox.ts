/**
 * DiscordInbox — real Discord adapter behind HumanInboxPort (issue #4).
 *
 * Architecture:
 *   - Accepts a `DiscordClient` interface for DI (stub in tests, real in prod).
 *   - poll(actor, sceneId) fetches new messages from the Discord thread mapped
 *     to sceneId, filters to messages authored by the given actor (by Discord
 *     user ID), and maps the most recent message to HumanTurn:
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INBOUND MESSAGE CONVENTION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A player types in a Discord thread. We map their message content to a
 * HumanTurn as follows:
 *
 *   starts with ".ra" (case-insensitive)     → { kind: "roll" }
 *     Used when the engine has called a check and the human types `.ra <skill>`
 *     to resolve it via the dice authority (BCDice, ADR-0013).
 *
 *   exactly "pass" or "pass你们继续"
 *   (trimmed, case-insensitive)              → { kind: "pass" }
 *     The human explicitly yields their turn. Distinct from silence (undefined)
 *     per ADR-0003: silence = infinite hold, explicit pass = unblock barrier.
 *
 *   any other non-empty text                 → { kind: "prose", prose }
 *     Free narrative contribution.
 *
 *   no messages since last poll              → undefined  (silence / AFK)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAST-SEEN TRACKING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each (actor, sceneId) pair tracks the last-seen Discord message ID so
 * successive polls only return NEW messages (not already-processed ones).
 * On the first poll for a pair, `since` is omitted (returns all recent).
 *
 * Note: In a production deployment the last-seen cursor should be persisted
 * across process restarts. The in-process Map is sufficient for a single-
 * session run; persistence is left to a future ADR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PER-ACTOR FILTERING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Discord messages carry the author's user ID (snowflake). ActorPersona
 * carries an optional `discordUserId` field. The inbox filters messages by
 * this ID so each actor only receives their own human turn.
 *
 * If an actor has no `discordUserId` in their persona → DiscordInboxError.
 * (AI agents that are polled via the inbox must have this field set.)
 */

import type { ActorId, SceneId } from "../../domain/ids.js";
import type { HumanInboxPort, HumanTurn } from "../../ports/human-inbox.js";
import { mapContentToTurn } from "./message-mapping.js";
import type { ActorPersona, SceneThreadMap } from "./scene-threads.js";

// ---------------------------------------------------------------------------
// InboundMessage — what the Discord client returns
// ---------------------------------------------------------------------------

/**
 * A single inbound message from Discord.
 * The real adapter maps Discord API's Message object to this shape.
 */
export interface InboundMessage {
  /** Discord user (snowflake) ID of the message author. */
  readonly userId: string;
  /** The raw text content of the message. */
  readonly content: string;
  /** The Discord message snowflake ID (used for last-seen tracking). */
  readonly messageId: string;
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown by DiscordInbox when it cannot process a poll due to a missing
 * scene→thread mapping or actor→discordUserId mapping.
 */
export class DiscordInboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordInboxError";
  }
}

// Message content → HumanTurn mapping now lives in ./message-mapping.ts
// (shared with GatewayInbox so the inbound convention is transport-agnostic).

// ---------------------------------------------------------------------------
// DiscordInbox
// ---------------------------------------------------------------------------

import type { DiscordClient } from "./discord-substrate.js";

/**
 * Real Discord adapter for the HumanInbox port.
 *
 * Constructor arguments (all injected):
 *   client    — DiscordClient transport (stub in tests, real in prod)
 *   personas  — ActorPersona[] mapping actor IDs to Discord user IDs
 *   threadMap — SceneThreadMap mapping scene IDs to Discord thread IDs
 */
export class DiscordInbox implements HumanInboxPort {
  private readonly client: DiscordClient;
  private readonly personaIndex: ReadonlyMap<string, ActorPersona>;
  private readonly threadMap: SceneThreadMap;
  /** Tracks the last-seen Discord message ID per (actor, sceneId) key. */
  private readonly lastSeen: Map<string, string> = new Map();

  constructor(
    client: DiscordClient,
    personas: ActorPersona[],
    threadMap: SceneThreadMap,
  ) {
    this.client = client;
    this.threadMap = threadMap;
    this.personaIndex = new Map(personas.map((p) => [p.actorId, p]));
  }

  /**
   * Poll for the human's latest turn in the given scene.
   *
   * Returns the mapped HumanTurn for the most recent message authored by the
   * actor in the scene's thread since the last poll, or `undefined` if the
   * human is silent.
   *
   * @throws {DiscordInboxError} if no thread mapping exists for sceneId.
   * @throws {DiscordInboxError} if the actor has no discordUserId in their persona.
   */
  async poll(actor: ActorId, sceneId: SceneId): Promise<HumanTurn | undefined> {
    // Resolve thread
    const threadId = this.threadMap[sceneId];
    if (threadId === undefined) {
      throw new DiscordInboxError(
        `DiscordInbox: no Discord thread mapped for sceneId "${sceneId}". ` +
          `Add it to the SceneThreadMap before polling this scene.`,
      );
    }

    // Resolve persona → discordUserId
    const persona = this.personaIndex.get(actor);
    if (persona === undefined || persona.discordUserId === undefined) {
      throw new DiscordInboxError(
        `DiscordInbox: no discordUserId configured for actorId "${actor}". ` +
          `Set discordUserId on the ActorPersona for this actor to enable inbox polling.`,
      );
    }
    const discordUserId = persona.discordUserId;

    // Build last-seen cursor key
    const cursorKey = `${actor}:${sceneId}`;
    const since = this.lastSeen.get(cursorKey);

    // Fetch messages from Discord
    const messages = since !== undefined
      ? await this.client.fetchMessages(threadId, since)
      : await this.client.fetchMessages(threadId);

    // Filter to messages from this actor
    const actorMessages = messages.filter((m) => m.userId === discordUserId);

    if (actorMessages.length === 0) {
      return undefined;
    }

    // Take the most recent message
    const latest = actorMessages[actorMessages.length - 1]!;

    // Update last-seen cursor
    this.lastSeen.set(cursorKey, latest.messageId);

    const mapped = mapContentToTurn(latest.content);
    // OOC (ADR-0011 前缀表): not a turn. Skip it — the cursor has advanced past
    // it, so it is never re-fetched and never reaches the DM. This poll yields
    // no in-character turn (treated like silence for this beat).
    if (mapped.kind === "ooc") return undefined;
    return mapped;
  }
}
