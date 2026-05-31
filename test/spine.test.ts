import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import type { CampaignBible } from "../src/domain/campaign.js";
import { Engine } from "../src/engine/engine.js";
import { FakeAgent } from "../src/adapters/memory/fake-agent.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeSealDice } from "../src/adapters/memory/fake-sealdice.js";

const scene = sceneId("scene:city");
const aidm = actorId("aidm");
const n1 = actorId("npc-1");

const bible: CampaignBible = {
  secretTruth: "市长就是邪教首领。",
  milestones: [
    { id: "m1", goal: "进城", enterCue: "城门", scenes: [], triggers: [], branchPoints: [] },
    { id: "m2", goal: "查案", enterCue: "线索", scenes: [], triggers: [], branchPoints: [] },
  ],
  npcs: [],
  worldClocks: [{ id: "cult", name: "邪教仪式", segments: ["平静", "集结", "仪式完成"] }],
  bespokeRules: {},
};

const engineWith = (agent: FakeAgent) =>
  new Engine({ agent, substrate: new FakeSubstrate(), dice: new FakeSealDice([]), campaign: bible });

describe("#11 plot spine in the engine", () => {
  test("an AIDM complete-milestone effect advances the per-branch cursor", async () => {
    const agent = new FakeAgent({
      aidm: [
        {
          prose: "你们进了城。",
          control: { kind: "awaiting", actors: [n1] },
          effects: [{ kind: "complete-milestone" }],
        },
        { prose: "镜头推进。", control: { kind: "continue" } },
      ],
      "npc-1": [{ prose: "卫兵打量你们。" }],
    });
    const engine = engineWith(agent);

    expect(engine.cursorState()?.currentMilestone).toBe("m1");
    await engine.runBeat({ sceneId: scene, aidmId: aidm });
    expect(engine.cursorState()?.completed).toEqual(["m1"]);
    expect(engine.cursorState()?.currentMilestone).toBe("m2");
  });

  test("a stalled beat (nobody acts) advances the hidden world clock", async () => {
    const agent = new FakeAgent({
      aidm: [
        { prose: "城里一片死寂，你们在原地踟蹰。", control: { kind: "awaiting", actors: [n1] } },
        { prose: "时间在流逝……", control: { kind: "continue" } },
      ],
      "npc-1": [{ pass: true }], // nobody acts → stall
    });
    const engine = engineWith(agent);

    expect(engine.clockView("cult")?.position).toBe(0);
    const result = await engine.runBeat({ sceneId: scene, aidmId: aidm });
    expect(result.events).toContainEqual({ kind: "stall-detected" });
    expect(engine.clockView("cult")?.position).toBe(1); // 集结
  });

  test("an AIDM advance-clock effect ticks a specific clock", async () => {
    const agent = new FakeAgent({
      aidm: [
        {
          prose: "你们拖延时，远处升起黑烟。",
          control: { kind: "awaiting", actors: [n1] },
          effects: [{ kind: "advance-clock", clockId: "cult" }],
        },
        { prose: "黑烟更浓了。", control: { kind: "continue" } },
      ],
      "npc-1": [{ prose: "卫兵指向黑烟。" }], // someone acts → no stall tick
    });
    const engine = engineWith(agent);

    await engine.runBeat({ sceneId: scene, aidmId: aidm });
    // Only the explicit advance-clock effect ticked it (no stall, since npc acted).
    expect(engine.clockView("cult")?.position).toBe(1);
  });
});
