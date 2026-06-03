/**
 * BcdiceDice — the BCDice-backed DicePort (ADR-0013), CoC7 path (#40) + D&D5e
 * path (#42).
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

  test("D&D5e system routes to D&D5e path (no longer throws — #42 shipped)", async () => {
    // Regression: D&D5e used to throw "not supported yet". Now it resolves.
    const dnd: CharacterSheet = { system: "dnd5e", skills: {}, attributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 } };
    const dice = new BcdiceDice(
      cardsOf(dnd),
      stubEval(dnd5eEv({ success: false, failure: true }, 8)),
    );
    // Should resolve, not throw
    const r = await dice.roll({ actorId: p1, skill: "调查" });
    expect(typeof r.success).toBe("boolean");
  });

  test("evaluator returns null (command unrecognized) → throws", async () => {
    const dice = new BcdiceDice(cardsOf(coc7({ 侦查: 60 })), stubEval(null));
    await expect(dice.roll({ actorId: p1, skill: "侦查" })).rejects.toThrow(/not recognized/);
  });
});

// ── D&D5e helpers ────────────────────────────────────────────────────────────

/**
 * Minimal D&D5e sheet. Attributes use the six D&D5e ability names; level drives
 * the proficiency bonus; proficiencies lists the proficient skills/saves.
 */
function dnd5eSheet(over: {
  attributes?: Record<string, number>;
  level?: number;
  proficiencies?: readonly string[];
}): CharacterSheet {
  return {
    system: "dnd5e",
    skills: {},
    attributes: over.attributes ?? { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 },
    ...(over.level !== undefined ? { level: over.level } : {}),
    ...(over.proficiencies !== undefined ? { proficiencies: over.proficiencies } : {}),
  };
}

/** A stub BCDice result for a D&D5e d20 roll: one normal d20. */
function dnd5eEv(over: Partial<BcdiceEval>, d20 = 12): BcdiceEval {
  return {
    text: "test",
    success: false,
    failure: false,
    critical: false,
    fumble: false,
    detailedRands: [{ kind: "normal", sides: 20, value: d20 }],
    ...over,
  };
}

/** Advantage: two d20 rands — BCDice provides both, adapter picks the max. */
function dnd5eEvAdvantage(over: Partial<BcdiceEval>, d20a = 14, d20b = 7): BcdiceEval {
  return {
    text: "test",
    success: false,
    failure: false,
    critical: false,
    fumble: false,
    detailedRands: [
      { kind: "normal", sides: 20, value: d20a },
      { kind: "normal", sides: 20, value: d20b },
    ],
    ...over,
  };
}

describe("BcdiceDice — D&D5e ability check (AR)", () => {
  test("basic check: uses DungeonsAndDragons5 system, AR command, ability mod computed from attributes", async () => {
    // 感知 14 → mod +2; no proficiency; DC 15
    let seen: { s: string; c: string } | undefined;
    const sheet = dnd5eSheet({ attributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 14, 魅力: 10 } });
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEv({ success: true }, 14), (s, c) => (seen = { s, c })),
    );

    const r = await dice.roll({ actorId: p1, skill: "察觉", difficulty: "dc15" });

    expect(seen?.s).toBe("DungeonsAndDragons5");
    expect(seen?.c).toBe("AR+2>=15"); // mod = floor((14-10)/2) = +2
    expect(r.success).toBe(true);
    expect(r.total).toBe(16); // d20=14 + mod=2
    expect(r.detail).toContain("成功");
    expect(r.skill).toBe("察觉");
  });

  test("negative modifier: 力量 7 → mod -2, command AR-2>=10", async () => {
    let cmd = "";
    const sheet = dnd5eSheet({ attributes: { 力量: 7, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 } });
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEv({ failure: true }, 9), (_s, c) => (cmd = c)),
    );

    await dice.roll({ actorId: p1, skill: "运动" });

    expect(cmd).toBe("AR-2>=10"); // mod = floor((7-10)/2) = -2, default DC 10
  });

  test("proficiency adds proficiency bonus to mod (level 1, pb=2)", async () => {
    let cmd = "";
    const sheet = dnd5eSheet({
      attributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 14, 感知: 10, 魅力: 10 },
      level: 1,
      proficiencies: ["调查"],
    });
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEv({ success: true }, 15), (_s, c) => (cmd = c)),
    );

    await dice.roll({ actorId: p1, skill: "调查", difficulty: "dc12" });

    // 智力 14 → mod +2; level 1 → pb=2; proficient → total mod = +4
    expect(cmd).toBe("AR+4>=12");
  });

  test("proficiency bonus scales with level: level 5 → pb=3", async () => {
    let cmd = "";
    const sheet = dnd5eSheet({
      attributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 12, 感知: 10, 魅力: 10 },
      level: 5,
      proficiencies: ["奥秘"],
    });
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEv({ success: true }), (_s, c) => (cmd = c)),
    );

    await dice.roll({ actorId: p1, skill: "奥秘" });

    // 智力 12 → mod +1; level 5 → pb = 2 + floor((5-1)/4) = 3; proficient → +4
    expect(cmd).toBe("AR+4>=10");
  });

  test("skill not in table: falls back to no ability mod, only proficiency if any", async () => {
    let cmd = "";
    const sheet = dnd5eSheet({
      attributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 18, 感知: 10, 魅力: 10 },
    });
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEv({}), (_s, c) => (cmd = c)),
    );

    // "未知技能" is not in the skill→ability table → ability mod = 0
    await dice.roll({ actorId: p1, skill: "未知技能" });
    expect(cmd).toBe("AR+0>=10");
  });

  test("success → detail names 成功", async () => {
    const sheet = dnd5eSheet({});
    const dice = new BcdiceDice(cardsOf(sheet), stubEval(dnd5eEv({ success: true }, 12)));
    const r = await dice.roll({ actorId: p1, skill: "察觉", difficulty: "dc10" });
    expect(r.detail).toContain("成功");
    expect(r.detail).not.toContain("大成功");
    expect(r.success).toBe(true);
  });

  test("failure → detail names 失败", async () => {
    const sheet = dnd5eSheet({});
    const dice = new BcdiceDice(cardsOf(sheet), stubEval(dnd5eEv({ failure: true }, 5)));
    const r = await dice.roll({ actorId: p1, skill: "察觉", difficulty: "dc15" });
    expect(r.detail).toContain("失败");
    expect(r.success).toBe(false);
  });

  test("total = chosen d20 + mod (straight roll)", async () => {
    // 感知 16 → mod +3; d20 = 10 → total = 13
    const sheet = dnd5eSheet({ attributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 16, 魅力: 10 } });
    const dice = new BcdiceDice(cardsOf(sheet), stubEval(dnd5eEv({ success: true }, 10)));
    const r = await dice.roll({ actorId: p1, skill: "察觉" });
    expect(r.total).toBe(13);
  });
});

describe("BcdiceDice — D&D5e advantage / disadvantage", () => {
  test("advantage: chosen d20 = max of the two; A suffix in command", async () => {
    let cmd = "";
    const sheet = dnd5eSheet({ attributes: { 力量: 10, 敏捷: 14, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 } });
    // 敏捷 14 → mod +2; 察觉 maps to 感知; 潜行 maps to 敏捷
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEvAdvantage({ success: true }, 14, 7), (_s, c) => (cmd = c)),
    );

    const r = await dice.roll({ actorId: p1, skill: "潜行", difficulty: "dc12", advantage: "advantage" });

    expect(cmd).toContain("A"); // advantage suffix
    expect(cmd).toMatch(/AR[+\-]\d+>=\d+A$/);
    expect(r.total).toBe(14 + 2); // max(14,7) + mod(敏捷 14→+2)
  });

  test("disadvantage: chosen d20 = min of the two; D suffix in command", async () => {
    let cmd = "";
    const sheet = dnd5eSheet({ attributes: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 } });
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEvAdvantage({ failure: true }, 14, 7), (_s, c) => (cmd = c)),
    );

    const r = await dice.roll({ actorId: p1, skill: "察觉", difficulty: "dc15", advantage: "disadvantage" });

    expect(cmd).toContain("D");
    expect(cmd).toMatch(/AR[+\-]?\d*>=\d+D$/);
    expect(r.total).toBe(7); // min(14,7) + mod 0
  });
});

describe("BcdiceDice — D&D5e attack (AT)", () => {
  test("attack mode uses AT command vs AC", async () => {
    let cmd = "";
    const sheet = dnd5eSheet({
      attributes: { 力量: 18, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 },
      level: 1,
      proficiencies: ["攻击"],
    });
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEv({ success: true }, 12), (_s, c) => (cmd = c)),
    );

    await dice.roll({ actorId: p1, skill: "攻击", difficulty: "16", mode: "attack" });

    // 力量 18 → mod +4; proficient → pb=2; total +6; AC=16
    expect(cmd).toBe("AT+6>=16");
  });

  test("attack fumble: fumble=true → 大失败, success=false", async () => {
    const sheet = dnd5eSheet({});
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEv({ failure: true, fumble: true }, 1)),
    );

    const r = await dice.roll({ actorId: p1, skill: "攻击", difficulty: "15", mode: "attack" });

    expect(r.success).toBe(false);
    expect(r.detail).toContain("大失败");
  });

  test("attack critical: critical=true → 大成功(暴击), success=true", async () => {
    const sheet = dnd5eSheet({});
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEv({ success: true, critical: true }, 20)),
    );

    const r = await dice.roll({ actorId: p1, skill: "攻击", difficulty: "15", mode: "attack" });

    expect(r.success).toBe(true);
    expect(r.detail).toContain("暴击");
  });

  test("attack with advantage uses AT command + A suffix", async () => {
    let cmd = "";
    const sheet = dnd5eSheet({});
    const dice = new BcdiceDice(
      cardsOf(sheet),
      stubEval(dnd5eEvAdvantage({ success: true }, 18, 10), (_s, c) => (cmd = c)),
    );

    await dice.roll({ actorId: p1, skill: "攻击", difficulty: "15", mode: "attack", advantage: "advantage" });

    expect(cmd).toMatch(/AT[+\-]?\d*>=\d+A$/);
  });
});
