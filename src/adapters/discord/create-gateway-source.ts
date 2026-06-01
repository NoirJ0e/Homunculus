import type { GatewayMessage, MessageEventSource } from "./message-events.js";
import type { DispatcherEventSource } from "../../runtime/dispatcher.js";
import type { ChannelRouting } from "./channel-routing.js";
import { parseTopic } from "./channel-routing.js";

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

/**
 * The dispatcher's gateway wiring: a {@link DispatcherEventSource} (messages +
 * thread-archived) PLUS a `resolveRouting` bound to the same logged-in client.
 *
 * GLUE — HITL, NOT unit-tested (dynamic-imports discord.js exactly like the
 * functions above; tests hand-drive a fake DispatcherEventSource + a pure
 * resolveRouting). Backs:
 *   - onMessage      ← `messageCreate` (non-bot only);
 *   - onThreadArchived ← `threadUpdate` (archived flag flips true) + `threadDelete`;
 *   - resolveRouting ← live `channels.fetch` → read `topic` → `parseTopic`,
 *     with the ADR-0011 default: General/root (no parseable topic) → concierge.
 */
export interface DispatcherGatewayWiring {
  readonly eventSource: DispatcherEventSource;
  readonly resolveRouting: (channelId: string) => Promise<ChannelRouting | null>;
}

export async function createDispatcherGatewaySource(
  botToken: string,
  lobbyCampaign = "lobby",
): Promise<DispatcherGatewayWiring> {
  const { Client, GatewayIntentBits } = await import("discord.js");

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const msgHandlers: Array<(m: GatewayMessage) => void> = [];
  const archiveHandlers: Array<(channelId: string) => void> = [];

  client.on("messageCreate", (msg) => {
    if (msg.author.bot) return;
    const gm: GatewayMessage = {
      threadId: msg.channelId,
      userId: msg.author.id,
      content: msg.content,
      messageId: msg.id,
    };
    for (const h of msgHandlers) h(gm);
  });

  // A thread becoming archived (its `archived` flag flips true) tears its
  // card-creation session down. discord.js fires `threadUpdate(old, new)`.
  client.on("threadUpdate", (oldThread, newThread) => {
    if (!oldThread.archived && newThread.archived) {
      for (const h of archiveHandlers) h(newThread.id);
    }
  });

  // A deleted thread is likewise a teardown trigger.
  client.on("threadDelete", (thread) => {
    for (const h of archiveHandlers) h(thread.id);
  });

  await client.login(botToken);

  const resolveRouting = async (channelId: string): Promise<ChannelRouting | null> => {
    let channel = await client.channels.fetch(channelId);
    if (channel === null) return null;
    // A THREAD carries no topic — it inherits its PARENT channel's routing (same
    // campaign). Without this, a command run inside the open-card thread (e.g.
    // /verify-card) resolves to the lobby campaign instead of the real one, so
    // the roster/owner written against the parent's campaign isn't found
    // ("状态不共享"). Resolve the parent and read ITS topic.
    if ("isThread" in channel && (channel as { isThread: () => boolean }).isThread()) {
      const parentId = (channel as { parentId?: string | null }).parentId ?? null;
      channel = parentId === null ? null : await client.channels.fetch(parentId);
      if (channel === null) return null;
    }
    // Only text-channel-like surfaces carry a topic.
    const topic =
      "topic" in channel && typeof (channel as { topic?: unknown }).topic === "string"
        ? (channel as { topic: string }).topic
        : null;
    const routing = parseTopic(topic);
    if (routing !== null) return routing;
    // ADR-0011: General / root (no routing topic) is the concierge lobby. We
    // treat any topicless text channel as the lobby; truly unknown surfaces
    // (e.g. an archived thread with no topic) still route to concierge here,
    // which is the safe zero-friction default for a fresh server.
    if ("topic" in channel) return { campaign: lobbyCampaign, role: "concierge" };
    return null;
  };

  return {
    eventSource: {
      onMessage: (handler) => msgHandlers.push(handler),
      onThreadArchived: (handler) => archiveHandlers.push(handler),
    },
    resolveRouting,
  };
}
