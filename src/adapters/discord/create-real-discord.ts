/**
 * create-real-discord.ts — Production factory for real Discord adapters.
 *
 * This module uses a DYNAMIC import("discord.js") so the real Discord SDK is
 * NEVER loaded in tests. Tests inject stub DiscordClients directly into
 * DiscordSubstrate and DiscordInbox — this file is never imported by tests.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HUMAN RUNBOOK — Setting up a real Discord integration
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Prerequisites:
 *   1. Create a Discord application at https://discord.com/developers/applications
 *   2. Under "Bot", enable the bot and copy its token (DISCORD_BOT_TOKEN).
 *   3. Under "OAuth2 > URL Generator", select scopes: bot + applications.commands
 *      and permissions: Send Messages, Read Message History, Manage Webhooks.
 *   4. Invite the bot to your server using the generated URL.
 *   5. Create a webhook in the channel you want to use as the main scene:
 *      Channel Settings → Integrations → Webhooks → New Webhook.
 *      Copy the webhook URL (DISCORD_WEBHOOK_URL).
 *   6. For each scene, create a thread in the channel and copy its ID
 *      (right-click thread → Copy Thread ID — requires Developer Mode).
 *   7. Build the SceneThreadMap and ActorPersona[] arrays as shown below.
 *
 * Environment variables required:
 *   DISCORD_BOT_TOKEN   — Bot token for reading messages from threads.
 *   DISCORD_WEBHOOK_URL — Webhook URL for sending messages as actor personas.
 *
 * Example usage (application entry point only):
 *
 *   import { createRealDiscordClient } from "./src/adapters/discord/create-real-discord.js";
 *   import { DiscordSubstrate } from "./src/adapters/discord/discord-substrate.js";
 *   import { DiscordInbox } from "./src/adapters/discord/discord-inbox.js";
 *   import { actorId, sceneId } from "./src/domain/ids.js";
 *
 *   const personas = [
 *     { actorId: actorId("actor-bard"),   username: "Lyra",    avatarURL: "...", discordUserId: "111..." },
 *     { actorId: actorId("actor-fighter"),username: "Thorin",  avatarURL: "...", discordUserId: "222..." },
 *     { actorId: actorId("actor-dm"),     username: "The DM",  avatarURL: "..." },
 *   ];
 *   const threadMap = {
 *     [sceneId("scene-main")]:    "thread-snowflake-001",
 *     [sceneId("scene-dungeon")]: "thread-snowflake-002",
 *   };
 *
 *   const client = await createRealDiscordClient({
 *     botToken:   process.env.DISCORD_BOT_TOKEN!,
 *     webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
 *   });
 *   const substrate = new DiscordSubstrate(client, personas, threadMap);
 *   const inbox     = new DiscordInbox(client, personas, threadMap);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { DiscordClient, SentMessage } from "./discord-substrate.js";
import type { InboundMessage } from "./discord-inbox.js";

// ---------------------------------------------------------------------------
// Production client config
// ---------------------------------------------------------------------------

export interface RealDiscordClientConfig {
  /**
   * Discord bot token. Used (via discord.js REST client) to read messages
   * from threads (requires Read Message History permission).
   */
  readonly botToken: string;
  /**
   * Webhook URL. Used for sending messages with actor username + avatar.
   * Format: https://discord.com/api/webhooks/<id>/<token>
   */
  readonly webhookUrl: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a real DiscordClient backed by discord.js.
 *
 * Uses dynamic import so discord.js is NEVER bundled in test environments.
 * Call this only from the application entry point.
 *
 * @throws if DISCORD_BOT_TOKEN or DISCORD_WEBHOOK_URL are invalid.
 */
export async function createRealDiscordClient(
  config: RealDiscordClientConfig,
): Promise<DiscordClient> {
  // Dynamic import — keeps discord.js out of test bundles
  const { REST, Routes } = await import("discord.js");

  const rest = new REST({ version: "10" }).setToken(config.botToken);
  const webhookUrl = config.webhookUrl;

  return {
    /**
     * Send a webhook message to a Discord thread (or channel).
     *
     * Appends `?thread_id=<threadId>&wait=true` to the webhook URL so the
     * message targets the specific thread and we confirm delivery.
     */
    async sendWebhookMessage(threadId: string, message: SentMessage): Promise<void> {
      const url = new URL(webhookUrl);
      url.searchParams.set("thread_id", threadId);
      url.searchParams.set("wait", "true");

      // Build payload — omit avatar_url key when not set
      const payload: {
        content: string;
        username: string;
        avatar_url?: string;
      } = {
        content: message.content,
        username: message.username,
      };
      if (message.avatarURL !== undefined) {
        payload.avatar_url = message.avatarURL;
      }

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body: unknown = await response.text();
        throw new Error(
          `Discord webhook POST failed (HTTP ${response.status}): ${String(body)}`,
        );
      }
    },

    /**
     * Fetch messages from a Discord thread using the bot token.
     *
     * When `since` is provided, uses Discord's `after` query param to return
     * only messages with snowflake IDs greater than `since` (i.e. newer).
     * Returns up to 100 messages per poll (Discord API default limit).
     */
    async fetchMessages(threadId: string, since?: string): Promise<InboundMessage[]> {
      // Build query: GET /channels/<threadId>/messages[?after=<since>]
      const query = new URLSearchParams({ limit: "100" });
      if (since !== undefined) {
        query.set("after", since);
      }

      // Use discord.js REST to authenticate with the bot token
      const rawMessages = (await rest.get(
        Routes.channelMessages(threadId),
        { query },
      )) as Array<{
        id: string;
        author: { id: string };
        content: string;
      }>;

      // Map Discord API shape → our InboundMessage shape
      // Discord returns messages newest-first; reverse so callers get oldest-first
      return rawMessages
        .reverse()
        .map((m) => ({
          messageId: m.id,
          userId: m.author.id,
          content: m.content,
        }));
    },
  };
}
