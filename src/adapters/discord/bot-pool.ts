/**
 * bot-pool.ts — the NPC bot pool (#56, 改写 ADR-0010 运行时拓扑).
 *
 * Each AI teammate speaks as its OWN real, @-mentionable bot (so players can
 * `@周慎 …` to coordinate — the @bot channel, #57). The runtime enumerates
 * `BOT_TOKEN_1..n` (see config.ts) into a pool; each token logs in a separate
 * gateway client. `PoolBot` is the seam the substrate posts through.
 *
 * The {@link PoolBot} interface is pure (no discord.js) so {@link MultiBotSubstrate}
 * is unit-tested with fakes; {@link createBotPool} is the live login glue —
 * HITL, NOT unit-tested (dynamic-imports discord.js, like its siblings), validated
 * by the live run.
 */

/** One logged-in pool bot — a real Discord identity an NPC speaks/`@`s through. */
export interface PoolBot {
  /** This bot's Discord user (snowflake) id — used to resolve `@bot` mentions (#57). */
  readonly userId: string;
  /**
   * Post `content` into a channel/thread AS this bot. `mentionUserIds` (if any)
   * are set in `allowed_mentions` so the @-pings actually push.
   */
  send(channelId: string, content: string, mentionUserIds?: readonly string[]): Promise<void>;
  /** Set this bot's per-guild nickname (= the NPC's name) so it shows in-fiction. */
  setNickname(guildId: string, nickname: string): Promise<void>;
}

/**
 * Log in one gateway client per token → a pool of {@link PoolBot}s. HITL glue —
 * dynamic-imports discord.js, never loaded in tests. Each bot needs the bot scope
 * in the SAME guild (Administrator simplest) + Message Content Intent (#56 docs).
 */
export async function createBotPool(tokens: readonly string[]): Promise<PoolBot[]> {
  if (tokens.length === 0) return [];
  const { Client, GatewayIntentBits } = await import("discord.js");

  const pool: PoolBot[] = [];
  for (const [i, token] of tokens.entries()) {
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
    try {
      await client.login(token);
    } catch (e) {
      // A bad/revoked pool token must NOT crash the whole process at boot — skip
      // it (that NPC falls back to a webhook persona) and keep the table alive.
      console.error(`[bot-pool] BOT_TOKEN_${i + 1} login failed, skipping:`, (e as Error).message);
      continue;
    }
    const userId = client.user?.id ?? "";

    const send = async (
      channelId: string,
      content: string,
      mentionUserIds?: readonly string[],
    ): Promise<void> => {
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !("send" in channel)) {
        throw new Error(`pool bot ${userId}: channel ${channelId} not sendable`);
      }
      await (channel as { send: (opts: unknown) => Promise<unknown> }).send({
        content,
        allowedMentions: { users: [...(mentionUserIds ?? [])] },
      });
    };

    const setNickname = async (guildId: string, nickname: string): Promise<void> => {
      const guild = await client.guilds.fetch(guildId);
      const me = await guild.members.fetch(userId);
      await me.setNickname(nickname).catch(() => {
        // Non-fatal: a bot may lack Manage Nickname / outrank — the username
        // still distinguishes it. Log-and-continue keeps the table running.
      });
    };

    pool.push({ userId, send, setNickname });
  }
  return pool;
}
