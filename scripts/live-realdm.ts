/**
 * live-realdm.ts — REAL DM path diagnostic. Same real engine + real NPC LLMs +
 * real Discord + dice as live-game.ts, BUT the DM is the REAL self-driving
 * `dmQueryStream` LLM (calls narrate/nominate/call_check MCP tools), not a script.
 * This isolates the original live bug ("完全没消息"): does the real DM agent, given
 * the #52 nominate tool + prompt, actually narrate + nominate + drive the table?
 *
 * arch-C1: the table itself comes from the PRODUCTION `assembleTable` recipe —
 * this script provisions the channel/pool, hands in in-memory stores, and drives
 * the DM query. A diagnostic run therefore exercises the exact production wiring
 * (per-NPC agents + trace taps + bot-pool substrate + Referee + DM prompt),
 * FileTraceSink persistence (data/traces/realdm-acceptance/) and BCDice included.
 *
 *   node --env-file=.env --import tsx scripts/live-realdm.ts
 */
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildRuntimeConfig } from "../src/runtime/config.js";
import { actorId as A, campaignId, sceneId as S } from "../src/domain/ids.js";
import { createWebhookPostingClient } from "../src/adapters/discord/create-real-discord.js";
import { createBotPool } from "../src/adapters/discord/bot-pool.js";
import { dmQueryStream } from "../src/adapters/agent-sdk/sdk-runner.js";
import { messageToTraceEvents } from "../src/adapters/agent-sdk/trace-tap.js";
import { assembleTable } from "../src/runtime/table-assembly.js";
import { BcdiceDice } from "../src/adapters/dice/bcdice-dice.js";
import { LibBcdiceEvaluator } from "../src/adapters/dice/bcdice-evaluator.js";
import { FileTraceSink } from "../src/adapters/trace/file-trace-sink.js";
import { FakeCardStore } from "../src/adapters/memory/fake-card-store.js";
import { createSoul, type Soul } from "../src/domain/soul.js";
import type { RosterStore } from "../src/ports/roster-store.js";
import type { SoulStore } from "../src/ports/soul-store.js";
import type { CharacterSheet } from "../src/ports/card-store.js";
import type { CampaignBible } from "../src/domain/campaign.js";
import type { TraceEvent } from "../src/ports/trace-sink.js";

const ZHOU = A("npc-zhoushen");
const TIE = A("npc-tiequan");
const LIN = A("npc-linxuan");
const NPCS = [ZHOU, TIE, LIN] as const;

// The cast, as data: the assembly reads roster + souls exactly like production
// reads its file stores. The "回应简短" table etiquette lives on the soul.
const souls: Record<string, Soul> = {
  [ZHOU]: createSoul(ZHOU, { name: "周慎", temperament: "谨慎多疑的私家侦探，说话简短；1923 上海克系调查团成员，回应简短一两句", goals: ["查清古籍来历"] }),
  [TIE]: createSoul(TIE, { name: "铁拳·冈", temperament: "鲁莽护短的退伍拳手；1923 上海克系调查团成员，回应简短一两句", goals: ["保护同伴"] }),
  [LIN]: createSoul(LIN, { name: "林萱", temperament: "冷静细致的女医师；1923 上海克系调查团成员，回应简短一两句", goals: ["不让无辜枉死"] }),
};
const sheets: Record<string, CharacterSheet> = {
  [ZHOU]: { system: "coc7", skills: { 侦查: 70, 图书馆: 65, 聆听: 55, 心理学: 50 } },
  [TIE]: { system: "coc7", skills: { 侦查: 35, 斗殴: 65, 聆听: 45, 恐吓: 60 } },
  [LIN]: { system: "coc7", skills: { 医学: 60, 急救: 70, 侦查: 45, 心理学: 60 } },
};
const rosterStore: RosterStore = {
  get: () => NPCS.map((id) => ({ actorId: id, kind: "ai" as const, approved: true })),
  set() {},
  markApproved() {},
};
const soulStore: SoulStore = { load: (id) => souls[id], save() {} };

const stamp = `${Date.now()}`;
const runId = `realdm-${stamp}`;
const outDir = join("data", "headless");
mkdirSync(outDir, { recursive: true });
// Production persistence path — the same FileTraceSink `npm start` wires, so this
// run doubles as an acceptance of the trace-留存 loop.
const sink = new FileTraceSink("data", "realdm-acceptance", runId);
const mdPath = join(outDir, `${runId}.md`);
const trunc = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);
function step(line: string): void {
  appendFileSync(mdPath, `${line}\n`, "utf8");
  console.log(line);
}
function renderEv(ev: TraceEvent): string {
  switch (ev.kind) {
    case "thinking": return `> 🧠 ${trunc(ev.text)}`;
    case "text": return `🗣️ DM: ${trunc(ev.text)}`;
    case "tool-use": return `🔧 ${ev.tool}(${trunc(JSON.stringify(ev.args), 200)})`;
    case "tool-result": return `↩️ ${trunc(ev.result, 300)}`;
    case "error": return `💥 ${ev.error}`;
    default: return "";
  }
}

async function main(): Promise<void> {
  const cfg = buildRuntimeConfig(process.env);
  step(`# 真DM live 诊断 — ${new Date().toISOString()}\npool=${cfg.botPoolTokens.length}\n`);

  const mainClient = new Client({ intents: [GatewayIntentBits.Guilds] });
  await mainClient.login(cfg.botToken);
  const guild = await mainClient.guilds.fetch(cfg.guildId);
  const channel = await guild.channels.create({ name: `失书录-realdm-${stamp}`, type: ChannelType.GuildText });
  const channelId = channel.id;
  step(`🟢 频道 #${channel.name} (${channelId})`);

  const webhook = await createWebhookPostingClient(cfg.botToken);
  const pool = await createBotPool(cfg.botPoolTokens);
  step(`🟢 池 ${pool.length} bots\n`);

  const bible: CampaignBible = {
    secretTruth: "黑皮书是邪典；偷书人是曹德远昔日学徒，已被书侵蚀。",
    system: "coc7",
    tone: "克系恐怖",
    levelBand: [1, 1],
    milestones: [
      { id: "m1", goal: "勘验委托人的物证", enterCue: "白鹤阁茶馆密谈：失窃的无名黑皮书+暴毙书童", scenes: [S(channelId)], triggers: [], branchPoints: [] },
      { id: "m2", goal: "查验书童尸体", enterCue: "停尸间", scenes: [S(channelId)], triggers: [], branchPoints: [] },
      { id: "m3", goal: "勘查被破的书房暗格", enterCue: "曹宅书房", scenes: [S(channelId)], triggers: [], branchPoints: [] },
    ],
    npcs: [],
    worldClocks: [],
    bespokeRules: {},
  };

  // The PRODUCTION opening recipe — per-NPC agents, trace taps, bot-pool
  // substrate, Referee, DM prompt — with this script only supplying the stores,
  // the channel, and the dice.
  const table = assembleTable({
    scene: S(channelId),
    channelId,
    campaign: campaignId("realdm"),
    rosterStore,
    soulStore,
    humanSeat: "none",
    webhook,
    botPool: pool,
    guildId: cfg.guildId,
    dice: new BcdiceDice(new FakeCardStore(sheets), new LibBcdiceEvaluator()),
    bible,
    npcTimeout: { timeoutMs: 60_000, maxAttempts: 2, totalBudgetMs: 130_000 },
    traceSink: sink,
    runId,
    onError: (w, e) => step(`⚠ ${w}: ${String(e)}`),
  });

  step(`\n===== 启动真 DM query =====`);
  const deadline = Date.now() + 6 * 60_000;
  const tapAidm = table.observe?.("aidm");
  let msgs = 0;
  try {
    for await (const msg of dmQueryStream(table.referee, table.systemPrompt)) {
      msgs += 1;
      tapAidm?.(msg);
      for (const ev of messageToTraceEvents("aidm", runId, msg)) {
        const r = renderEv(ev);
        if (r) step(r);
      }
      if (Date.now() > deadline) {
        step(`\n⏰ 6分钟到，停止观察（DM query 仍可继续）。`);
        break;
      }
    }
  } catch (e) {
    step(`\n💥 DM query 抛错：${(e as Error)?.stack ?? String(e)}`);
  }
  step(`\nDM stream 消息数=${msgs}；里程碑游标=${table.referee.cursorState()?.currentMilestone ?? "<done>"}`);

  try {
    const ch = await guild.channels.fetch(channelId);
    if (ch && "messages" in ch) {
      const m = await (ch as { messages: { fetch: (o: { limit: number }) => Promise<Map<string, unknown>> } }).messages.fetch({ limit: 100 });
      step(`📨 频道实际消息条数=${m.size}`);
    }
  } catch {
    /* ignore */
  }
  mainClient.destroy();
  process.exit(0);
}
main().catch((e) => {
  step(`💥 ${e?.stack ?? String(e)}`);
  process.exit(1);
});
