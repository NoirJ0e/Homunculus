/**
 * DiscordAdminPort — the DI seam for the concierge's Discord-admin powers
 * (ADR-0011). The concierge provisions a campaign's channel skeleton (a
 * Category = one campaign, a main text channel = the AIDM scene, a webhook for
 * persona messages) and writes the routing pointer into the channel topic.
 *
 * This is a PORT: tests inject a recording stub; production injects the
 * `real-discord-admin` impl (dynamic import discord.js, bot Admin token). The
 * adapter-layer MCP server (`discord-admin-mcp.ts`) wraps these methods as
 * in-process MCP tools without ever touching `src/engine/`.
 *
 * Each method returns exactly the id / url the caller needs to chain the next
 * step (categoryId → channelId → webhookUrl) — nothing more.
 */
export interface DiscordAdminPort {
  /** Create a Category (the folder for one campaign). Returns its channel id. */
  createCategory(name: string): Promise<string>;
  /**
   * Create a text channel inside the given category (the AIDM scene channel).
   * Returns the new channel's id.
   */
  createTextChannel(categoryId: string, name: string): Promise<string>;
  /**
   * Create a webhook on the given channel (used to post as actor personas).
   * Returns the webhook URL.
   */
  createWebhook(channelId: string, name: string): Promise<string>;
  /**
   * Create a thread under the given channel (e.g. a card-creation sub-scene).
   * Returns the new thread's id.
   */
  createThread(channelId: string, name: string): Promise<string>;
  /**
   * Set a channel's topic — where the routing pointer lives (see
   * `channel-routing.ts` `encodeTopic`).
   */
  setChannelTopic(channelId: string, topic: string): Promise<void>;
}
