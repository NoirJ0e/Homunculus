/**
 * live-combat.ts — #46 战斗轮 live 预验（无人值守可验部分）。
 *
 * The one AC never yet exercised live: combat resolved by BCDice. This drives the
 * REAL engine + REAL NPC LLMs + REAL Discord (pool bots) through a D&D5e skirmish
 * where the DM playbook calls `call_check(mode:"attack")` — the engine merges the
 * pending check into a RollRequest and BCDice (DungeonsAndDragons5) judges it via
 * `AT±mod>=AC` (ability mod + proficiency folded in). One AR perception check and
 * two AT attacks at different ACs, across full nominate rounds (round invariant
 * holds). The HITL rest of #46 (真人 /check、pause/resume、一坐到尾) stays human.
 *
 *   node --env-file=.env --import tsx scripts/live-combat.ts
 */
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildRuntimeConfig } from "../src/runtime/config.js";
import { actorId as A, campaignId, sceneId as S, type ActorId } from "../src/domain/ids.js";
import { assembleTable } from "../src/runtime/table-assembly.js";
import { createWebhookPostingClient } from "../src/adapters/discord/create-real-discord.js";
import { createBotPool } from "../src/adapters/discord/bot-pool.js";
import { BcdiceDice } from "../src/adapters/dice/bcdice-dice.js";
import { LibBcdiceEvaluator } from "../src/adapters/dice/bcdice-evaluator.js";
import { FakeCardStore } from "../src/adapters/memory/fake-card-store.js";
import { createSoul, type Soul } from "../src/domain/soul.js";
import type { CharacterSheet } from "../src/ports/card-store.js";
import type { CampaignBible } from "../src/domain/campaign.js";

const AIDM = A("aidm");
const BROM = A("npc-brom");
const KIRA = A("npc-kira");
const NPCS = [BROM, KIRA] as const;
const NAME: Record<string, string> = { [BROM]: "布罗姆", [KIRA]: "凯拉", [AIDM]: "地下城主" };

const souls: Record<string, Soul> = {
  [BROM]: createSoul(BROM, {
    name: "布罗姆",
    temperament: "沉默寡言的老雇佣兵战士，靠盾墙和直觉活过三场战争；先护同伴再挥剑。低魔奇幻世界雇佣兵二人组之一，正在地窖遭遇战中，回应简短一两句",
    goals: ["把这趟护送活干完，谁都别死"],
  }),
  [KIRA]: createSoul(KIRA, {
    name: "凯拉",
    temperament: "机敏毒舌的精灵游侠，眼睛比谁都尖；嘴上嫌弃布罗姆，箭永远补在他身侧。低魔奇幻世界雇佣兵二人组之一，正在地窖遭遇战中，回应简短一两句",
    goals: ["活着，并且比布罗姆先发现危险"],
  }),
};

const sheets: Record<string, CharacterSheet> = {
  [BROM]: {
    system: "dnd5e",
    skills: {},
    attributes: { 力量: 16, 敏捷: 10, 体质: 14, 智力: 8, 感知: 12, 魅力: 10 },
    race: "人类",
    characterClass: "战士",
    level: 3,
    proficiencies: ["攻击", "运动", "体质豁免"],
  },
  [KIRA]: {
    system: "dnd5e",
    skills: {},
    attributes: { 力量: 10, 敏捷: 16, 体质: 12, 智力: 12, 感知: 14, 魅力: 10 },
    race: "精灵",
    characterClass: "游侠",
    level: 3,
    proficiencies: ["察觉", "潜行", "敏捷豁免"],
  },
};


const stamp = `${Date.now()}`;
const outDir = join("data", "headless");
mkdirSync(outDir, { recursive: true });
const mdPath = join(outDir, `combat-${stamp}.md`);
const trunc = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);
function step(line: string): void {
  appendFileSync(mdPath, `${line}\n`, "utf8");
  console.log(line);
}

async function main(): Promise<void> {
  const cfg = buildRuntimeConfig(process.env);
  step(`# D&D5e 战斗轮 live 预验（#46 无人值守部分） — ${new Date().toISOString()}`);
  step(`pool=${cfg.botPoolTokens.length} bots · guild=${cfg.guildId}\n`);

  const mainClient = new Client({ intents: [GatewayIntentBits.Guilds] });
  await mainClient.login(cfg.botToken);
  const guild = await mainClient.guilds.fetch(cfg.guildId);
  const channel = await guild.channels.create({
    name: `地窖遭遇战-${stamp}`,
    type: ChannelType.GuildText,
  });
  const channelId = channel.id;
  const scene = S(channelId);
  step(`🟢 频道 #${channel.name} (${channelId})`);

  const webhook = await createWebhookPostingClient(cfg.botToken);
  const pool = await createBotPool(cfg.botPoolTokens);
  step(`🟢 池 ${pool.length} bots\n`);

  const cards = new FakeCardStore(sheets);
  // The whole point of this run: combat judged by the PRODUCTION BCDice engine
  // (DungeonsAndDragons5 `AT±mod>=AC`), never before exercised live.
  const dice = new BcdiceDice(cards, new LibBcdiceEvaluator());

  const bible: CampaignBible = {
    secretTruth: "地窖下的食尸鬼是被走私商人囚养的看门畜，笼锁早已锈穿。",
    system: "dnd5e",
    tone: "低魔奇幻冒险",
    levelBand: [3, 3],
    milestones: [
      { id: "m1", goal: "察觉伏击", enterCue: "商队地窖取货", scenes: [scene], triggers: [], branchPoints: [] },
      { id: "m2", goal: "击退第一只食尸鬼", enterCue: "接战", scenes: [scene], triggers: [], branchPoints: [] },
      { id: "m3", goal: "解决第二只食尸鬼", enterCue: "收尾", scenes: [scene], triggers: [], branchPoints: [] },
    ],
    npcs: [],
    worldClocks: [],
    bespokeRules: {},
  };

  // arch-C1: the table comes from the PRODUCTION assembleTable recipe.
  const table = assembleTable({
    scene,
    channelId,
    campaign: campaignId("cellar-combat"),
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
    onError: (w, e) => step(`⚠ ${w}: ${String(e)}`),
  });
  const ref = table.referee;
  step(`🟢 牌桌装配完成（生产 assembleTable 路径）：${table.teammates.map((t) => t.personaCore.name).join("、")}`);

  // ── DM playbook helpers（每步双写 step-trace） ──────────────────────────────
  const narrate = async (text: string): Promise<void> => {
    step(`\n### 🎙️ DM 叙事\n${text}`);
    await ref.narrate(scene, text);
  };
  const callCheck = async (
    actor: ActorId,
    skill: string,
    diff: string,
    mode?: "check" | "attack",
  ): Promise<void> => {
    step(`🎲 DM 喊${mode === "attack" ? "攻击" : "检定"} → ${NAME[actor]} 掷「${skill}」vs ${diff}`);
    await ref.callCheck(actor, skill, diff, mode);
  };
  const nominate = async (actor: ActorId, cue: string) => {
    const r = await ref.nominate(scene, actor, cue);
    const remaining = (r as { remaining: readonly ActorId[] }).remaining ?? [];
    const left = `剩余[${remaining.map((a) => NAME[a]).join(",")}]`;
    if (r.kind === "acted") step(`▶ 点名 ${NAME[actor]} → 发言：${trunc(r.prose)}  · ${left}`);
    else if (r.kind === "passed") step(`▶ 点名 ${NAME[actor]} → 过 · ${left}`);
    else if (r.kind === "checked")
      step(`▶ 点名 ${NAME[actor]} → 🎲「${r.skill}」：${r.detail} ⇒ ${r.success ? "✅" : "❌"} (total=${r.total}) · ${left}`);
    else if (r.kind === "held") step(`▶ 点名 ${NAME[actor]} → 挂起 · ${left}`);
    else step(`▶ 点名 ${NAME[actor]} → 拒绝(${(r as { reason: string }).reason}) · ${left}`);
    return r;
  };
  const advance = (): void => {
    ref.advanceMilestone();
    step(`✅ 推进里程碑 → 当前：${ref.cursorState()?.currentMilestone ?? "<战斗结束>"}`);
  };

  // ── 一场地窖遭遇战：AR 察觉 ×1 + AT 攻击 ×2（AC 13 / 15） ────────────────────
  const results: Array<{ label: string; detail: string; success: boolean }> = [];
  const record = (label: string, r: Awaited<ReturnType<typeof nominate>>): void => {
    if (r.kind === "checked") results.push({ label, detail: r.detail, success: r.success });
  };

  step(`\n══════════ 轮 1/3：伏击预警（AR 察觉检定） ══════════`);
  await narrate(
    "湿冷的地窖里只有你们的火把在响。货箱后的阴影动了一下——不是老鼠的动静。凯拉，你的耳朵先竖了起来。",
  );
  await callCheck(KIRA, "察觉", "12");
  const r1 = await nominate(KIRA, "凯拉，那阵窸窣声不对劲——掷个察觉，看你能不能在它扑出来之前锁定它。");
  record("AR 察觉 vs DC12", r1);
  await nominate(BROM, "布罗姆，凯拉的手势你看见了——你的盾和剑作何反应？");
  const spotted = r1.kind === "checked" && r1.success;
  await narrate(
    spotted
      ? "凯拉的箭已经搭上弦——两只灰皮食尸鬼的轮廓在她眼里纤毫毕现：一只蹲在货箱顶，一只正贴着墙根爬向布罗姆的侧翼。伏击破产了。"
      : "阴影里的东西快过凯拉的眼睛——两只灰皮食尸鬼同时从货箱两侧扑出，爪子带着腐肉的恶臭直取二人面门！",
  );
  advance();

  step(`\n══════════ 轮 2/3：接战（AT 攻击 vs AC 13） ══════════`);
  await callCheck(BROM, "攻击", "13", "attack");
  const r2 = await nominate(BROM, "布罗姆，墙根那只已经进了你的剑距——挥剑，攻击它！（AC 13）");
  record("AT 攻击 vs AC13", r2);
  await nominate(KIRA, "凯拉，布罗姆缠住了一只——你的箭口和站位怎么调整？");
  const hit1 = r2.kind === "checked" && r2.success;
  await narrate(
    hit1
      ? "布罗姆的长剑从盾沿上方劈下，正中食尸鬼的锁骨——灰皮迸裂，它惨嚎着缩回货箱后，拖出一道黑血。"
      : "食尸鬼贴地一滚，布罗姆的剑锋擦着它的脊背劈进土里——它反手一爪抓在盾面上，火星四溅。",
  );
  advance();

  step(`\n══════════ 轮 3/3：收尾（AT 攻击 vs AC 15，负伤的它更警觉了） ══════════`);
  await callCheck(BROM, "攻击", "15", "attack");
  const r3 = await nominate(BROM, "布罗姆，它绕着货箱和你兜圈，出手窗口更小了——再攻！（AC 15）");
  record("AT 攻击 vs AC15", r3);
  await nominate(KIRA, "凯拉，箱顶那只正要跃向布罗姆的后背——你怎么做？");
  const hit2 = r3.kind === "checked" && r3.success;
  await narrate(
    hit2
      ? "这一剑布罗姆等了整整一圈——食尸鬼跃起的瞬间，剑尖从它下颌穿入。它抽搐着钉在货箱上，不动了。凯拉的箭同时把箱顶那只射了个对穿。地窖安静下来，只剩火把的噼啪声。"
      : "布罗姆的剑再次落空，但凯拉的箭救了场——箱顶那只被射穿咽喉摔下来砸中同伴，两只食尸鬼哀嚎着退进地窖深处的裂缝。货是保住了。",
  );
  advance();

  step(`\n══════════ 结算汇总 ══════════`);
  for (const r of results) step(`- ${r.label}：${r.detail} ⇒ ${r.success ? "✅" : "❌"}`);
  step(`\n里程碑游标：${ref.cursorState()?.currentMilestone ?? "<全部完成>"}`);
  const atCount = results.filter((r) => r.detail.startsWith("AT")).length;
  step(
    atCount === 2 && results.length === 3
      ? `\n✅ 战斗轮 live 预验完成：BCDice DungeonsAndDragons5 真结算 — AR 检定 ×1 + AT 攻击 ×2 全部经真实链路（引擎 pending→roll→BCDice→叙事→Discord）。`
      : `\n⚠ 结算数不符预期（期望 AR×1+AT×2，实得 ${results.length} 条，AT×${atCount}）——检查上方轨迹。`,
  );

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
