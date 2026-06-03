import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { NativeDice } from "../src/adapters/dice/native-dice.js";
import { FakeCardStore } from "../src/adapters/memory/fake-card-store.js";
import { Referee } from "../src/engine/referee.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeNpc } from "../src/adapters/memory/fake-npc.js";
import { FakeDice } from "../src/adapters/memory/fake-dice.js";
import { FakeHumanInbox } from "../src/adapters/memory/fake-human-inbox.js";
import { mapRoster } from "../src/engine/roster.js";
import { runDmToolFlow } from "../src/adapters/memory/fake-tool-flow.js";
import { dmTools, npcTools } from "../src/adapters/agent-sdk/engine-mcp.js";

/**
 * #18 — TS-native dice + check-flow tooling (ADR-0001 修订, ADR-0002/0009).
 */
const inv = actorId("inv-1"); // a COC7 investigator
const hero = actorId("hero-1"); // a DND5e hero

describe("NativeDice — deterministic check resolution via injected RNG", () => {
  // A scripted RNG: yields the given [0,1) values in order.
  const scriptRng = (values: readonly number[]): (() => number) => {
    const queue = [...values];
    return () => {
      const v = queue.shift();
      if (v === undefined) throw new Error("scriptRng: out of values");
      return v;
    };
  };

  test("COC7: roll d100, success iff roll <= skill", async () => {
    const cards = new FakeCardStore({
      "inv-1": { system: "coc7", skills: { 侦查: 60 } },
    });
    // rng 0.36 → d100 = floor(0.36*100)+1 = 37; 37 <= 60 → success.
    const dice = new NativeDice(cards, scriptRng([0.36]));
    const r = await dice.roll({ actorId: inv, skill: "侦查" });
    expect(r.total).toBe(37);
    expect(r.success).toBe(true);
    expect(r.detail).toContain("d100=37");
    expect(r.detail).toContain("≤ 60");
    expect(r.detail).toContain("成功");
  });

  test("COC7: hard halves the threshold; flips success at the boundary", async () => {
    const cards = new FakeCardStore({ "inv-1": { system: "coc7", skills: { 侦查: 60 } } });
    // threshold hard = floor(60/2) = 30. roll 30 → success, roll 31 → failure.
    const pass = new NativeDice(cards, scriptRng([0.29])); // d100 = 30
    const fail = new NativeDice(cards, scriptRng([0.30])); // d100 = 31
    expect((await pass.roll({ actorId: inv, skill: "侦查", difficulty: "hard" })).success).toBe(true);
    expect((await fail.roll({ actorId: inv, skill: "侦查", difficulty: "hard" })).success).toBe(false);
  });

  test("COC7: extreme is a fifth of the threshold", async () => {
    const cards = new FakeCardStore({ "inv-1": { system: "coc7", skills: { 侦查: 60 } } });
    // threshold extreme = floor(60/5) = 12. roll 12 → success, roll 13 → failure.
    const pass = new NativeDice(cards, scriptRng([0.11])); // d100 = 12
    const fail = new NativeDice(cards, scriptRng([0.12])); // d100 = 13
    expect((await pass.roll({ actorId: inv, skill: "侦查", difficulty: "extreme" })).success).toBe(true);
    expect((await fail.roll({ actorId: inv, skill: "侦查", difficulty: "extreme" })).success).toBe(false);
  });

  test("DND5e: d20 + modifier vs DC; success iff total >= DC", async () => {
    const cards = new FakeCardStore({
      "hero-1": { system: "dnd5e", skills: { 调查: 0 }, modifiers: { 调查: 3 } },
    });
    // rng 0.55 → d20 = floor(0.55*20)+1 = 12; total = 12+3 = 15.
    const dice = new NativeDice(cards, scriptRng([0.55]));
    const r = await dice.roll({ actorId: hero, skill: "调查", difficulty: "dc15" });
    expect(r.total).toBe(15);
    expect(r.success).toBe(true); // 15 >= 15
    expect(r.detail).toContain("d20=12+3=15");
    expect(r.detail).toContain("≥ 15");
    expect(r.detail).toContain("成功");
  });

  test("DND5e: success flips just below the DC boundary", async () => {
    const cards = new FakeCardStore({
      "hero-1": { system: "dnd5e", skills: { 调查: 0 }, modifiers: { 调查: 3 } },
    });
    // d20 = 11 (rng 0.5) → total 14 < 15 → failure.
    const dice = new NativeDice(cards, scriptRng([0.5]));
    const r = await dice.roll({ actorId: hero, skill: "调查", difficulty: "dc15" });
    expect(r.total).toBe(14);
    expect(r.success).toBe(false);
    expect(r.detail).toContain("失败");
  });
});

const scene = sceneId("scene:study");

describe("check flow — DM calls, the called character rolls its own pending", () => {
  test("call_check registers a pending; an NPC roll resolves it via dice into the transcript", async () => {
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc({ "inv-1": [{ kind: "roll" }] });
    const dice = new FakeDice([
      { actorId: inv, skill: "侦查", total: 37, success: true, detail: "d100=37 ≤ 60 侦查 → 成功" },
    ]);
    const referee = new Referee({ aidmId: actorId("aidm"), substrate, npc, dice });

    await referee.callCheck(inv, "侦查", "hard");
    const flow = await runDmToolFlow(referee, [
      { tool: "await_actors", sceneId: scene, order: [inv] },
    ]);

    // The dice port was asked to resolve the pending check, with its band.
    expect(dice.requests).toEqual([{ actorId: inv, skill: "侦查", difficulty: "hard" }]);
    // The structured detail landed in the transcript, authored by the roller.
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([
      [inv, "d100=37 ≤ 60 侦查 → 成功"],
    ]);
    // A check-resolved event carries the structured result.
    const resolved = flow.awaits[0]!.events.find((e) => e.kind === "check-resolved");
    expect(resolved).toMatchObject({ kind: "check-resolved", actorId: inv, success: true, total: 37 });
  });

  test("with NativeDice end-to-end: a controlled rng resolves a real COC7 check", async () => {
    const substrate = new FakeSubstrate();
    const cards = new FakeCardStore({ "inv-1": { system: "coc7", skills: { 侦查: 60 } } });
    const dice = new NativeDice(cards, () => 0.36); // d100 = 37
    const npc = new FakeNpc({ "inv-1": [{ kind: "roll" }] });
    const referee = new Referee({ aidmId: actorId("aidm"), substrate, npc, dice, cards });

    await referee.callCheck(inv, "侦查");
    await runDmToolFlow(referee, [{ tool: "await_actors", sceneId: scene, order: [inv] }]);

    expect(substrate.transcript[0]!.actorId).toBe(inv);
    expect(substrate.transcript[0]!.prose).toContain("d100=37");
    expect(substrate.transcript[0]!.prose).toContain("成功");
  });

  test("a character cannot roll a check that isn't its own pending → stays a pass, no dice call", async () => {
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc({ "inv-1": [{ kind: "roll" }] });
    const dice = new FakeDice([]); // would throw if called
    const referee = new Referee({ aidmId: actorId("aidm"), substrate, npc, dice });

    // No call_check for inv-1: the roll has nothing of its own to resolve.
    const flow = await runDmToolFlow(referee, [
      { tool: "await_actors", sceneId: scene, order: [inv] },
    ]);

    expect(dice.requests).toEqual([]); // dice never consulted
    expect(substrate.transcript).toEqual([]); // nothing posted
    expect(flow.awaits[0]!.events).toContainEqual({ kind: "actor-passed", actorId: inv });
    expect(flow.awaits[0]!.events.some((e) => e.kind === "check-resolved")).toBe(false);
  });

  test("readCard returns the sheet's numbers (DM read-only view)", async () => {
    const cards = new FakeCardStore({ "inv-1": { system: "coc7", skills: { 侦查: 60 } } });
    const referee = new Referee({ aidmId: actorId("aidm"), substrate: new FakeSubstrate(), cards });
    expect(referee.readCard(inv)).toEqual({ system: "coc7", skills: { 侦查: 60 } });
  });
});

describe("tool partition — DM gets read_card/call_check, never write_card; NPC gets roll", () => {
  const referee = new Referee({ aidmId: actorId("aidm"), substrate: new FakeSubstrate() });

  test("dmTools exposes read_card and call_check but NOT write_card", () => {
    const names = dmTools(referee).map((t) => t.name);
    expect(names).toContain("read_card");
    expect(names).toContain("call_check");
    expect(names).not.toContain("write_card");
  });

  test("npcTools exposes roll and never the DM-only tools", () => {
    const names = npcTools(referee).map((t) => t.name);
    expect(names).toContain("roll");
    expect(names).not.toContain("narrate");
    expect(names).not.toContain("call_check");
    expect(names).not.toContain("read_card");
  });
});

describe("#44 check live loop — mode + advantage thread into the RollRequest", () => {
  test("call_check stores mode; resolveRoll builds a RollRequest with skill/difficulty/mode", async () => {
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc({ "hero-1": [{ kind: "roll" }] });
    const dice = new FakeDice([
      { actorId: hero, skill: "攻击", total: 19, success: true, detail: "AT+5>=15 → 19 → 成功（攻击）" },
    ]);
    const referee = new Referee({ aidmId: actorId("aidm"), substrate, npc, dice });

    // The AIDM declares an ATTACK check with an AC.
    await referee.callCheck(hero, "攻击", "ac15", "attack");
    await runDmToolFlow(referee, [{ tool: "await_actors", sceneId: scene, order: [hero] }]);

    // The pending's skill/difficulty/mode all reach the dice port.
    expect(dice.requests).toEqual([
      { actorId: hero, skill: "攻击", difficulty: "ac15", mode: "attack" },
    ]);
  });

  test("a human roll turn's advantage threads through into the RollRequest", async () => {
    const substrate = new FakeSubstrate();
    const inbox = new FakeHumanInbox({ "hero-1": { kind: "roll", advantage: "advantage" } });
    const roster = mapRoster({ "hero-1": "human" });
    const dice = new FakeDice([
      { actorId: hero, skill: "察觉", total: 18, success: true, detail: "AR+3>=10A → 18 → 成功（察觉）" },
    ]);
    const referee = new Referee({
      aidmId: actorId("aidm"),
      substrate,
      humanInbox: inbox,
      roster,
      dice,
    });

    await referee.callCheck(hero, "察觉", "dc10");
    await runDmToolFlow(referee, [{ tool: "await_actors", sceneId: scene, order: [hero] }]);

    // skill+difficulty from the pending check, advantage from the human's roll turn.
    expect(dice.requests).toEqual([
      { actorId: hero, skill: "察觉", difficulty: "dc10", advantage: "advantage" },
    ]);
  });

  test("a straight human roll (no advantage) omits the advantage field entirely", async () => {
    const substrate = new FakeSubstrate();
    const inbox = new FakeHumanInbox({ "hero-1": { kind: "roll" } });
    const roster = mapRoster({ "hero-1": "human" });
    const dice = new FakeDice([
      { actorId: hero, skill: "察觉", total: 12, success: true, detail: "成功" },
    ]);
    const referee = new Referee({
      aidmId: actorId("aidm"),
      substrate,
      humanInbox: inbox,
      roster,
      dice,
    });

    await referee.callCheck(hero, "察觉");
    await runDmToolFlow(referee, [{ tool: "await_actors", sceneId: scene, order: [hero] }]);

    // No mode, no difficulty, no advantage — conditional spread leaves them out.
    expect(dice.requests).toEqual([{ actorId: hero, skill: "察觉" }]);
  });
});
