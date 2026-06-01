/**
 * spike-concierge-provision.ts — issue #23 承重 spike（THROWAWAY，HITL）。
 *
 * 验掉 ADR-0011 的地基假设：一条 concierge query() 经进程内 MCP 工具，真能用
 * discord.js（bot Admin）建出 category / 文本频道 / webhook、把路由指针写进频道
 * topic，且另一侧能独立读回 topic 并解析出 role=aidm，并认订阅 token。
 *
 * 不是正式件：组合已落地的真实部件（#25 channel-routing、#26 DiscordAdminPort /
 * admin-MCP / concierge-prompt + real-discord-admin），跑一次顺带验掉 HITL-
 * unverified 的 real-discord-admin.ts。验完即可删除。
 *
 * 跑法（你需要先备好凭据）：
 *   1. 建一个空测试服务器，把 bot（勾 Administrator）拉进去，开 Message Content Intent。
 *   2. 在 .env 里放：
 *        CLAUDE_CODE_OAUTH_TOKEN=...   # 或 ANTHROPIC_API_KEY=...
 *        DISCORD_BOT_TOKEN=...
 *        DISCORD_GUILD_ID=...          # 测试服务器的 guild id
 *   3. node --env-file=.env --import tsx scripts/spike-concierge-provision.ts
 *
 * Decision gate（结论记进 issue #23）：
 *   ✅ 建频道+webhook+写读 topic 全通 → 按 plan 继续 #28。
 *   ❌ Admin 建频道/webhook 受阻 → 退「半自动」（人工建 category，bot 只建 webhook+写 topic）。
 *   ❌ topic 不适合存元数据 → 退「外部注册表」（ADR-0011 备选）。
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createRealDiscordAdmin } from "../src/adapters/discord/real-discord-admin.js";
import { createDiscordAdminMcpServer } from "../src/adapters/agent-sdk/discord-admin-mcp.js";
import { buildConciergePrompt } from "../src/adapters/agent-sdk/concierge-prompt.js";
import { parseTopic } from "../src/adapters/discord/channel-routing.js";
import type { DiscordAdminPort } from "../src/ports/discord-admin.js";

function need(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`[spike] missing required env: ${key}`);
    process.exit(2);
  }
  return v;
}

const botToken = need("DISCORD_BOT_TOKEN");
const guildId = need("DISCORD_GUILD_ID");
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
  console.error("[spike] need CLAUDE_CODE_OAUTH_TOKEN (preferred) or ANTHROPIC_API_KEY");
  process.exit(2);
}
console.log(
  `[spike] auth = ${process.env.CLAUDE_CODE_OAUTH_TOKEN ? "subscription (CLAUDE_CODE_OAUTH_TOKEN)" : "api-key (ANTHROPIC_API_KEY)"}`,
);

const real = await createRealDiscordAdmin({ botToken, guildId });

// Recording decorator: capture the live ids/topics the concierge creates so we
// can independently read them back after the query finishes.
const created = {
  categories: [] as string[],
  channels: [] as string[],
  webhooks: [] as string[],
  topics: [] as Array<{ channelId: string; topic: string }>,
};
const recording: DiscordAdminPort = {
  async createCategory(name) {
    const id = await real.createCategory(name);
    created.categories.push(id);
    console.log(`[admin] category "${name}" -> ${id}`);
    return id;
  },
  async createTextChannel(categoryId, name) {
    const id = await real.createTextChannel(categoryId, name);
    created.channels.push(id);
    console.log(`[admin] text channel "${name}" under ${categoryId} -> ${id}`);
    return id;
  },
  async createWebhook(channelId, name) {
    const url = await real.createWebhook(channelId, name);
    created.webhooks.push(url);
    console.log(`[admin] webhook "${name}" on ${channelId} -> ${url.slice(0, 48)}...`);
    return url;
  },
  async createThread(channelId, name) {
    const id = await real.createThread(channelId, name);
    console.log(`[admin] thread "${name}" on ${channelId} -> ${id}`);
    return id;
  },
  async setChannelTopic(channelId, topic) {
    await real.setChannelTopic(channelId, topic);
    created.topics.push({ channelId, topic });
    console.log(`[admin] set topic on ${channelId}: ${topic}`);
  },
};

// Single-shot, fully-specified seed + explicit "already confirmed, build now" so
// the non-interactive concierge proceeds straight to the tool calls.
const PROMPT = [
  "我想跑一场团，叫《凡达林的矿坑》。下面四个字段都给你了，已确认，不要再反问我、也不要等我点头，立刻建团：",
  "- premise=凡达林的矿坑深处封着一段远古的恶",
  "- tone=克系恐怖",
  "- desiredClimax=以代价重铸封印，阻止恶的苏醒",
  "- levelBand=[1,5]",
  "按你的流程依次调用：create_category → create_text_channel → create_webhook → set_channel_topic（topic 用 role=aidm 的路由指针），最后发一条交接提示即可。",
].join("\n");

const ADMIN_TOOLS = [
  "create_category",
  "create_text_channel",
  "create_webhook",
  "create_thread",
  "set_channel_topic",
].map((t) => `mcp__discord-admin__${t}`);

console.log("=== concierge query starting ===");
for await (const msg of query({
  prompt: PROMPT,
  options: {
    systemPrompt: buildConciergePrompt(),
    mcpServers: { "discord-admin": createDiscordAdminMcpServer(recording) },
    allowedTools: ADMIN_TOOLS,
    permissionMode: "bypassPermissions",
  },
}) as AsyncIterable<{
  type: string;
  message?: { content?: Array<{ type: string; text?: string }> };
}>) {
  if (msg.type === "assistant") {
    for (const block of msg.message?.content ?? []) {
      if (block.type === "text" && block.text) console.log(`[concierge] ${block.text}`);
    }
  }
}
console.log("=== concierge query done ===");

// Independent readback: fetch the live channel topic from Discord (fresh client)
// and parse it — proves the pointer is really ON Discord and round-trips.
const { Client, GatewayIntentBits } = await import("discord.js");
const reader = new Client({ intents: [GatewayIntentBits.Guilds] });
await reader.login(botToken);

let routingOk = created.channels.length > 0;
for (const channelId of created.channels) {
  const channel = await reader.channels.fetch(channelId);
  const liveTopic =
    channel !== null && "topic" in channel ? ((channel as { topic: string | null }).topic ?? null) : null;
  const routing = parseTopic(liveTopic);
  console.log(
    `[readback] channel ${channelId}: live topic = ${JSON.stringify(liveTopic)} -> parsed = ${JSON.stringify(routing)}`,
  );
  if (routing === null || routing.role !== "aidm") routingOk = false;
}
await reader.destroy();

const pass =
  created.categories.length > 0 &&
  created.channels.length > 0 &&
  created.webhooks.length > 0 &&
  routingOk;

console.log(
  pass
    ? "✅ SPIKE PASS — concierge 经 MCP 工具建出 category+频道+webhook，live topic 读回解析为 role=aidm；订阅鉴权与 Admin 建团均通。"
    : "❌ SPIKE FAIL — 见上方日志定位是建团哪一步、还是 topic 读回/解析出了问题（对照 Decision gate 选回退方案）。",
);
process.exit(pass ? 0 : 1);
