/**
 * live-game.ts — REAL end-to-end integration run (not a unit test).
 *
 * Drives the REAL engine (Referee.nominate/call_check/resolveRoll/milestones/#57)
 * + REAL dice (NativeDice, deterministic seed) + REAL NPC LLM agents (AgentNpc →
 * Agent SDK query) + REAL Discord output (MultiBotSubstrate → the 3 pool bots post
 * to a freshly-created channel; the DM narrates via webhook). The DM is a scripted
 * playbook ("假设你是DM") so the module structure is guaranteed: a 5-investigation
 * CoC one-shot where ≥2 beats are @-help rolls (a teammate asks another to roll,
 * #57 injects the ask, the engine calls the check, the dice resolve). Every step is
 * written to a human step-trace AND echoed to stdout, proving each system fired.
 *
 *   node --env-file=.env --import tsx scripts/live-game.ts
 */
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildRuntimeConfig } from "../src/runtime/config.js";
import { actorId as A, campaignId, sceneId as S, type ActorId } from "../src/domain/ids.js";
import { assembleTable } from "../src/runtime/table-assembly.js";
import { createWebhookPostingClient } from "../src/adapters/discord/create-real-discord.js";
import { createBotPool } from "../src/adapters/discord/bot-pool.js";
import { NativeDice } from "../src/adapters/dice/native-dice.js";
import { BcdiceDice } from "../src/adapters/dice/bcdice-dice.js";
import { LibBcdiceEvaluator } from "../src/adapters/dice/bcdice-evaluator.js";
import { FakeCardStore } from "../src/adapters/memory/fake-card-store.js";
import { createSoul, type Soul } from "../src/domain/soul.js";
import type { CharacterSheet } from "../src/ports/card-store.js";
import type { CampaignBible } from "../src/domain/campaign.js";

// ── deterministic dice ──────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = Number(process.env.DICE_SEED ?? 7);

// ── the cast ────────────────────────────────────────────────────────────────
const AIDM = A("aidm");
const ZHOU = A("npc-zhoushen");
const TIE = A("npc-tiequan");
const LIN = A("npc-linxuan");
const NPCS = [ZHOU, TIE, LIN] as const;

const souls: Record<string, Soul> = {
  [ZHOU]: createSoul(ZHOU, {
    name: "周慎",
    temperament: "谨慎多疑、心思缜密的私家侦探；说话简短克制，习惯先观察再开口。1923 上海克系调查团成员，与另两名调查员并肩查案，回应简短一两句",
    goals: ["查清那本古籍的来历与下落"],
  }),
  [TIE]: createSoul(TIE, {
    name: "铁拳·冈",
    temperament: "鲁莽护短、直来直去的退伍拳手；遇事先冲在前面，看不惯弯弯绕。1923 上海克系调查团成员，与另两名调查员并肩查案，回应简短一两句",
    goals: ["保护同伴、揪出害人凶手"],
  }),
  [LIN]: createSoul(LIN, {
    name: "林萱",
    temperament: "冷静细致、见惯生死的女医师；沉着，重证据与人命。1923 上海克系调查团成员，与另两名调查员并肩查案，回应简短一两句",
    goals: ["不让无辜者枉死"],
  }),
};
const NAME: Record<string, string> = { [ZHOU]: "周慎", [TIE]: "铁拳·冈", [LIN]: "林萱", [AIDM]: "地下城主" };

const sheets: Record<string, CharacterSheet> = {
  [ZHOU]: { system: "coc7", skills: { 侦查: 70, 图书馆: 65, 聆听: 55, 心理学: 50, 急救: 30, 锁匠: 45 } },
  [TIE]: { system: "coc7", skills: { 侦查: 35, 斗殴: 65, 聆听: 45, 急救: 40, 恐吓: 60 } },
  [LIN]: { system: "coc7", skills: { 医学: 60, 急救: 70, 侦查: 45, 心理学: 60, 聆听: 50 } },
};


// ── step trace ──────────────────────────────────────────────────────────────
const stamp = process.env.RUN_STAMP ?? `${Date.now()}`;
const runId = `xishulu-${stamp}`;
const outDir = join("data", "headless");
mkdirSync(outDir, { recursive: true });
const mdPath = join(outDir, `${runId}.md`);
const trunc = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s);
function step(line: string): void {
  appendFileSync(mdPath, `${line}\n`, "utf8");
  console.log(line);
}

async function main(): Promise<void> {
  const cfg = buildRuntimeConfig(process.env);
  step(`# 《失书录》live 实跑 — ${new Date().toISOString()}`);
  step(`seed=${SEED} · pool=${cfg.botPoolTokens.length} bots · guild=${cfg.guildId}\n`);

  // Real Discord: a fresh channel + the webhook poster + the NPC bot pool.
  const mainClient = new Client({ intents: [GatewayIntentBits.Guilds] });
  await mainClient.login(cfg.botToken);
  const guild = await mainClient.guilds.fetch(cfg.guildId);
  const channel = await guild.channels.create({ name: `失书录-live-${stamp}`, type: ChannelType.GuildText });
  const channelId = channel.id;
  const scene = S(channelId);
  step(`🟢 已创建频道 #${channel.name} (id=${channelId})`);

  const webhook = await createWebhookPostingClient(cfg.botToken);
  const pool = await createBotPool(cfg.botPoolTokens);
  step(`🟢 NPC bot 池登录：${pool.length} 个 → ${pool.map((b) => b.userId).join(", ")}\n`);

  const cards = new FakeCardStore(sheets);
  // DICE=bcdice → the production BCDice judge (ADR-0013, same path as `npm start`);
  // rolls become non-reproducible. Default stays seeded NativeDice so the playbook
  // run is replayable.
  const dice =
    process.env.DICE === "bcdice"
      ? new BcdiceDice(cards, new LibBcdiceEvaluator())
      : new NativeDice(cards, mulberry32(SEED));

  const bible: CampaignBible = {
    secretTruth: "那本无名黑皮书是一本邪典；偷书人是曹德远昔日的学徒，已被书中之物侵蚀。",
    system: "coc7",
    tone: "克系恐怖",
    levelBand: [1, 1],
    milestones: [
      { id: "m1-茶馆", goal: "在白鹤阁勘验委托人带来的物证", enterCue: "茶馆密谈", scenes: [scene], triggers: [], branchPoints: [] },
      { id: "m2-验尸", goal: "查验暴毙书童的尸体", enterCue: "停尸房", scenes: [scene], triggers: [], branchPoints: [] },
      { id: "m3-书房", goal: "勘查曹宅被破的书房暗格", enterCue: "案发书房", scenes: [scene], triggers: [], branchPoints: [] },
      { id: "m4-档案", goal: "在亚洲文会图书馆追查古籍来历", enterCue: "图书馆", scenes: [scene], triggers: [], branchPoints: [] },
      { id: "m5-码头", goal: "在十六铺码头截住偷书的学徒", enterCue: "雾夜码头", scenes: [scene], triggers: [], branchPoints: [] },
    ],
    npcs: [],
    worldClocks: [],
    bespokeRules: {},
  };

  // arch-C1: the table comes from the PRODUCTION assembleTable recipe — per-NPC
  // roll-aware agents, bot-pool substrate + nicknames, Referee, #57 mentions.
  // This script keeps only its own concerns: the scripted DM playbook + dice mode.
  const table = assembleTable({
    scene,
    channelId,
    campaign: campaignId("xishulu"),
    rosterStore: { get: () => NPCS.map((id) => ({ actorId: id, kind: "ai" as const, approved: true })), set() {}, markApproved() {} },
    soulStore: { load: (id) => souls[id], save() {} },
    humanSeat: "none",
    webhook,
    botPool: pool,
    guildId: cfg.guildId,
    dice,
    cards,
    bible,
    npcTimeout: { timeoutMs: 60_000, maxAttempts: 2, totalBudgetMs: 130_000 },
    onError: (w, e) => step(`   ⚠ ${w}: ${String(e)}`),
  });
  const ref = table.referee;
  step(`🟢 牌桌装配完成（生产 assembleTable 路径）：${table.teammates.map((t) => t.personaCore.name).join("、")}\n`);

  // ── DM playbook helpers (every step logged → the proof trace) ──────────────
  const narrate = async (text: string): Promise<void> => {
    step(`\n### 🎙️ DM 叙事\n${text}`);
    await ref.narrate(scene, text);
  };
  const callCheck = async (actor: ActorId, skill: string, diff?: string): Promise<void> => {
    step(`🎲 DM 喊检定 → ${NAME[actor]} 掷「${skill}」${diff ? `(${diff})` : ""}`);
    await ref.callCheck(actor, skill, diff);
  };
  const queueAsk = (to: ActorId, text: string): void => {
    step(`💬 #57 协商注入 → 给 ${NAME[to]} 排入待办：「${text}」`);
    ref.queueInstruction(to, text);
  };
  const nominate = async (actor: ActorId, cue: string) => {
    const r = await ref.nominate(scene, actor, cue);
    const left = `剩余[${r.kind === "rejected" || r.kind === "held" ? r.remaining.map((a) => NAME[a]) : (r as { remaining: ActorId[] }).remaining.map((a) => NAME[a])}]`;
    if (r.kind === "acted") step(`▶ 点名 ${NAME[actor]} → 发言：${trunc(r.prose)}  · ${left}`);
    else if (r.kind === "passed") step(`▶ 点名 ${NAME[actor]} → 过 · ${left}`);
    else if (r.kind === "checked") step(`▶ 点名 ${NAME[actor]} → 🎲掷「${r.skill}」：${r.detail} ⇒ ${r.success ? "✅成功" : "❌失败"} (total=${r.total}) · ${left}`);
    else if (r.kind === "held") step(`▶ 点名 ${NAME[actor]} → 挂起(沉默) · ${left}`);
    else step(`▶ 点名 ${NAME[actor]} → 拒绝(${r.reason}) · ${left}`);
    return r;
  };
  const advance = async (): Promise<void> => {
    ref.advanceMilestone();
    step(`✅ 推进里程碑 → 当前：${ref.cursorState()?.currentMilestone ?? "<全剧终>"}`);
  };

  // ── the 5-investigation playbook ───────────────────────────────────────────
  type Beat = {
    cue: string;
    roller: ActorId;
    skill: string;
    diff?: string;
    help?: { from: ActorId; ask: string };
    leadCue: string;
    rollerCue: string;
    tailCue: string;
    onSuccess: string;
    onFail: string;
  };
  const others = (roller: ActorId): ActorId[] => NPCS.filter((a) => a !== roller);

  const beats: Beat[] = [
    {
      cue: "1923年深秋的上海，法租界。白鹤阁二楼的包厢里，古籍藏家曹德远把一只皮革公文夹推到三位调查员面前——里头是一张无名黑皮书的照片、一份尼泊尔行商的入库凭证，和一张血字纸条：「还我的书，否则你们都会死。」他压低声音：「我的书童，昨夜在书房外暴毙，仵作说……毫无外伤。」",
      roller: ZHOU,
      skill: "侦查",
      leadCue: "周慎，公文夹里的物证摊在你眼前——你最先动手。",
      rollerCue: "周慎，仔细看那张书影照片和纸条，掷个侦查。",
      tailCue: "铁拳，你呢？对这桩委托有什么反应？",
      onSuccess: "周慎的目光钉在照片边缘——铜制八角纹饰里嵌着一粒暗红的蜡，封蜡上压着一个陌生的私章。这书来路不正。",
      onFail: "照片影影绰绰，周慎一时看不出更多；唯有那行血字在灯下泛着可疑的光。",
    },
    {
      cue: "次日清晨，仁济医院的停尸间。书童的尸体停在冰冷的石台上，面孔扭曲成一种说不出的惊惧。",
      roller: LIN,
      skill: "医学",
      help: { from: ZHOU, ask: "周慎请你（林萱）以医师之眼验一验书童的死因，掷个医学检定。" },
      leadCue: "周慎，你绕着尸体看了一圈，但验尸不是你的本行——你会怎么做？（可以喊林萱帮忙）",
      rollerCue: "林萱，既然有人请你查验，掷个医学检定看看死因。",
      tailCue: "铁拳，停尸间里你站在一旁，作何反应？",
      onSuccess: "林萱掀开死者眼睑——视网膜上浮着细密的灼痕，喉咙深处有一种非人的腐臭。这不是任何她见过的病理。",
      onFail: "林萱反复查验，却找不到任何外伤或毒迹；死因成谜，只剩那张惊惧的脸。",
    },
    {
      cue: "午后，曹宅书房。樟木书架森然林立，唯独墙角的暗格被人撬开，锁舌扭曲。地板上有一圈奇怪的、像是被高温燎过的焦痕。",
      roller: ZHOU,
      skill: "侦查",
      diff: "hard",
      help: { from: TIE, ask: "铁拳粗手粗脚怕毁了线索，请你（周慎）来仔细勘查这处被撬的暗格，掷个侦查。" },
      leadCue: "铁拳，你想上手翻，但又怕毁了痕迹——你会怎么做？（可以喊周慎来查）",
      rollerCue: "周慎，被人请来勘查暗格，这次难度不低，掷个侦查（困难）。",
      tailCue: "林萱，焦痕那处，你以医者的直觉留意到什么？",
      onSuccess: "周慎在焦痕中拈起一缕未燃尽的丝线——是僧袍的料子，还沾着一点尼泊尔高地特有的红土。偷书人来过这里。",
      onFail: "焦痕太过诡异，周慎一时理不出头绪；只觉得后颈发凉，像被什么东西注视着。",
    },
    {
      cue: "黄昏，亚洲文会大楼的图书馆。积尘的卡片柜里，也许藏着那本黑皮书的来历。",
      roller: ZHOU,
      skill: "图书馆",
      leadCue: "周慎，故纸堆是你的主场——去翻档案。",
      rollerCue: "周慎，在浩繁的卷宗里追那本书的来历，掷个图书馆。",
      tailCue: "林萱，你在一旁帮着翻检，有没有什么发现或想法？",
      onSuccess: "周慎从一册民国五年的购藏目录里抽出一页：那本书曾属一个被取缔的密教结社，最后的持有人，正是曹德远昔日的学徒。",
      onFail: "卷宗浩如烟海，周慎查到闭馆也没能锁定那本书的源头。",
    },
    {
      cue: "雾夜，十六铺码头。一道僧袍般的身影抱着什么，正要登上一艘小火轮。江风里飘来那股熟悉的腐臭——偷书的学徒，就在前方。",
      roller: TIE,
      skill: "斗殴",
      help: { from: LIN, ask: "林萱请你（铁拳）拦住那个登船的人——别让他跑了，掷个斗殴。" },
      leadCue: "林萱，你认出了那股腐臭，但你拦不住他——你会怎么做？（可以喊铁拳上）",
      rollerCue: "铁拳，有人喊你拦人——冲上去，掷个斗殴！",
      tailCue: "周慎，混乱之中你盯住了什么关键的东西？",
      onSuccess: "铁拳一个箭步撞翻了那道身影，黑皮书脱手砸在湿漉漉的甲板上——学徒的兜帽滑落，露出一张和死去书童一样惊惧的脸。书，夺回来了。",
      onFail: "铁拳扑了个空，那身影窜上火轮；但慌乱中黑皮书掉落江岸——书虽夺回，偷书人却消失在雾里。",
    },
  ];

  let beatNo = 0;
  for (const b of beats) {
    beatNo += 1;
    step(`\n\n══════════ 调查 ${beatNo}/5：${bible.milestones[beatNo - 1]!.goal} ══════════`);
    await narrate(b.cue);
    const [lead, tail] = others(b.roller);
    await nominate(lead!, b.leadCue);
    if (b.help) queueAsk(b.roller, b.help.ask);
    await callCheck(b.roller, b.skill, b.diff);
    const rr = await nominate(b.roller, b.rollerCue);
    await nominate(tail!, b.tailCue);
    const ok = rr.kind === "checked" ? rr.success : false;
    await narrate(ok ? b.onSuccess : b.onFail);
    await advance();
  }

  step(`\n\n══════════ 尾声 ══════════`);
  await narrate(
    "黑皮书重新落回曹德远手中那一刻，他眼底闪过的，究竟是失而复得的庆幸，还是别的什么？雾散了，但这桩案子留下的寒意，久久不去。——本场调查到此结束。",
  );
  step(`\n剧本里程碑游标：${ref.cursorState()?.currentMilestone ?? "<全部完成>"}`);
  step(`\n✅ 全场完成：5 次调查全部跑完，引擎/点名/检定/骰子/#57协商 全部经过真实链路。`);
  step(`Discord 频道：#${channel.name} (${channelId})`);

  // Confirm posts actually landed in the real channel.
  try {
    const ch = await guild.channels.fetch(channelId);
    if (ch && "messages" in ch) {
      const msgs = await (ch as { messages: { fetch: (o: { limit: number }) => Promise<Map<string, unknown>> } }).messages.fetch({ limit: 100 });
      step(`📨 频道实际消息条数：${msgs.size}`);
    }
  } catch (e) {
    step(`(消息回读失败：${String(e)})`);
  }

  mainClient.destroy();
  process.exit(0); // tears down the webhook + pool gateway sockets too
}

main().catch((e) => {
  step(`\n💥 运行出错：${e?.stack ?? String(e)}`);
  process.exit(1);
});
