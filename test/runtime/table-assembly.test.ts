import { describe, expect, test } from "vitest";
import { assembleTable } from "../../src/runtime/table-assembly.js";
import { DiscordSubstrate } from "../../src/adapters/discord/discord-substrate.js";
import { MultiBotSubstrate } from "../../src/adapters/discord/multi-bot-substrate.js";
import { actorId, campaignId, sceneId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import type { SoulStore } from "../../src/ports/soul-store.js";
import type { DiscordClient, SentMessage } from "../../src/adapters/discord/discord-substrate.js";
import type { PoolBot } from "../../src/adapters/discord/bot-pool.js";
import type { TraceEvent } from "../../src/ports/trace-sink.js";

/** arch-C1 — the one table-opening recipe. These tests are the wiring's test
 *  surface: the exact assembly that used to live untested in runAidmQuery's
 *  closure (and drift-copied into every live script). */

const CAMP = campaignId("camp-1");
const SCENE = sceneId("chan-1");
const HUMAN = actorId("player");
const ZHOU = actorId("npc-zhoushen");
const TIE = actorId("npc-tiequan");

function stores(): { rosterStore: RosterStore; soulStore: SoulStore } {
  const souls = {
    [ZHOU]: createSoul(ZHOU, { name: "周慎", temperament: "谨慎" }),
    [TIE]: createSoul(TIE, { name: "铁拳·冈", temperament: "鲁莽" }),
  } as const;
  return {
    rosterStore: {
      get: () => [
        { actorId: HUMAN, kind: "human", approved: true, discordUserId: "111" },
        { actorId: ZHOU, kind: "ai", approved: true },
        { actorId: TIE, kind: "ai", approved: true },
      ],
      set() {},
      markApproved() {},
    },
    soulStore: { load: (id) => (souls as Record<string, ReturnType<typeof createSoul>>)[id], save() {} },
  };
}

function fakeWebhook(): { client: DiscordClient; posts: SentMessage[] } {
  const posts: SentMessage[] = [];
  return {
    client: {
      async sendWebhookMessage(_thread, msg) {
        posts.push(msg);
      },
      async fetchMessages() {
        return [];
      },
    },
    posts,
  };
}

function base(over: Partial<Parameters<typeof assembleTable>[0]> = {}) {
  return assembleTable({
    scene: SCENE,
    channelId: "chan-1",
    campaign: CAMP,
    ...stores(),
    webhook: fakeWebhook().client,
    generate: async () => "……",
    ...over,
  });
}

describe("assembleTable — 牌桌装配 deep module", () => {
  test("装配出完整牌桌：referee + 独立 NPC + 真名带 system 的 DM prompt", () => {
    const table = base();
    expect(table.teammates.map((t) => t.personaCore.name)).toEqual(["周慎", "铁拳·冈"]);
    expect(table.degraded).toBe(false);
    expect(table.humanId).toBe(HUMAN);
    // The prompt carries the cast by REAL name (#58) and the scene id.
    expect(table.systemPrompt).toContain("周慎");
    expect(table.systemPrompt).toContain("铁拳·冈");
    expect(table.systemPrompt).toContain("chan-1");
    expect(table.systemPrompt).toContain("真人玩家");
  });

  test("修生产断环：DM call_check 后，NPC 被点名的 takeTurn 返回 roll（不再只会 speak/pass）", async () => {
    const table = base();
    await table.referee.callCheck(ZHOU, "侦查");
    const turn = await tableNpc(table, ZHOU).takeTurn({
      sceneId: SCENE,
      actorId: ZHOU,
      transcript: [],
    });
    expect(turn).toEqual({ kind: "roll" });
  });

  test("无 pending 时 NPC 正常走 generate（speak）", async () => {
    const table = base({ generate: async () => "我观察四周。" });
    const npc = tableNpc(table, ZHOU);
    const turn = await npc.takeTurn({ sceneId: SCENE, actorId: ZHOU, transcript: [] });
    expect(turn).toEqual({ kind: "speak", prose: "我观察四周。" });
  });

  test("每 NPC 独立 port（#51 绝不共脑）", () => {
    const table = base();
    expect(tableNpc(table, ZHOU)).not.toBe(tableNpc(table, TIE));
  });

  test("无 bot 池 → 单 webhook substrate；有池 → MultiBotSubstrate 且设昵称", () => {
    expect(base().substrate).toBeInstanceOf(DiscordSubstrate);

    const nicknames: string[] = [];
    const bot: PoolBot = {
      userId: "bot-1",
      async setNickname(_guild: string, nick: string) {
        nicknames.push(nick);
      },
      async sendMessage() {},
    } as unknown as PoolBot;
    const pooled = base({ botPool: [bot], guildId: "g1" });
    expect(pooled.substrate).toBeInstanceOf(MultiBotSubstrate);
    expect(nicknames).toEqual(["周慎"]); // pool of 1 → first teammate bound, rest overflow
  });

  test('humanSeat:"none" 的全 AI 诊断桌：真人不在场（点名真人被拒）、prompt 无真人席', async () => {
    const table = base({ humanSeat: "none" });
    expect(table.humanId).toBeUndefined();
    expect(table.systemPrompt).not.toContain("真人玩家");
    const r = await table.referee.nominate(SCENE, HUMAN);
    expect(r.kind).toBe("rejected");
  });

  test("trace sink 提供时，NPC 的 generate 拿到 onMessage tap；不提供则拿不到", async () => {
    const taps: Array<unknown> = [];
    const events: TraceEvent[] = [];
    const traced = base({
      traceSink: { record: (e) => events.push(e) },
      runId: "t1",
      generate: async (_p, onMessage) => {
        taps.push(onMessage);
        return "x";
      },
    });
    await tableNpc(traced, ZHOU).takeTurn({ sceneId: SCENE, actorId: ZHOU, transcript: [] });
    expect(typeof taps[0]).toBe("function");
    expect(typeof traced.observe).toBe("function");

    const bare = base({
      generate: async (_p, onMessage) => {
        taps.push(onMessage);
        return "x";
      },
    });
    await tableNpc(bare, ZHOU).takeTurn({ sceneId: SCENE, actorId: ZHOU, transcript: [] });
    expect(taps[1]).toBeUndefined();
    expect(bare.observe).toBeUndefined();
  });

  test("#57 协商内核已接：队友 prose 点到另一队友真名 → 下轮注入定向指令", async () => {
    const prompts: string[] = [];
    let zhouLine = "铁拳·冈，你盯着门，我来看这封信。";
    const table = base({
      generate: async (p) => {
        prompts.push(p);
        return p.includes("铁拳·冈") && prompts.length > 1 ? "好。" : zhouLine;
      },
    });
    await table.referee.nominate(SCENE, ZHOU); // 周慎发言，点到铁拳·冈
    zhouLine = "……";
    await table.referee.nominate(SCENE, TIE); // 轮到铁拳：注入应进它的 prompt
    const tiePrompt = prompts[prompts.length - 1]!;
    expect(tiePrompt).toContain("对你说");
    expect(tiePrompt).toContain("你盯着门");
  });

  test("空 roster：degraded 且 AIDM 可独自开场", () => {
    const table = base({
      rosterStore: { get: () => [], set() {}, markApproved() {} },
    });
    expect(table.degraded).toBe(true);
    expect(table.teammates).toEqual([]);
    expect(table.systemPrompt).toContain("独自开场");
  });
});

/** Resolve a teammate's NpcPort off the assembled table's seam. */
function tableNpc(table: ReturnType<typeof assembleTable>, actor: ReturnType<typeof actorId>) {
  const npc = table.npcFor(actor);
  if (!npc) throw new Error(`no NpcPort for ${actor}`);
  return npc;
}
