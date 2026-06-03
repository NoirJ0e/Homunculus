/**
 * BcdiceDice — the BCDice-backed DicePort (ADR-0013), CoC7 path (#40).
 *
 * The adapter depends on an injected `BcdiceEvaluator` seam (same shape as the
 * HttpSealDice/HttpClient pattern), so these unit tests stay deterministic
 * without touching BCDice's Opal-internal RNG. A separate real-library contract
 * test (bcdice-dice.contract.test.ts) confirms the wiring against npm `bcdice`.
 */
import { describe, expect, test } from "vitest";
import {
  BcdiceDice,
  type BcdiceEvaluator,
  type BcdiceEval,
} from "../src/adapters/dice/bcdice-dice.js";
import type { CardStore, CharacterSheet } from "../src/ports/card-store.js";
import type { ActorId } from "../src/domain/ids.js";

const p1 = "p1" as ActorId;

function cardsOf(sheet: CharacterSheet | undefined): CardStore {
  return { read: () => sheet };
}

function stubEval(
  result: BcdiceEval | null,
  capture?: (systemId: string, command: string) => void,
): BcdiceEvaluator {
  return {
    eval: async (systemId, command) => {
      capture?.(systemId, command);
      return result;
    },
  };
}

const coc7 = (skills: Record<string, number>): CharacterSheet => ({ system: "coc7", skills });

function evResult(over: Partial<BcdiceEval>): BcdiceEval {
  return {
    text: "(1D100<=60) ＞ 37 ＞ レギュラー成功",
    success: false,
    failure: false,
    critical: false,
    fumble: false,
    detailedRands: [
      { kind: "tens_d10", sides: 10, value: 30 },
      { kind: "normal", sides: 10, value: 7 },
    ],
    ...over,
  };
}

describe("BcdiceDice — CoC7", () => {
  test("regular success → success result, CC<=skill command, composed d100 total", async () => {
    let seen: { s: string; c: string } | undefined;
    const dice = new BcdiceDice(
      cardsOf(coc7({ 侦查: 60 })),
      stubEval(evResult({ success: true }), (s, c) => (seen = { s, c })),
    );

    const r = await dice.roll({ actorId: p1, skill: "侦查" });

    expect(seen).toEqual({ s: "Cthulhu7th", c: "CC<=60" });
    expect(r.success).toBe(true);
    expect(r.total).toBe(37); // tens 30 + units 7
    expect(r.detail).toContain("成功");
    expect(r.actorId).toBe(p1);
    expect(r.skill).toBe("侦查");
  });

  test("critical → 大成功 and success true", async () => {
    const dice = new BcdiceDice(
      cardsOf(coc7({ 侦查: 60 })),
      stubEval(evResult({ success: true, critical: true })),
    );
    const r = await dice.roll({ actorId: p1, skill: "侦查" });
    expect(r.success).toBe(true);
    expect(r.detail).toContain("大成功");
  });

  test("fumble → 大失败 and success false", async () => {
    const dice = new BcdiceDice(
      cardsOf(coc7({ 侦查: 60 })),
      stubEval(evResult({ failure: true, fumble: true })),
    );
    const r = await dice.roll({ actorId: p1, skill: "侦查" });
    expect(r.success).toBe(false);
    expect(r.detail).toContain("大失败");
  });

  test("plain failure → 失败", async () => {
    const dice = new BcdiceDice(
      cardsOf(coc7({ 侦查: 60 })),
      stubEval(evResult({ failure: true })),
    );
    const r = await dice.roll({ actorId: p1, skill: "侦查" });
    expect(r.success).toBe(false);
    expect(r.detail).toContain("失败");
  });

  test("difficulty bands collapse the threshold (hard→⌊/2⌋, extreme→⌊/5⌋)", async () => {
    let cmd = "";
    const hard = new BcdiceDice(cardsOf(coc7({ 侦查: 61 })), stubEval(evResult({}), (_s, c) => (cmd = c)));
    await hard.roll({ actorId: p1, skill: "侦查", difficulty: "hard" });
    expect(cmd).toBe("CC<=30");

    const extreme = new BcdiceDice(cardsOf(coc7({ 侦查: 61 })), stubEval(evResult({}), (_s, c) => (cmd = c)));
    await extreme.roll({ actorId: p1, skill: "侦查", difficulty: "extreme" });
    expect(cmd).toBe("CC<=12");
  });

  test("unknown skill defaults to threshold 0", async () => {
    let cmd = "";
    const dice = new BcdiceDice(cardsOf(coc7({ 侦查: 60 })), stubEval(evResult({}), (_s, c) => (cmd = c)));
    await dice.roll({ actorId: p1, skill: "潜行" });
    expect(cmd).toBe("CC<=0");
  });

  test("all-zeros d100 reads as 100, not 0", async () => {
    const dice = new BcdiceDice(
      cardsOf(coc7({ 侦查: 60 })),
      stubEval(
        evResult({
          failure: true,
          fumble: true,
          detailedRands: [
            { kind: "tens_d10", sides: 10, value: 0 },
            { kind: "normal", sides: 10, value: 10 },
          ],
        }),
      ),
    );
    const r = await dice.roll({ actorId: p1, skill: "侦查" });
    expect(r.total).toBe(100);
  });

  test("no sheet → throws", async () => {
    const dice = new BcdiceDice(cardsOf(undefined), stubEval(evResult({})));
    await expect(dice.roll({ actorId: p1, skill: "侦查" })).rejects.toThrow(/no character sheet/);
  });

  test("non-CoC7 system → throws (D&D5e deferred to #42)", async () => {
    const dnd: CharacterSheet = { system: "dnd5e", skills: { 调查: 0 } };
    const dice = new BcdiceDice(cardsOf(dnd), stubEval(evResult({})));
    await expect(dice.roll({ actorId: p1, skill: "调查" })).rejects.toThrow(/not supported yet/);
  });

  test("evaluator returns null (command unrecognized) → throws", async () => {
    const dice = new BcdiceDice(cardsOf(coc7({ 侦查: 60 })), stubEval(null));
    await expect(dice.roll({ actorId: p1, skill: "侦查" })).rejects.toThrow(/not recognized/);
  });
});
