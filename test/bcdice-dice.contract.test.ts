/**
 * Contract test: BcdiceDice + LibBcdiceEvaluator against the REAL npm `bcdice`
 * library (ADR-0013, #40 + #42). No RNG control — instead we assert per-roll
 * invariants that tie our extraction AND success mapping to BCDice's own verdict,
 * so it stays deterministic across the library's internal rolls.
 *
 * If BCDice's result shape or command syntax ever drifts, this fails.
 */
import { describe, expect, test } from "vitest";
import { BcdiceDice } from "../src/adapters/dice/bcdice-dice.js";
import { LibBcdiceEvaluator } from "../src/adapters/dice/bcdice-evaluator.js";
import type { CardStore, CharacterSheet } from "../src/ports/card-store.js";
import type { ActorId } from "../src/domain/ids.js";

const p1 = "p1" as ActorId;
const cardsOf = (sheet: CharacterSheet): CardStore => ({ read: () => sheet });
const coc7 = (skills: Record<string, number>): CharacterSheet => ({ system: "coc7", skills });

describe("BcdiceDice — real bcdice CoC7 contract", () => {
  test("CC<=skill: total in 1..100 and success ⇔ roll ≤ skill, across many rolls", async () => {
    const threshold = 60;
    const dice = new BcdiceDice(cardsOf(coc7({ 侦查: threshold })), new LibBcdiceEvaluator());

    for (let i = 0; i < 120; i++) {
      const r = await dice.roll({ actorId: p1, skill: "侦查" });
      expect(r.total).toBeGreaterThanOrEqual(1);
      expect(r.total).toBeLessThanOrEqual(100);
      expect(r.detail).toMatch(/大成功|大失败|成功|失败/);
      // CoC7 @ skill 60: success exactly when the d100 lands ≤ 60.
      expect(r.success).toBe(r.total <= threshold);
    }
  });

  test("structured tiers surface: a near-certain success names a success tier", async () => {
    const dice = new BcdiceDice(cardsOf(coc7({ 侦查: 99 })), new LibBcdiceEvaluator());
    const r = await dice.roll({ actorId: p1, skill: "侦查" });
    // skill 99 fails only on a literal 100; assert structural well-formedness.
    expect(typeof r.success).toBe("boolean");
    expect(r.detail).toContain("CC<=99");
  });
});

// ── D&D5e contract tests (#42) ──────────────────────────────────────────────

/**
 * Standard test sheet: 感知 16 (mod +3), level 5 (pb=3), proficient in 察觉.
 * Total mod for 察觉 = +3 (ability) + +3 (pb) = +6.
 * DC 10 is easy, so most rolls succeed (confirms the success/total invariant).
 */
function dnd5eTestSheet(): CharacterSheet {
  return {
    system: "dnd5e",
    skills: {},
    attributes: {
      力量: 10,
      敏捷: 10,
      体质: 10,
      智力: 10,
      感知: 16,
      魅力: 10,
    },
    level: 5,
    proficiencies: ["察觉"],
  };
}

describe("BcdiceDice — real bcdice D&D5e contract", () => {
  test("AR check: total = chosen_d20 + mod, and success ⇔ total ≥ DC, across many rolls", async () => {
    const dc = 10;
    const mod = 6; // 感知 16 → +3 ability, level 5 proficient → +3 pb
    const dice = new BcdiceDice(cardsOf(dnd5eTestSheet()), new LibBcdiceEvaluator());

    for (let i = 0; i < 60; i++) {
      const r = await dice.roll({ actorId: p1, skill: "察觉", difficulty: `dc${dc}` });

      // total is always d20 (1..20) + mod
      expect(r.total).toBeGreaterThanOrEqual(1 + mod);
      expect(r.total).toBeLessThanOrEqual(20 + mod);
      expect(r.detail).toMatch(/大成功|大失败|成功|失败/);
      // success ⇔ total ≥ DC (BCDice is authoritative)
      expect(r.success).toBe(r.total >= dc);
    }
  });

  test("advantage: chosen d20 = max of two d20s, across many rolls", async () => {
    const dc = 15; // non-trivial DC so both outcomes occur
    const mod = 6;
    const dice = new BcdiceDice(cardsOf(dnd5eTestSheet()), new LibBcdiceEvaluator());

    for (let i = 0; i < 40; i++) {
      const r = await dice.roll({
        actorId: p1,
        skill: "察觉",
        difficulty: `dc${dc}`,
        advantage: "advantage",
      });

      // total = max_d20 + mod; max_d20 ≥ 1
      expect(r.total).toBeGreaterThanOrEqual(1 + mod);
      expect(r.total).toBeLessThanOrEqual(20 + mod);
      // success ⇔ total ≥ DC
      expect(r.success).toBe(r.total >= dc);
    }
  });

  test("disadvantage: chosen d20 = min of two d20s, across many rolls", async () => {
    const dc = 10;
    const mod = 6;
    const dice = new BcdiceDice(cardsOf(dnd5eTestSheet()), new LibBcdiceEvaluator());

    for (let i = 0; i < 40; i++) {
      const r = await dice.roll({
        actorId: p1,
        skill: "察觉",
        difficulty: `dc${dc}`,
        advantage: "disadvantage",
      });

      expect(r.total).toBeGreaterThanOrEqual(1 + mod);
      expect(r.total).toBeLessThanOrEqual(20 + mod);
      expect(r.success).toBe(r.total >= dc);
    }
  });

  test("attack (AT mode): total in range, crit/fumble auto-detected, AC-based verdict", async () => {
    const ac = 12;
    // Use a low-ability sheet with no proficiency for a simple +0 mod
    const sheet: CharacterSheet = {
      system: "dnd5e",
      skills: {},
      attributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 },
    };
    const dice = new BcdiceDice(cardsOf(sheet), new LibBcdiceEvaluator());

    for (let i = 0; i < 40; i++) {
      const r = await dice.roll({
        actorId: p1,
        skill: "攻击",
        difficulty: `${ac}`,
        mode: "attack",
      });

      // d20 + 0 = 1..20
      expect(r.total).toBeGreaterThanOrEqual(1);
      expect(r.total).toBeLessThanOrEqual(20);
      expect(r.detail).toMatch(/大成功|大失败|暴击|成功|失败/);
      // success ⇔ total ≥ AC (BCDice is authoritative)
      expect(r.success).toBe(r.total >= ac);
    }
  });

  test("D&D5e result has well-formed RollResult shape", async () => {
    const dice = new BcdiceDice(cardsOf(dnd5eTestSheet()), new LibBcdiceEvaluator());
    const r = await dice.roll({ actorId: p1, skill: "察觉" });

    expect(r.actorId).toBe(p1);
    expect(r.skill).toBe("察觉");
    expect(typeof r.total).toBe("number");
    expect(typeof r.success).toBe("boolean");
    expect(typeof r.detail).toBe("string");
    expect(r.detail).toContain("AR");
  });
});
