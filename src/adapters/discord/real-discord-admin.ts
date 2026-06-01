/**
 * real-discord-admin.ts — production {@link DiscordAdminPort} backed by
 * discord.js v14 (ADR-0011).
 *
 * Uses a DYNAMIC import("discord.js") so the real Discord SDK is NEVER loaded
 * in tests — exactly the pattern in `create-real-discord.ts`. Tests inject a
 * recording stub `DiscordAdminPort` instead and never import this file.
 *
 * The bot is invited with Administrator permission (private-server scope, no
 * security audit — see ADR-0011), so all of these calls succeed against the
 * one guild the bot provisions campaigns in.
 *
 * HITL: this module is verified LIVE in issue #28, not unit-tested. Kept thin
 * and correct; no over-engineering.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Setup notes
 * ─────────────────────────────────────────────────────────────────────────────
 *   - Invite the bot with the Administrator permission.
 *   - The gateway client needs the `Guilds` intent so the guild + its channel
 *     manager are cached and channel/webhook/thread creation works.
 *   - DISCORD_GUILD_ID is the id of the server the concierge provisions into.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { DiscordAdminPort } from "../../ports/discord-admin.js";

export interface RealDiscordAdminConfig {
  /** Bot token (with Administrator permission). */
  readonly botToken: string;
  /** The guild (server) id the concierge provisions campaigns into. */
  readonly guildId: string;
}

/**
 * Create a real DiscordAdminPort. Logs the gateway client in and resolves the
 * target guild once; subsequent admin calls reuse the cached guild.
 *
 * Call this only from the application entry point (never from tests).
 */
export async function createRealDiscordAdmin(
  config: RealDiscordAdminConfig,
): Promise<DiscordAdminPort> {
  // Dynamic import — keeps discord.js out of test bundles.
  const { Client, GatewayIntentBits, ChannelType } = await import("discord.js");

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.botToken);
  const guild = await client.guilds.fetch(config.guildId);

  return {
    async createCategory(name: string): Promise<string> {
      const category = await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
      });
      return category.id;
    },

    async createTextChannel(categoryId: string, name: string): Promise<string> {
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: categoryId,
      });
      return channel.id;
    },

    async createWebhook(channelId: string, name: string): Promise<string> {
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !("createWebhook" in channel)) {
        throw new Error(`channel ${channelId} cannot host a webhook`);
      }
      const webhook = await channel.createWebhook({ name });
      return webhook.url;
    },

    async createThread(channelId: string, name: string): Promise<string> {
      const channel = await client.channels.fetch(channelId);
      if (channel === null || channel.type !== ChannelType.GuildText) {
        throw new Error(`channel ${channelId} cannot host a card-creation thread`);
      }
      const thread = await channel.threads.create({ name });
      return thread.id;
    },

    async setChannelTopic(channelId: string, topic: string): Promise<void> {
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !("setTopic" in channel)) {
        throw new Error(`channel ${channelId} has no topic to set`);
      }
      await channel.setTopic(topic);
    },
  };
}
