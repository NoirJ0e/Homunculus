import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { Engine } from "../src/engine/engine.js";
import { FakeAgent } from "../src/adapters/memory/fake-agent.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeSealDice } from "../src/adapters/memory/fake-sealdice.js";

/**
 * #14 walking skeleton — the tracer bullet.
 *
 * One scene, one beat, all visible: AIDM narrates and awaits two NPCs; one acts,
 * one passes; the barrier releases and the AIDM is woken to advance. Driven
 * entirely by fakes — headless, deterministic, no network.
 */
describe("single beat", () => {
  const tavern = sceneId("scene:tavern");
  const aidm = actorId("aidm");
  const rogue = actorId("npc-rogue");
  const cleric = actorId("npc-cleric");

  test("AIDM awaits two NPCs; one acts, one passes; barrier releases and AIDM advances", async () => {
    const agent = new FakeAgent({
      aidm: [
        { prose: "夜风灌进酒馆。门口的陌生人盯着你们。", control: { kind: "awaiting", actors: [rogue, cleric] } },
        { prose: "陌生人见无人妄动，松开了按在剑柄上的手。", control: { kind: "continue" } },
      ],
      "npc-rogue": [{ prose: "罗格悄悄把手探向腰间的匕首。" }],
      "npc-cleric": [{ pass: true }],
    });
    const substrate = new FakeSubstrate();
    const dice = new FakeSealDice([]);
    const engine = new Engine({ agent, substrate, dice });

    const result = await engine.runBeat({ sceneId: tavern, aidmId: aidm });

    // ① The transcript: the passing NPC produces nothing; order is preserved.
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([
      [aidm, "夜风灌进酒馆。门口的陌生人盯着你们。"],
      [rogue, "罗格悄悄把手探向腰间的匕首。"],
      [aidm, "陌生人见无人妄动，松开了按在剑柄上的手。"],
    ]);

    // ② Authoritative state transitions of the beat.
    expect(result.events).toEqual([
      { kind: "barrier-opened", waiting: [rogue, cleric] },
      { kind: "actor-acted", actorId: rogue },
      { kind: "actor-passed", actorId: cleric },
      { kind: "barrier-released" },
      { kind: "aidm-woke" },
    ]);
  });
});
