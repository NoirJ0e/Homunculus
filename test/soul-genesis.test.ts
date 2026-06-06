import { describe, expect, test } from "vitest";
import { actorId } from "../src/domain/ids.js";
import {
  genesisSoul,
  genesisFullAuto,
  type SoulSeed,
} from "../src/genesis/soul-genesis.js";

describe("#12 soul genesis — structured persona core from seed", () => {
  const id = actorId("soul:renn");

  // --- genesisSoul (light seed path) ---

  test("genesisSoul produces a Soul with a structured PersonaCore", () => {
    const seed: SoulSeed = {
      name: "蕾恩",
      concept: "流浪的银发精灵猎手，隐藏着过去的背叛",
    };
    const soul = genesisSoul(id, seed);
    expect(soul.id).toBe(id);
    expect(soul.personaCore.name).toBe("蕾恩");
    expect(soul.personaCore.temperament.trim().length).toBeGreaterThan(0);
    expect(soul.personaCore.goals.length).toBeGreaterThan(0);
  });

  test("genesisSoul distills a non-empty temperament from the seed concept", () => {
    const seed: SoulSeed = { name: "蕾恩", concept: "孤独的侦探，坚信秩序高于一切" };
    const soul = genesisSoul(id, seed);
    expect(soul.personaCore.temperament.trim().length).toBeGreaterThan(0);
  });

  test("genesisSoul with explicit goals overrides derived goals", () => {
    const seed: SoulSeed = {
      name: "蕾恩",
      concept: "战士",
      goals: ["找回失散的弟弟", "洗清家族污名"],
    };
    const soul = genesisSoul(id, seed);
    expect(soul.personaCore.goals).toEqual(["找回失散的弟弟", "洗清家族污名"]);
  });

  test("genesisSoul produces empty episodic memory (new soul)", () => {
    const seed: SoulSeed = { name: "蕾恩", concept: "任意概念" };
    const soul = genesisSoul(id, seed);
    expect(soul.episodic).toEqual([]);
  });

  test("genesisSoul produces a PersonaCore with all required fields", () => {
    const seed: SoulSeed = { name: "蕾恩", concept: "神秘的法师" };
    const soul = genesisSoul(id, seed);
    const pc = soul.personaCore;
    // All required PersonaCore fields must be present and valid types
    expect(typeof pc.name).toBe("string");
    expect(typeof pc.temperament).toBe("string");
    expect(Array.isArray(pc.goals)).toBe(true);
    expect(typeof pc.relationships).toBe("object");
    expect(typeof pc.plotSummary).toBe("string");
  });

  test("genesisSoul is deterministic — same seed yields same soul", () => {
    const seed: SoulSeed = { name: "蕾恩", concept: "孤独的猎人" };
    const s1 = genesisSoul(id, seed);
    const s2 = genesisSoul(id, seed);
    expect(s1).toEqual(s2);
  });

  // --- genesisFullAuto (one-click full auto path) ---

  test("genesisFullAuto produces a complete Soul from an archetype label", () => {
    const soul = genesisFullAuto(actorId("soul:auto-1"), "骗术师");
    expect(soul.personaCore.name.trim().length).toBeGreaterThan(0);
    expect(soul.personaCore.temperament.trim().length).toBeGreaterThan(0);
    expect(soul.personaCore.goals.length).toBeGreaterThan(0);
  });

  test("genesisFullAuto always populates name, temperament, and goals", () => {
    const archetypes = ["战士", "法师", "游侠", "盗贼", "牧师"];
    for (const archetype of archetypes) {
      const soul = genesisFullAuto(actorId(`soul:${archetype}`), archetype);
      expect(soul.personaCore.name.trim().length).toBeGreaterThan(0);
      expect(soul.personaCore.temperament.trim().length).toBeGreaterThan(0);
      expect(soul.personaCore.goals.length).toBeGreaterThan(0);
    }
  });

  test("genesisFullAuto produces a PersonaCore with all required fields", () => {
    const soul = genesisFullAuto(actorId("soul:auto-2"), "骑士");
    const pc = soul.personaCore;
    expect(typeof pc.name).toBe("string");
    expect(typeof pc.temperament).toBe("string");
    expect(Array.isArray(pc.goals)).toBe(true);
    expect(typeof pc.relationships).toBe("object");
    expect(typeof pc.plotSummary).toBe("string");
  });

  test("genesisFullAuto produces empty episodic memory (fresh soul)", () => {
    const soul = genesisFullAuto(actorId("soul:auto-3"), "德鲁伊");
    expect(soul.episodic).toEqual([]);
  });

  test("genesisFullAuto is deterministic — same archetype yields same soul id notwithstanding", () => {
    const id1 = actorId("soul:det-1");
    const id2 = actorId("soul:det-2");
    const s1 = genesisFullAuto(id1, "法师");
    const s2 = genesisFullAuto(id2, "法师");
    // Same archetype → same personaCore content (different id is expected)
    expect(s1.personaCore).toEqual(s2.personaCore);
  });

  // --- CoC investigator archetypes (#47 — system-aware genesis) ---
  // A CoC campaign must NOT conjure a D&D fighter ("铁拳·冈") nor fall through to
  // the generic FALLBACK ("无名旅者"); CoC archetypes resolve to real investigators.

  test("genesisFullAuto resolves CoC archetypes to distinct, non-fighter, non-fallback personas", () => {
    const cocArchetypes = ["调查员", "记者", "私家侦探", "医生", "教授", "古董商"];
    const names = new Set<string>();
    for (const archetype of cocArchetypes) {
      const soul = genesisFullAuto(actorId(`soul:${archetype}`), archetype);
      expect(soul.personaCore.name.trim().length).toBeGreaterThan(0);
      expect(soul.personaCore.temperament.trim().length).toBeGreaterThan(0);
      expect(soul.personaCore.goals.length).toBeGreaterThan(0);
      // NOT the D&D fighter preset, NOT the generic fallback.
      expect(soul.personaCore.name).not.toBe("铁拳·冈");
      expect(soul.personaCore.name).not.toBe("无名旅者");
      names.add(soul.personaCore.name);
    }
    // Each CoC archetype is its own preset, not all collapsing to one.
    expect(names.size).toBe(cocArchetypes.length);
  });
});
