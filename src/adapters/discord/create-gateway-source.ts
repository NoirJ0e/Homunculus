import type { GatewayMessage, MessageEventSource } from "./message-events.js";

/**
 * create-gateway-source.ts — the real discord.js gateway client behind
 * MessageEventSource (ADR-0010 Phase 1 wiring). HITL: dynamic-imports discord.js
 * (never loaded in tests; tests use a fake MessageEventSource). Logs in with the
 * bot token, pushes every non-bot message as a GatewayMessage so GatewayInbox
 * can resolve a human's awaited turn in real time.
 *
 * Requires the Message Content Intent enabled on the bot (see the README).
 */
export async function createGatewaySource(botToken: string): Promise<MessageEventSource> {
  const { Client, GatewayIntentBits } = await import("discord.js");

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const handlers: Array<(m: GatewayMessage) => void> = [];

  client.on("messageCreate", (msg) => {
    // Ignore the bot's own webhook posts (DM/NPC personas) — only humans feed
    // the inbox, else we'd treat the agents' own output as player input.
    if (msg.author.bot) return;
    const gm: GatewayMessage = {
      threadId: msg.channelId,
      userId: msg.author.id,
      content: msg.content,
      messageId: msg.id,
    };
    for (const h of handlers) h(gm);
  });

  await client.login(botToken);

  return { onMessage: (handler) => handlers.push(handler) };
}
