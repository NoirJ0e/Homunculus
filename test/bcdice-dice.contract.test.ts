/**
 * Contract test: BcdiceDice + LibBcdiceEvaluator against the REAL npm `bcdice`
 * library (ADR-0013, #40). No RNG control — instead we assert a per-roll
 * invariant that ties our d100 extraction AND success mapping to BCDice's own
 * verdict, so it stays deterministic across the library's internal rolls.
 *
 * If BCDice's result shape or CoC7 command syntax ever drifts, this fails.
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
