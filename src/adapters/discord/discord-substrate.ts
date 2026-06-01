/**
 * DiscordSubstrate — real Discord adapter behind SubstratePort (issue #4).
 *
 * Architecture:
 *   - Accepts a `DiscordClient` interface for DI (real Discord webhook HTTP
 *     client or a stub in tests). Tests never hit real Discord.
 *   - emit(post) sends the post's prose to the Discord thread that the scene
 *     is mapped to, using a webhook impersonating the actor (人格分身):
 *       username = actor's display name
 *       avatarURL = actor's avatar URL (optional)
 *   - Throws DiscordSubstrateError if no thread or persona mapping exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DISCORD WEBHOOK CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Endpoint: POST <webhookUrl>?thread_id=<threadId>&wait=true
 *
 * Request body (application/json):
 *   {
 *     content:    string,         // the post's prose
 *     username:   string,         // actor display name
 *     avatar_url?: string         // actor avatar URL (omitted if not set)
 *   }
 *
 * The webhook URL contains the bot's authentication credentials; it is
 * provided via environment config (never in source code).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREAD = SCENE (风味级映射)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each scene in the engine maps to exactly one Discord thread (or channel).
 * The SceneThreadMap is injected so the adapter can route posts correctly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WEBHOOK = PERSONA (人格分身)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each actor has an ActorPersona (username + optional avatarURL). The adapter
 * sends messages via webhook with those values so each character appears with
 * its own name and portrait in Discord.
 */

import type { Post } from "../../domain/post.js";
import type { SubstratePort } from "../../ports/substrate.js";
import type { ActorPersona, SceneThreadMap } from "./scene-threads.js";
import type { InboundMessage } from "./discord-inbox.js";

// ---------------------------------------------------------------------------
// Public transport interface (DI-able)
// ---------------------------------------------------------------------------

/**
 * The outbound message shape sent to Discord via webhook.
 */
export interface SentMessage {
  /** The post's prose text. */
  readonly content: string;
  /** Actor's display name for the webhook persona. */
  readonly username: string;
  /** Actor's avatar URL for the webhook persona. Omit if not set. */
  readonly avatarURL?: string;
}

/**
 * Minimal Discord client interface the adapter depends on.
 *
 * Inject a real HTTP-based implementation in production; inject a stub in
 * tests. The real implementation uses `discord.js` or raw fetch to the
 * webhook URL — loaded via dynamic import in the factory so tests never touch
 * the real SDK.
 */
export interface DiscordClient {
  /**
   * Send a webhook message to a Discord thread (or channel).
   *
   * @param threadId - Discord thread/channel snowflake ID.
   * @param message  - The message payload (content + persona).
   */
  sendWebhookMessage(threadId: string, message: SentMessage): Promise<void>;

  /**
   * Fetch inbound messages from a thread since a given message ID (or all
   * recent if `since` is omitted).
   *
   * @param threadId - Discord thread/channel snowflake ID.
   * @param since    - Optional last-seen message ID (Discord snowflake). When
   *                   provided the client returns only messages AFTER this ID.
   */
  fetchMessages(threadId: string, since?: string): Promise<InboundMessage[]>;
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown when DiscordSubstrate cannot route a post due to a missing
 * scene→thread or actor→persona mapping.
 */
export class DiscordSubstrateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordSubstrateError";
  }
}

// ---------------------------------------------------------------------------
// DiscordSubstrate
// ---------------------------------------------------------------------------

/**
 * Real Discord adapter for the Substrate port.
 *
 * Constructor arguments (all injected for testability):
 *   client    — DiscordClient transport (stub in tests, real in prod)
 *   personas  — ActorPersona[] mapping actor IDs to webhook identities
 *   threadMap — SceneThreadMap mapping scene IDs to Discord thread IDs
 */
export class DiscordSubstrate implements SubstratePort {
  private readonly client: DiscordClient;
  private readonly personaIndex: ReadonlyMap<string, ActorPersona>;
  private readonly threadMap: SceneThreadMap;

  constructor(
    client: DiscordClient,
    personas: ActorPersona[],
    threadMap: SceneThreadMap,
  ) {
    this.client = client;
    this.threadMap = threadMap;
    // Build an index by actorId string for O(1) lookup
    this.personaIndex = new Map(personas.map((p) => [p.actorId, p]));
  }

  /**
   * Emit a post to the Discord thread mapped from post.sceneId.
   * The message is sent via webhook impersonating the actor's persona
   * (username + optional avatarURL) — 人格分身.
   *
   * @throws {DiscordSubstrateError} if no thread mapping exists for sceneId.
   * @throws {DiscordSubstrateError} if no persona exists for actorId.
   */
  async emit(post: Post): Promise<void> {
    // Resolve thread
    const threadId = this.threadMap[post.sceneId];
    if (threadId === undefined) {
      throw new DiscordSubstrateError(
        `DiscordSubstrate: no Discord thread mapped for sceneId "${post.sceneId}". ` +
          `Add it to the SceneThreadMap before emitting posts to this scene.`,
      );
    }

    // Resolve persona
    const persona = this.personaIndex.get(post.actorId);
    if (persona === undefined) {
      throw new DiscordSubstrateError(
        `DiscordSubstrate: no ActorPersona registered for actorId "${post.actorId}". ` +
          `Add an ActorPersona entry to the personas array for this actor.`,
      );
    }

    // Build message — omit avatarURL key when not set (exactOptionalPropertyTypes)
    const message: SentMessage = persona.avatarURL !== undefined
      ? { content: post.prose, username: persona.username, avatarURL: persona.avatarURL }
      : { content: post.prose, username: persona.username };

    await this.client.sendWebhookMessage(threadId, message);
  }
}
