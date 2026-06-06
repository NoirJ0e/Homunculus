/**
 * Structured per-system character sheets (#43, ADR-0013). The open-card flow must
 * produce a sheet carrying the mechanical structure the BCDice judge needs — CoC7
 * occupation + characteristics + skill%; D&D5e race/class/level/abilities/
 * proficiencies — not a flat placeholder. These assert the structure is present
 * and system-correct (no cross-system fields leaking in).
 */
import { describe, expect, test } from "vitest";
import {
  defaultArchetypeFor,
  defaultSheetFor,
  sheetForArchetype,
} from "../../src/runtime/card-creation.js";

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

/**
 * Default ARCHETYPE is system-aware too (#47). The genesis persona must match the
 * campaign's rule system: a CoC7 campaign's empty seat fills with an investigator,
 * NOT the D&D fighter "战士" (the bug — a 1920s 克苏鲁 团长出「AI 战士」).
 */
describe("default archetype — system-aware", () => {
  test("CoC7 defaults to a CoC investigator archetype, not a D&D class", () => {
    const a = defaultArchetypeFor("coc7");
    expect(a).toBe("调查员");
    expect(a).not.toBe("战士");
  });

  test("D&D5e defaults to 战士", () => {
    expect(defaultArchetypeFor("dnd5e")).toBe("战士");
  });
});

/**
 * archetype → mechanical sheet (#47 core). The structured sheet must actually
 * VARY by archetype — not collapse to one system baseline — so a 游侠 rolls with
 * ranger values and a 医生 with a doctor's skills. CoC7 checks read `skills`;
 * D&D5e checks read `attributes` + `proficiencies` (see bcdice-dice), so those are
 * the fields that must differ.
 */
describe("sheetForArchetype — archetype shapes the mechanical sheet", () => {
  test("CoC7: different archetypes yield different occupation AND skills", () => {
    const a = sheetForArchetype("coc7", "调查员");
    const b = sheetForArchetype("coc7", "医生");
    expect(a.system).toBe("coc7");
    expect(b.system).toBe("coc7");
    expect(a.occupation).not.toBe(b.occupation);
    // The doctor's check-driving skills differ from the generic investigator's.
    expect(a.skills).not.toEqual(b.skills);
  });

  test("D&D5e: different archetypes yield different class AND ability emphasis", () => {
    const fighter = sheetForArchetype("dnd5e", "战士");
    const wizard = sheetForArchetype("dnd5e", "法师");
    expect(fighter.characterClass).not.toBe(wizard.characterClass);
    // The wizard leans 智力, the fighter 力量 — the modifier-driving scores differ.
    expect(fighter.attributes?.["力量"]).not.toBe(wizard.attributes?.["力量"]);
    expect(fighter.attributes?.["智力"]).not.toBe(wizard.attributes?.["智力"]);
    expect(fighter.proficiencies).not.toEqual(wizard.proficiencies);
  });

  test("unknown archetype falls back to the system baseline", () => {
    expect(sheetForArchetype("coc7", "忍者")).toEqual(defaultSheetFor("coc7"));
    expect(sheetForArchetype("dnd5e", "武僧")).toEqual(defaultSheetFor("dnd5e"));
  });

  test("the default archetype's sheet IS the system baseline (consistency)", () => {
    expect(sheetForArchetype("coc7", defaultArchetypeFor("coc7"))).toEqual(defaultSheetFor("coc7"));
    expect(sheetForArchetype("dnd5e", defaultArchetypeFor("dnd5e"))).toEqual(defaultSheetFor("dnd5e"));
  });

  test("a non-default archetype stays system-correct (no cross-system fields)", () => {
    const doctor = sheetForArchetype("coc7", "医生");
    expect(doctor.race).toBeUndefined();
    expect(doctor.characterClass).toBeUndefined();
    expect(doctor.proficiencies).toBeUndefined();

    const wizard = sheetForArchetype("dnd5e", "法师");
    expect(wizard.occupation).toBeUndefined();
    expect(wizard.sanity).toBeUndefined();
  });
});
