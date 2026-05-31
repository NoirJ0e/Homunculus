import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import type { CampaignBible } from "../src/domain/campaign.js";
import type { HumanInboxPort, HumanTurn } from "../src/ports/human-inbox.js";
import { Engine } from "../src/engine/engine.js";
import { ControllerRegistry } from "../src/engine/controller.js";
import { createSoul } from "../src/domain/soul.js";
import { remember } from "../src/engine/memory.js";
import { FakeAgent } from "../src/adapters/memory/fake-agent.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeSealDice } from "../src/adapters/memory/fake-sealdice.js";
import { FakeSoulStore } from "../src/adapters/memory/fake-soul-store.js";

/** A per-actor queue inbox so a human can act, roll, then go silent across beats. */
class QueueInbox implements HumanInboxPort {
  constructor(private readonly q: Record<string, (HumanTurn | undefined)[]>) {}
  async poll(actor: string): Promise<HumanTurn | undefined> {
    return this.q[actor]?.shift();
  }
}

/**
 * Capstone E2E (PRD testing decision: 假基底 + 假 agent + 假 SealDice 跑一整场团).
 * Headless, deterministic, no network — drives a whole mini-session and asserts
 * visibility, pacing, dice, spine and soul/memory all compose.
 */
describe("E2E — a whole headless session", () => {
  const tavern = sceneId("scene:tavern");
  const aidm = actorId("aidm");
  const pc = actorId("pc-arin");
  const kael = actorId("soul:kael");

  const bible: CampaignBible = {
    secretTruth: "酒馆老板是密探。",
    milestones: [
      { id: "m1", goal: "接到委托", enterCue: "酒馆", scenes: [], triggers: [], branchPoints: [] },
      { id: "m2", goal: "潜入宅邸", enterCue: "宅邸", scenes: [], triggers: [], branchPoints: [] },
    ],
    npcs: [],
    worldClocks: [{ id: "patrol", name: "巡逻", segments: ["松懈", "警觉", "封锁"] }],
    bespokeRules: {},
  };

  test("three beats: act → check → hold, with milestone, memory and pause all correct", async () => {
    let kaelSoul = createSoul(kael, { name: "凯尔", temperament: "高傲的贵公子", goals: [] });
    kaelSoul = remember(kaelSoul, { sceneId: tavern, summary: "上次你替凯尔挡了一刀", tags: ["恩情"] });
    const souls = new FakeSoulStore();
    souls.save(kaelSoul);

    const agent = new FakeAgent({
      aidm: [
        // Beat 1
        { prose: "酒馆老板招手叫你们过去。", control: { kind: "awaiting", actors: [kael, pc] } },
        { prose: "他压低声音交代了委托。", control: { kind: "continue" }, effects: [{ kind: "complete-milestone" }] },
        // Beat 2
        {
          prose: "门后有脚步声——过一个聆听。",
          check: { actor: pc, skill: "聆听", difficulty: "normal" },
          control: { kind: "awaiting", actors: [pc] },
        },
        { prose: "你判断有两名守卫。", control: { kind: "continue" } },
        // Beat 3
        { prose: "现在，你打算怎么做？", control: { kind: "awaiting", actors: [pc] } },
      ],
      "soul:kael": [{ prose: "凯尔不动声色地颔首。" }],
    });
    const substrate = new FakeSubstrate();
    const dice = new FakeSealDice([
      { actorId: pc, skill: "聆听", total: 55, success: true, detail: "d100=55 ≤ 70 聆听 → 成功" },
    ]);
    const controllers = new ControllerRegistry({ "pc-arin": { kind: "human", userId: "u1" }, "soul:kael": { kind: "ai" } });
    const inbox = new QueueInbox({
      "pc-arin": [{ kind: "prose", prose: "我谨慎地走近。" }, { kind: "roll" }, undefined],
    });
    const engine = new Engine({
      agent,
      substrate,
      dice,
      campaign: bible,
      souls,
      controllers,
      humanInbox: inbox,
      scenes: { "scene:tavern": ["pc-arin", "soul:kael"] },
    });

    // Beat 1 — both act; AIDM advances and completes m1.
    const b1 = await engine.runBeat({ sceneId: tavern, aidmId: aidm });
    expect(b1.status).toBe("advanced");
    expect(engine.cursorState()?.currentMilestone).toBe("m2");
    // Kael (a soul) acted with its persona core + recalled memory in context.
    const kaelCtx = agent.seen.find((c) => c.actorId === kael)!;
    expect(kaelCtx.persona?.name).toBe("凯尔");
    expect(kaelCtx.memories?.map((m) => m.summary)).toContain("上次你替凯尔挡了一刀");

    // Beat 2 — AIDM calls a check; the human rolls; result lands in the transcript.
    const b2 = await engine.runBeat({ sceneId: tavern, aidmId: aidm });
    expect(b2.status).toBe("advanced");
    expect(dice.requests).toEqual([{ actorId: pc, skill: "聆听", difficulty: "normal" }]);
    expect(substrate.transcript.map((p) => p.prose)).toContain("d100=55 ≤ 70 聆听 → 成功");

    // Beat 3 — the human goes silent → the beat holds as a serializable pause.
    const b3 = await engine.runBeat({ sceneId: tavern, aidmId: aidm });
    expect(b3.status).toBe("held");
    if (b3.status !== "held") throw new Error("unreachable");
    expect(b3.pause.waitingOn).toEqual([pc]);
    expect(JSON.parse(JSON.stringify(b3.pause))).toEqual(b3.pause);
  });
});
