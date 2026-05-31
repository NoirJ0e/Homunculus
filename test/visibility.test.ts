import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { Engine } from "../src/engine/engine.js";
import { FakeAgent } from "../src/adapters/memory/fake-agent.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeSealDice } from "../src/adapters/memory/fake-sealdice.js";

const A = sceneId("scene:cellar");
const B = sceneId("scene:rooftop");
const aidm = actorId("aidm");
const alice = actorId("alice");
const bob = actorId("bob");
const charlie = actorId("charlie");

describe("#6 scenes as visibility", () => {
  test("a party-split actor's turn context excludes the other scene's posts", async () => {
    const agent = new FakeAgent({
      aidm: [
        { prose: "[地窖] 霉味扑面。", control: { kind: "awaiting", actors: [alice] } },
        { prose: "[地窖] 你撬开了锁。", control: { kind: "continue" } },
        { prose: "[屋顶] 夜里风大。", control: { kind: "awaiting", actors: [bob] } },
        { prose: "[屋顶] 你看清了院子。", control: { kind: "continue" } },
      ],
      alice: [{ prose: "爱丽丝撬锁。" }],
      bob: [{ prose: "鲍勃眯眼望向院子。" }],
    });
    const engine = new Engine({
      agent,
      substrate: new FakeSubstrate(),
      dice: new FakeSealDice([]),
      scenes: { "scene:cellar": ["alice"], "scene:rooftop": ["bob"] },
    });

    await engine.runBeat({ sceneId: A, aidmId: aidm }); // cellar beat
    await engine.runBeat({ sceneId: B, aidmId: aidm }); // rooftop beat

    // What did bob see when asked to act? Only rooftop posts — nothing of the cellar.
    const bobCtx = agent.seen.find((c) => c.actorId === bob);
    expect(bobCtx).toBeDefined();
    const bobSawScenes = new Set(bobCtx!.transcript.map((p) => p.sceneId));
    expect([...bobSawScenes]).toEqual([B]);
    expect(bobCtx!.transcript.map((p) => p.prose)).toEqual(["[屋顶] 夜里风大。"]);
  });

  test("the AIDM is omniscient — it sees every scene's posts", async () => {
    const agent = new FakeAgent({
      aidm: [
        { prose: "[地窖] 开场。", control: { kind: "awaiting", actors: [alice] } },
        { prose: "[地窖] 收束。", control: { kind: "continue" } },
        { prose: "[屋顶] 开场。", control: { kind: "awaiting", actors: [bob] } },
        { prose: "[屋顶] 收束。", control: { kind: "continue" } },
      ],
      alice: [{ prose: "爱丽丝行动。" }],
      bob: [{ prose: "鲍勃行动。" }],
    });
    const engine = new Engine({
      agent,
      substrate: new FakeSubstrate(),
      dice: new FakeSealDice([]),
      scenes: { "scene:cellar": ["alice"], "scene:rooftop": ["bob"] },
    });
    await engine.runBeat({ sceneId: A, aidmId: aidm });
    await engine.runBeat({ sceneId: B, aidmId: aidm });

    // The AIDM's last turn (rooftop advance) saw both scenes' history.
    const aidmCtxs = agent.seen.filter((c) => c.actorId === aidm);
    const lastAidmCtx = aidmCtxs[aidmCtxs.length - 1]!;
    const scenesSeen = new Set(lastAidmCtx.transcript.map((p) => p.sceneId));
    expect(scenesSeen.has(A)).toBe(true);
    expect(scenesSeen.has(B)).toBe(true);
  });

  test("AIDM tool-call effects add a scene member, maintained in canonical state", async () => {
    const agent = new FakeAgent({
      aidm: [
        {
          prose: "[屋顶] 查理翻上了屋顶。",
          control: { kind: "awaiting", actors: [bob] },
          effects: [{ kind: "add-member", sceneId: B, actor: charlie }],
        },
        { prose: "[屋顶] 你们三人对视。", control: { kind: "continue" } },
      ],
      bob: [{ prose: "鲍勃点头。" }],
    });
    const engine = new Engine({
      agent,
      substrate: new FakeSubstrate(),
      dice: new FakeSealDice([]),
      scenes: { "scene:rooftop": ["bob"] },
    });

    expect(engine.membersOf(B)).not.toContain(charlie);
    await engine.runBeat({ sceneId: B, aidmId: aidm });
    expect(engine.membersOf(B)).toContain(charlie);
  });
});
