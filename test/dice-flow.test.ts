import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { Engine } from "../src/engine/engine.js";
import { FakeAgent } from "../src/adapters/memory/fake-agent.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeSealDice } from "../src/adapters/memory/fake-sealdice.js";

const scene = sceneId("scene:crypt");
const aidm = actorId("aidm");
const pc = actorId("rogue");

describe("#5 dice-check flow (AIDM calls → character .ra → SealDice → transcript)", () => {
  test("the AIDM calls a check, the character rolls, and the result lands in the transcript", async () => {
    const agent = new FakeAgent({
      aidm: [
        {
          prose: "门后有响动——过一个困难侦查。",
          check: { actor: pc, skill: "侦查", difficulty: "hard" },
          control: { kind: "awaiting", actors: [pc] },
        },
        { prose: "你听出那是机括的声音。", control: { kind: "continue" } },
      ],
      rogue: [{ roll: true }], // the character emits .ra
    });
    const substrate = new FakeSubstrate();
    const dice = new FakeSealDice([
      { actorId: pc, skill: "侦查", total: 75, success: true, detail: "d100=75 ≤ 80 困难侦查 → 成功" },
    ]);
    const engine = new Engine({ agent, substrate, dice });

    const result = await engine.runBeat({ sceneId: scene, aidmId: aidm });

    // The roll request carried the skill + difficulty the AIDM called.
    expect(dice.requests).toEqual([{ actorId: pc, skill: "侦查", difficulty: "hard" }]);
    // The dice result is in the transcript, authored by the rolling character.
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([
      [aidm, "门后有响动——过一个困难侦查。"],
      [pc, "d100=75 ≤ 80 困难侦查 → 成功"],
      [aidm, "你听出那是机括的声音。"],
    ]);
    expect(result.events).toContainEqual({ kind: "check-called", actorId: pc });
    expect(result.events).toContainEqual({ kind: "check-resolved", actorId: pc });
  });
});
