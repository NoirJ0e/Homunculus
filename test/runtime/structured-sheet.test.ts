/**
 * Structured per-system character sheets (#43, ADR-0013). The open-card flow must
 * produce a sheet carrying the mechanical structure the BCDice judge needs — CoC7
 * occupation + characteristics + skill%; D&D5e race/class/level/abilities/
 * proficiencies — not a flat placeholder. These assert the structure is present
 * and system-correct (no cross-system fields leaking in).
 */
import { describe, expect, test } from "vitest";
import { defaultSheetFor } from "../../src/runtime/card-creation.js";

const COC7_ATTRS = ["力量", "体质", "体型", "敏捷", "外貌", "智力", "意志", "教育"];
const DND5E_ABILITIES = ["力量", "敏捷", "体质", "智力", "感知", "魅力"];

describe("structured default sheet — CoC7", () => {
  const s = defaultSheetFor("coc7");

  test("carries occupation, eight characteristics, skill% and sanity", () => {
    expect(s.system).toBe("coc7");
    expect(s.occupation).toBeTruthy();
    for (const a of COC7_ATTRS) expect(s.attributes?.[a]).toBeGreaterThan(0);
    expect(Object.keys(s.skills).length).toBeGreaterThan(0);
    for (const v of Object.values(s.skills)) expect(v).toBeGreaterThan(0);
    expect(s.sanity).toBeGreaterThan(0);
  });

  test("carries NO D&D-only fields (system-correct)", () => {
    expect(s.race).toBeUndefined();
    expect(s.characterClass).toBeUndefined();
    expect(s.level).toBeUndefined();
    expect(s.proficiencies).toBeUndefined();
  });
});

describe("structured default sheet — D&D5e", () => {
  const s = defaultSheetFor("dnd5e");

  test("carries race, class, level, six ability scores and proficiencies", () => {
    expect(s.system).toBe("dnd5e");
    expect(s.race).toBeTruthy();
    expect(s.characterClass).toBeTruthy();
    expect(s.level).toBeGreaterThanOrEqual(1);
    for (const a of DND5E_ABILITIES) expect(s.attributes?.[a]).toBeGreaterThan(0);
    expect(s.proficiencies?.length).toBeGreaterThan(0);
  });

  test("carries NO CoC7-only fields (system-correct)", () => {
    expect(s.occupation).toBeUndefined();
    expect(s.sanity).toBeUndefined();
  });
});
