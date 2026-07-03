/**
 * live-realdm.ts — REAL DM path diagnostic. Same real engine + real NPC LLMs +
 * real Discord + dice as live-game.ts, BUT the DM is the REAL self-driving
 * `dmQueryStream` LLM (calls narrate/nominate/call_check MCP tools), not a script.
 * This isolates the original live bug ("完全没消息"): does the real DM agent, given
 * the #52 nominate tool + prompt, actually narrate + nominate + drive the table?
 * Every DM + NPC message (thinking / prose / tool-use / tool-result) is traced —
 * both to the human step-trace AND through the production FileTraceSink
 * (data/traces/realdm-acceptance/<runId>.{jsonl,md}), so a run also exercises the
 * real persistence path. Dice = BCDice (ADR-0013 production path), so the check
 * loop is judged by the same mechanical engine as `npm start`.
 *
 *   node --env-file=.env --import tsx scripts/live-realdm.ts
 */
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildRuntimeConfig } from "../src/runtime/config.js";
import { actorId as A, sceneId as S, type ActorId } from "../src/domain/ids.js";
import { Referee } from "../src/engine/referee.js";
import { createWebhookPostingClient } from "../src/adapters/discord/create-real-discord.js";
import { createBotPool } from "../src/adapters/discord/bot-pool.js";
import { MultiBotSubstrate } from "../src/adapters/discord/multi-bot-substrate.js";
import { AgentNpc } from "../src/adapters/agent-sdk/agent-npc.js";
import { npcGenerate, dmQueryStream } from "../src/adapters/agent-sdk/sdk-runner.js";
import { withTimeoutRetry, realClock } from "../src/adapters/agent-sdk/timeout-npc.js";
import { buildDmSystemPrompt } from "../src/adapters/agent-sdk/dm-prompt.js";
import { messageToTraceEvents } from "../src/adapters/agent-sdk/trace-tap.js";
import { assignNpcsToBots } from "../src/runtime/npc-bot-assignment.js";
import { BcdiceDice } from "../src/adapters/dice/bcdice-dice.js";
import { LibBcdiceEvaluator } from "../src/adapters/dice/bcdice-evaluator.js";
import { FileTraceSink } from "../src/adapters/trace/file-trace-sink.js";
import { FakeCardStore } from "../src/adapters/memory/fake-card-store.js";
import { createSoul, type Soul } from "../src/domain/soul.js";
import { buildNpcPersona } from "../src/runtime/aidm-cast.js";
import type { NpcPort } from "../src/ports/npc.js";
import type { ActorPersona } from "../src/adapters/discord/scene-threads.js";
import type { CharacterSheet } from "../src/ports/card-store.js";
import type { CampaignBible } from "../src/domain/campaign.js";
import type { TraceEvent } from "../src/ports/trace-sink.js";

const AIDM = A("aidm");
const ZHOU = A("npc-zhoushen");
const TIE = A("npc-tiequan");
const LIN = A("npc-linxuan");
const NPCS = [ZHOU, TIE, LIN] as const;
const NAME: Record<string, string> = { [ZHOU]: "周慎", [TIE]: "铁拳·冈", [LIN]: "林萱" };

const souls: Record<string, Soul> = {
  [ZHOU]: createSoul(ZHOU, { name: "周慎", temperament: "谨慎多疑的私家侦探，说话简短", goals: ["查清古籍来历"] }),
  [TIE]: createSoul(TIE, { name: "铁拳·冈", temperament: "鲁莽护短的退伍拳手", goals: ["保护同伴"] }),
  [LIN]: createSoul(LIN, { name: "林萱", temperament: "冷静细致的女医师", goals: ["不让无辜枉死"] }),
};
const sheets: Record<string, CharacterSheet> = {
  [ZHOU]: { system: "coc7", skills: { 侦查: 70, 图书馆: 65, 聆听: 55, 心理学: 50 } },
  [TIE]: { system: "coc7", skills: { 侦查: 35, 斗殴: 65, 聆听: 45, 恐吓: 60 } },
  [LIN]: { system: "coc7", skills: { 医学: 60, 急救: 70, 侦查: 45, 心理学: 60 } },
};
const NAME_TO_ID: Array<[string, ActorId]> = [["周慎", ZHOU], ["铁拳·冈", TIE], ["铁拳", TIE], ["林萱", LIN]];
const mentionsOf = (prose: string, speaker: ActorId): ActorId[] => {
  const hits = new Set<ActorId>();
  for (const [n, id] of NAME_TO_ID) if (id !== speaker && prose.includes(n)) hits.add(id);
  return [...hits];
};

const stamp = `${Date.now()}`;
const runId = `realdm-${stamp}`;
const outDir = join("data", "headless");
mkdirSync(outDir, { recursive: true });
// Production persistence path — the same FileTraceSink `npm start` wires, so this
// run doubles as an acceptance of the trace-留存 loop (JSONL for the eval harness,
// md for eyeballs).
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
  const scene = S(channelId);
  step(`🟢 频道 #${channel.name} (${channelId})`);

  const webhook = await createWebhookPostingClient(cfg.botToken);
  const pool = await createBotPool(cfg.botPoolTokens);
  step(`🟢 池 ${pool.length} bots\n`);

  const personas: ActorPersona[] = [
    { actorId: AIDM, username: "地下城主" },
    { actorId: ZHOU, username: "周慎" },
    { actorId: TIE, username: "铁拳·冈" },
    { actorId: LIN, username: "林萱" },
  ];
  const { assignments } = assignNpcsToBots([...NPCS], pool.length);
  const botByActor = new Map<string, (typeof pool)[number]>();
  for (const id of NPCS) {
    const idx = assignments.get(id);
    if (idx === undefined) continue;
    botByActor.set(id, pool[idx]!);
    await pool[idx]!.setNickname(cfg.guildId, NAME[id]!).catch(() => {});
  }
  const substrate = new MultiBotSubstrate({
    webhook,
    personas,
    threadMap: { [scene]: channelId },
    botFor: (a) => botByActor.get(a),
    onError: (w, e) => step(`⚠ ${w}: ${String(e)}`),
  });

  const cards = new FakeCardStore(sheets);
  const dice = new BcdiceDice(cards, new LibBcdiceEvaluator());

  const bible: CampaignBible = {
    secretTruth: "黑皮书是邪典；偷书人是曹德远昔日学徒，已被书侵蚀。",
    system: "coc7",
    tone: "克系恐怖",
    levelBand: [1, 1],
    milestones: [
      { id: "m1", goal: "勘验委托人的物证", enterCue: "白鹤阁茶馆密谈：失窃的无名黑皮书+暴毙书童", scenes: [scene], triggers: [], branchPoints: [] },
      { id: "m2", goal: "查验书童尸体", enterCue: "停尸间", scenes: [scene], triggers: [], branchPoints: [] },
      { id: "m3", goal: "勘查被破的书房暗格", enterCue: "曹宅书房", scenes: [scene], triggers: [], branchPoints: [] },
    ],
    npcs: [],
    worldClocks: [],
    bespokeRules: {},
  };

  const hold: { ref?: Referee } = {};
  const makeNpc = (soul: Soul): NpcPort => {
    const persona = `${buildNpcPersona(soul)}\n（1923上海克系调查团，与另两名调查员并肩。回应简短一两句。）`;
    const label = `npc:${soul.personaCore.name}`;
    const tap = (message: unknown): void => {
      for (const ev of messageToTraceEvents(label, runId, message)) sink.record(ev);
    };
    const gen = withTimeoutRetry((p) => npcGenerate(p, tap), { timeoutMs: 60_000, maxAttempts: 2, totalBudgetMs: 130_000 }, realClock);
    const base = new AgentNpc({ persona, generate: gen });
    return {
      takeTurn: async (ctx) =>
        hold.ref?.pendingCheckFor(ctx.actorId) !== undefined ? { kind: "roll" } : base.takeTurn(ctx),
    };
  };
  const ports: Record<string, NpcPort> = { [ZHOU]: makeNpc(souls[ZHOU]!), [TIE]: makeNpc(souls[TIE]!), [LIN]: makeNpc(souls[LIN]!) };

  const ref = new Referee({
    aidmId: AIDM,
    substrate,
    dice,
    cards,
    npcFor: (a) => ports[a],
    presentActors: [...NPCS],
    mentionsOf,
    campaign: bible,
  });
  hold.ref = ref;

  const systemPrompt = buildDmSystemPrompt({
    brief: `${bible.secretTruth}\n【开局】${bible.milestones[0]!.enterCue}\n这桌有 3 名 AI 调查员、没有真人。逐个点名推进这桩调查，循里程碑走，把每个人都点到。`,
    sceneId: channelId,
    cast: NPCS.map((id) => ({ actorId: id, role: "npc" as const })),
  });

  step(`\n===== 启动真 DM query =====`);
  const deadline = Date.now() + 6 * 60_000;
  let msgs = 0;
  try {
    for await (const msg of dmQueryStream(ref, systemPrompt)) {
      msgs += 1;
      for (const ev of messageToTraceEvents("aidm", runId, msg)) {
        sink.record(ev);
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
  step(`\nDM stream 消息数=${msgs}；里程碑游标=${ref.cursorState()?.currentMilestone ?? "<done>"}`);

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
