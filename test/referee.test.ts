import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { Referee } from "../src/engine/referee.js";
import { createDmMcpServer, dmTools } from "../src/adapters/agent-sdk/engine-mcp.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeNpc } from "../src/adapters/memory/fake-npc.js";
import { FakeHumanInbox } from "../src/adapters/memory/fake-human-inbox.js";
import { FakeDice } from "../src/adapters/memory/fake-dice.js";
import { mapRoster } from "../src/engine/roster.js";
import type { NpcPort } from "../src/ports/npc.js";

const tavern = sceneId("scene:tavern");
const aidm = actorId("aidm");
const rogue = actorId("npc-rogue");

describe("#15 referee + in-process MCP tool server (narrate)", () => {
  test("narrate records the post under the DM and emits it to the substrate", async () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate });

    await referee.narrate(tavern, "夜风灌进酒馆。");

    const post = { sceneId: tavern, actorId: aidm, prose: "夜风灌进酒馆。" };
    expect(substrate.transcript).toEqual([post]); // substrate received
    expect(referee.fullLog()).toEqual([post]); // scene recorded
  });

  test("the in-process narrate tool drives the engine: scene recorded + substrate received", async () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate });

    // The MCP tool server can be built (Agent SDK createSdkMcpServer + tool).
    const server = createDmMcpServer(referee);
    expect(server.type).toBe("sdk");
    expect(server.name).toBe("engine");

    // Invoking the narrate tool's handler drives the engine state transition.
    const narrate = dmTools(referee).find((t) => t.name === "narrate");
    expect(narrate).toBeDefined();
    const res = await narrate!.handler({ sceneId: "scene:tavern", prose: "门开了。" }, {});

    expect(res.content[0]).toMatchObject({ type: "text" });
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([[aidm, "门开了。"]]);
    expect(referee.fullLog().map((p) => p.prose)).toEqual(["门开了。"]);
  });

  test("the nominate tool points one actor and reports its result + remaining (await_actors 退役)", async () => {
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc({ "npc-rogue": [{ kind: "speak", prose: "罗格点头。" }] });
    const referee = new Referee({ aidmId: aidm, substrate, npcFor: () => npc, presentActors: [rogue] });

    const tools = dmTools(referee);
    // #52 改写 ADR-0003：批量 await_actors 退役，串行 nominate 成为 narrate 的搭档。
    expect(tools.map((t) => t.name).slice(0, 2)).toEqual(["narrate", "nominate"]);
    expect(tools.find((t) => t.name === "await_actors")).toBeUndefined();

    const nominate = tools.find((t) => t.name === "nominate")!;
    const res = await nominate.handler(
      { sceneId: "scene:tavern", actor: "npc-rogue", desc: "罗格，你怎么做？" },
      {},
    );

    // The tool's text return carries what the actor did — the DM's eyes (修 Bug2).
    expect(res.content[0]).toMatchObject({ type: "text" });
    expect((res.content[0] as { type: "text"; text: string }).text).toContain("罗格点头。");
    expect(substrate.transcript.map((p) => p.prose)).toContain("罗格点头。");
  });
});

describe("#51 per-actor NpcPort (绝不共脑)", () => {
  const zhou = actorId("npc-zhoushen");
  const tie = actorId("npc-tiequan");

  test("each AI actor is driven by ITS OWN NpcPort, never one shared brain", async () => {
    const substrate = new FakeSubstrate();
    // Two DISTINCT agents — 周慎 and 铁拳 each have their own brain.
    const agentZhou = new FakeNpc({ "npc-zhoushen": [{ kind: "speak", prose: "周慎翻开那本书。" }] });
    const agentTie = new FakeNpc({ "npc-tiequan": [{ kind: "speak", prose: "铁拳攥紧了拳头。" }] });
    const ports: Record<string, NpcPort> = { [zhou]: agentZhou, [tie]: agentTie };

    const referee = new Referee({ aidmId: aidm, substrate, npcFor: (a) => ports[a] });
    await referee.awaitActors(tavern, [zhou, tie]);

    // The lock: 周慎's port only ever saw 周慎; 铁拳's port only ever saw 铁拳.
    // If they shared one brain, one port would have seen both actors.
    expect(agentZhou.seen.map((c) => c.actorId)).toEqual([zhou]);
    expect(agentTie.seen.map((c) => c.actorId)).toEqual([tie]);
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([
      [zhou, "周慎翻开那本书。"],
      [tie, "铁拳攥紧了拳头。"],
    ]);
  });

  test("empty / whitespace NPC prose → pass, never reaches the substrate (修 Bug4)", async () => {
    const substrate = new FakeSubstrate();
    const blank = new FakeNpc({ "npc-rogue": [{ kind: "speak", prose: "   \n  " }] });
    const referee = new Referee({ aidmId: aidm, substrate, npcFor: () => blank });

    const out = await referee.awaitActors(tavern, [rogue]);

    // No "Cannot send an empty message" — the blank slot is a pass, not a post.
    expect(substrate.transcript).toEqual([]);
    expect(referee.fullLog()).toEqual([]);
    expect(out.status).toBe("released");
  });
});

describe("#52 nominate (串行点名 + 眼睛 + 轮不变量)", () => {
  const zhou = actorId("npc-zhoushen");
  const tie = actorId("npc-tiequan");
  const human = actorId("player");

  test("nominate drives one actor and returns ITS result + remaining (DM 看得见)", async () => {
    const substrate = new FakeSubstrate();
    const agent = new FakeNpc({ "npc-zhoushen": [{ kind: "speak", prose: "周慎点了点头。" }] });
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      npcFor: () => agent,
      presentActors: [zhou, tie],
    });

    const res = await referee.nominate(tavern, zhou, "周慎，那阵风掀动你的衣角——你怎么做？");

    expect(res.kind).toBe("acted");
    if (res.kind === "acted") {
      expect(res.actor).toBe(zhou);
      expect(res.prose).toBe("周慎点了点头。"); // 眼睛：DM 立刻看见这一拍
      expect(res.remaining).toEqual([tie]); // 周慎 已点，本轮剩铁拳
    }
    expect(substrate.transcript.map((p) => p.prose)).toContain("周慎点了点头。");
  });

  test("the in-fiction cue (desc) is posted under the DM before the actor acts", async () => {
    const substrate = new FakeSubstrate();
    const agent = new FakeNpc({ "npc-zhoushen": [{ kind: "speak", prose: "周慎应声。" }] });
    const referee = new Referee({ aidmId: aidm, substrate, npcFor: () => agent, presentActors: [zhou] });

    await referee.nominate(tavern, zhou, "周慎，门外有脚步声。");

    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([
      [aidm, "周慎，门外有脚步声。"], // cue first, by the DM
      [zhou, "周慎应声。"], // then the nominee — who could see the cue (后手看前手)
    ]);
  });

  test("round invariants: reject 点重复 / 点不在场, full coverage before a new round resets 全员", async () => {
    const substrate = new FakeSubstrate();
    const agent = new FakeNpc({
      "npc-zhoushen": [{ kind: "speak", prose: "周一" }, { kind: "speak", prose: "周二" }],
      "npc-tiequan": [{ kind: "speak", prose: "铁一" }],
    });
    const referee = new Referee({ aidmId: aidm, substrate, npcFor: () => agent, presentActors: [zhou, tie] });

    await referee.nominate(tavern, zhou); // 周慎 done; remaining = [铁拳]

    // 点重复：周慎 already acted this round → rejected, state unchanged.
    const dup = await referee.nominate(tavern, zhou);
    expect(dup.kind).toBe("rejected");
    if (dup.kind === "rejected") expect(dup.remaining).toEqual([tie]);

    // 点不在场：a stranger not in the present roster → rejected.
    const absent = await referee.nominate(tavern, actorId("npc-ghost"));
    expect(absent.kind).toBe("rejected");

    // Complete the round (nominate 铁拳) → remaining empties.
    const last = await referee.nominate(tavern, tie);
    expect(last.kind).toBe("acted");
    if (last.kind === "acted") expect(last.remaining).toEqual([]);

    // Next nominate opens a FRESH round — 全员 reset, so 周慎 is pointable again.
    const next = await referee.nominate(tavern, zhou);
    expect(next.kind).toBe("acted");
    if (next.kind === "acted") {
      expect(next.prose).toBe("周二");
      expect(next.remaining).toEqual([tie]);
    }
  });

  test("真人槽沉默 → 无限期 hold（= 暂停/存档），slot stays open", async () => {
    const substrate = new FakeSubstrate();
    const inbox = new FakeHumanInbox({ player: undefined }); // AFK
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      humanInbox: inbox,
      roster: mapRoster({ player: "human" }),
      presentActors: [human],
    });

    const res = await referee.nominate(tavern, human, "老张，轮到你了。");

    expect(res.kind).toBe("held");
    if (res.kind === "held") {
      expect(res.pause.waitingOn).toEqual([human]);
      expect(res.remaining).toContain(human); // not consumed — resume re-points 老张
    }
  });

  test("agent 槽 pass → passed（跳过），human pass → passed", async () => {
    const substrate = new FakeSubstrate();
    const agent = new FakeNpc({ "npc-zhoushen": [{ kind: "pass" }] });
    const referee = new Referee({ aidmId: aidm, substrate, npcFor: () => agent, presentActors: [zhou] });

    const res = await referee.nominate(tavern, zhou);
    expect(res.kind).toBe("passed");
    if (res.kind === "passed") expect(res.remaining).toEqual([]);
    expect(substrate.transcript).toEqual([]); // a pass posts nothing
  });

  test("a nominated actor's roll resolves through the dice authority → checked result", async () => {
    const substrate = new FakeSubstrate();
    const inv = actorId("player");
    const dice = new FakeDice([
      { actorId: inv, skill: "侦查", total: 37, success: true, detail: "d100=37 ≤ 60 侦查 → 成功" },
    ]);
    const inbox = new FakeHumanInbox({ player: { kind: "roll" } });
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      humanInbox: inbox,
      dice,
      roster: mapRoster({ player: "human" }),
      presentActors: [inv],
    });
    await referee.callCheck(inv, "侦查", "60");

    const res = await referee.nominate(tavern, inv, "你盯着那阵风——掷个侦查。");

    expect(res.kind).toBe("checked");
    if (res.kind === "checked") {
      expect(res.skill).toBe("侦查");
      expect(res.success).toBe(true);
      expect(res.total).toBe(37);
      expect(res.remaining).toEqual([]);
    }
  });
});

describe("#54 检定硬请求地板（玩家显式请求 → pending intent → 顶给 DM 不可丢）", () => {
  const player = actorId("player");

  test("requestCheck registers a pending intent the DM can read; DC 仍未定", () => {
    const referee = new Referee({ aidmId: aidm, substrate: new FakeSubstrate() });

    referee.requestCheck(player, "侦查");

    expect(referee.pendingIntents()).toEqual([{ actor: player, skill: "侦查" }]);
    // It is a REQUEST, not a callable check — no DC assigned, nothing to roll yet.
    expect(referee.pendingCheckFor(player)).toBeUndefined();
  });

  test("the same request twice does not duplicate; different skills accumulate", () => {
    const referee = new Referee({ aidmId: aidm, substrate: new FakeSubstrate() });
    referee.requestCheck(player, "侦查");
    referee.requestCheck(player, "侦查");
    referee.requestCheck(player, "聆听");
    expect(referee.pendingIntents()).toEqual([
      { actor: player, skill: "侦查" },
      { actor: player, skill: "聆听" },
    ]);
  });

  test("DM answering via call_check (DM 定 DC) clears the matching intent — 地板被满足", async () => {
    const referee = new Referee({ aidmId: aidm, substrate: new FakeSubstrate() });
    referee.requestCheck(player, "侦查");
    referee.requestCheck(player, "聆听");

    await referee.callCheck(player, "侦查", "60"); // DC is the DM's to set

    expect(referee.pendingIntents()).toEqual([{ actor: player, skill: "聆听" }]);
  });

  test("an unanswered intent is surfaced to the DM by the nominate tool — 不可静默丢弃", async () => {
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc({ "npc-rogue": [{ kind: "speak", prose: "罗格点头。" }] });
    const referee = new Referee({ aidmId: aidm, substrate, npcFor: () => npc, presentActors: [rogue] });
    referee.requestCheck(player, "侦查");

    const nominate = dmTools(referee).find((t) => t.name === "nominate")!;
    const res = await nominate.handler({ sceneId: "scene:tavern", actor: "npc-rogue" }, {});
    const text = (res.content[0] as { text: string }).text;

    // The DM is told, in its tool return, that a player requested a check it must answer.
    expect(text).toContain("player");
    expect(text).toContain("侦查");
  });
});
