import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { Engine } from "../src/engine/engine.js";
import { FakeAgent } from "../src/adapters/memory/fake-agent.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeSealDice } from "../src/adapters/memory/fake-sealdice.js";
import { FakeHumanInbox } from "../src/adapters/memory/fake-human-inbox.js";
import { mapRoster } from "../src/engine/roster.js";

const scene = sceneId("scene:tavern");
const aidm = actorId("aidm");
const human = actorId("human-1");
const n1 = actorId("npc-1");
const n2 = actorId("npc-2");

describe("#2 pacing fidelity", () => {
  test("a silent human holds the beat indefinitely — no advance, serializable pause", async () => {
    const agent = new FakeAgent({
      aidm: [{ prose: "门开了。", control: { kind: "awaiting", actors: [human, n1] } }],
      "npc-1": [{ pass: true }],
    });
    const substrate = new FakeSubstrate();
    const engine = new Engine({
      agent,
      substrate,
      dice: new FakeSealDice([]),
      roster: mapRoster({ "human-1": "human", "npc-1": "ai" }),
      humanInbox: new FakeHumanInbox({ "human-1": undefined }), // silent
    });

    const result = await engine.runBeat({ sceneId: scene, aidmId: aidm });

    expect(result.status).toBe("held");
    // AIDM never woken; no advancement prose.
    expect(result.events).not.toContainEqual({ kind: "aidm-woke" });
    expect(substrate.transcript.map((p) => p.prose)).toEqual(["门开了。"]);

    if (result.status !== "held") throw new Error("unreachable");
    expect(result.pause.waitingOn).toEqual([human]);
    // The pause must survive a JSON round-trip (save/restore).
    expect(JSON.parse(JSON.stringify(result.pause))).toEqual(result.pause);
  });

  test("everyone explicitly passing wakes the AIDM to advance", async () => {
    const agent = new FakeAgent({
      aidm: [
        { prose: "你们沉默地对视。", control: { kind: "awaiting", actors: [human, n1] } },
        { prose: "AIDM 推进了剧情。", control: { kind: "continue" } },
      ],
      "npc-1": [{ pass: true }],
    });
    const substrate = new FakeSubstrate();
    const engine = new Engine({
      agent,
      substrate,
      dice: new FakeSealDice([]),
      roster: mapRoster({ "human-1": "human", "npc-1": "ai" }),
      humanInbox: new FakeHumanInbox({ "human-1": { kind: "pass" } }), // explicit pass
    });

    const result = await engine.runBeat({ sceneId: scene, aidmId: aidm });

    expect(result.status).toBe("advanced");
    expect(result.events).toContainEqual({ kind: "aidm-woke" });
    expect(substrate.transcript.map((p) => p.prose)).toEqual([
      "你们沉默地对视。",
      "AIDM 推进了剧情。",
    ]);
  });

  test("the wake-gate decides who runs full generation; filtered actors produce no post", async () => {
    const agent = new FakeAgent(
      {
        aidm: [
          { prose: "钟楼传来钟声。", control: { kind: "awaiting", actors: [n1, n2] } },
          { prose: "余音散去。", control: { kind: "continue" } },
        ],
        "npc-1": [{ prose: "我才不该说话。" }], // scripted, but the gate will filter npc-1
        "npc-2": [{ prose: "npc-2 抬头看向钟楼。" }],
      },
      { "npc-1": false, "npc-2": true }, // wake-gate: npc-1 stays silent, npc-2 speaks
    );
    const substrate = new FakeSubstrate();
    const engine = new Engine({ agent, substrate, dice: new FakeSealDice([]) });

    const result = await engine.runBeat({ sceneId: scene, aidmId: aidm });

    expect(result.status).toBe("advanced");
    // npc-1 was gated out → no post; its scripted line is never consumed.
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([
      [aidm, "钟楼传来钟声。"],
      [n2, "npc-2 抬头看向钟楼。"],
      [aidm, "余音散去。"],
    ]);
    expect(result.events).toContainEqual({ kind: "actor-gated", actorId: n1 });
    expect(result.events).toContainEqual({ kind: "barrier-released" });
  });
});
