import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { Engine } from "../src/engine/engine.js";
import { ControllerRegistry } from "../src/engine/controller.js";
import { FakeAgent } from "../src/adapters/memory/fake-agent.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeSealDice } from "../src/adapters/memory/fake-sealdice.js";
import { FakeHumanInbox } from "../src/adapters/memory/fake-human-inbox.js";

const scene = sceneId("scene:road");
const aidm = actorId("aidm");
const kael = actorId("soul:kael");

describe("#13 hot-swap — soul/controller decoupling", () => {
  test("a silent human does NOT auto-hand-off to AI; the beat holds, binding unchanged", async () => {
    const agent = new FakeAgent({
      aidm: [{ prose: "前方岔路。", control: { kind: "awaiting", actors: [kael] } }],
    });
    const controllers = new ControllerRegistry({ "soul:kael": { kind: "human", userId: "u1" } });
    const engine = new Engine({
      agent,
      substrate: new FakeSubstrate(),
      dice: new FakeSealDice([]),
      controllers,
      humanInbox: new FakeHumanInbox({ "soul:kael": undefined }), // AFK
    });

    const result = await engine.runBeat({ sceneId: scene, aidmId: aidm });
    expect(result.status).toBe("held"); // no AFK takeover
    expect(controllers.controllerOf(kael).kind).toBe("human"); // binding untouched
  });

  test("explicit handoff human→AI lets the table continue; the soul is the same", async () => {
    const agent = new FakeAgent({
      aidm: [
        { prose: "前方岔路。", control: { kind: "awaiting", actors: [kael] } },
        { prose: "你们继续前行。", control: { kind: "continue" } },
      ],
      "soul:kael": [{ prose: "（AI 接管）凯尔策马向左。" }],
    });
    const controllers = new ControllerRegistry({ "soul:kael": { kind: "human", userId: "u1" } });
    const substrate = new FakeSubstrate();
    const engine = new Engine({
      agent,
      substrate,
      dice: new FakeSealDice([]),
      controllers,
    });

    controllers.handoff(kael, { kind: "ai" }); // explicit hot-swap
    const result = await engine.runBeat({ sceneId: scene, aidmId: aidm });

    expect(result.status).toBe("advanced");
    expect(substrate.transcript.map((p) => p.prose)).toContain("（AI 接管）凯尔策马向左。");
  });

  test('"别管我" sets a long-lived pass: the character is inert and the table skips it', async () => {
    const agent = new FakeAgent({
      aidm: [
        { prose: "你们扎营。", control: { kind: "awaiting", actors: [kael] } },
        { prose: "夜色降临。", control: { kind: "continue" } },
      ],
    });
    const controllers = new ControllerRegistry({ "soul:kael": { kind: "human", userId: "u1" } });
    const engine = new Engine({
      agent,
      substrate: new FakeSubstrate(),
      dice: new FakeSealDice([]),
      controllers,
      humanInbox: new FakeHumanInbox({ "soul:kael": undefined }),
    });

    controllers.setInert(kael); // "今晚别管我"
    const result = await engine.runBeat({ sceneId: scene, aidmId: aidm });

    expect(result.status).toBe("advanced"); // table continues without the inert character
    expect(result.events).toContainEqual({ kind: "actor-inert", actorId: kael });
  });
});
