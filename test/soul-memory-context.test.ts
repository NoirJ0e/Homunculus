import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { createSoul } from "../src/domain/soul.js";
import { remember } from "../src/engine/memory.js";
import { Engine } from "../src/engine/engine.js";
import { FakeAgent } from "../src/adapters/memory/fake-agent.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeSealDice } from "../src/adapters/memory/fake-sealdice.js";
import { FakeSoulStore } from "../src/adapters/memory/fake-soul-store.js";

const cellar = sceneId("scene:cellar");
const aidm = actorId("aidm");
const kael = actorId("soul:kael");

describe("#7 soul + memory in the engine", () => {
  test("an NPC's turn context carries its persona core and recalled memories from a prior session", async () => {
    // A soul persisted from a previous session, with an episodic memory.
    let soul = createSoul(kael, { name: "凯尔", temperament: "高傲的贵公子", goals: [] });
    soul = remember(soul, { sceneId: cellar, summary: "上次在地窖里你救过凯尔一命", tags: ["地窖", "恩情"] });
    const store = new FakeSoulStore();
    store.save(soul);

    const agent = new FakeAgent({
      aidm: [
        { prose: "你们又回到了地窖。", control: { kind: "awaiting", actors: [kael] } },
        { prose: "凯尔的神色复杂。", control: { kind: "continue" } },
      ],
      "soul:kael": [{ prose: "凯尔别过头去。" }],
    });
    const engine = new Engine({
      agent,
      substrate: new FakeSubstrate(),
      dice: new FakeSealDice([]),
      scenes: { "scene:cellar": ["soul:kael"] },
      souls: store,
    });

    await engine.runBeat({ sceneId: cellar, aidmId: aidm });

    const kaelCtx = agent.seen.find((c) => c.actorId === kael);
    expect(kaelCtx).toBeDefined();
    // Resident persona core (anti-amnesia/OOC).
    expect(kaelCtx!.persona?.name).toBe("凯尔");
    expect(kaelCtx!.persona?.temperament).toBe("高傲的贵公子");
    // Recalled episodic memory — the NPC remembers a fact from last session.
    expect(kaelCtx!.memories?.map((m) => m.summary)).toContain("上次在地窖里你救过凯尔一命");
  });

  test("the AIDM does not get an NPC persona injected (it has no soul)", async () => {
    const agent = new FakeAgent({
      aidm: [
        { prose: "开场。", control: { kind: "awaiting", actors: [kael] } },
        { prose: "收束。", control: { kind: "continue" } },
      ],
      "soul:kael": [{ pass: true }],
    });
    const store = new FakeSoulStore();
    store.save(createSoul(kael, { name: "凯尔", temperament: "高傲", goals: [] }));
    const engine = new Engine({
      agent,
      substrate: new FakeSubstrate(),
      dice: new FakeSealDice([]),
      scenes: { "scene:cellar": ["soul:kael"] },
      souls: store,
    });
    await engine.runBeat({ sceneId: cellar, aidmId: aidm });

    const aidmCtx = agent.seen.find((c) => c.actorId === aidm);
    expect(aidmCtx!.persona).toBeUndefined();
  });
});
