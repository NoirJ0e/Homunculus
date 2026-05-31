import { describe, expect, test } from "vitest";
import {
  genesisCampaign,
  ownerView,
  type CampaignSeed,
} from "../src/genesis/campaign-genesis.js";

const seed: CampaignSeed = {
  premise: "一个腐败的城市官员正在秘密扶植邪教",
  tone: "黑色侦探",
  desiredClimax: "在邪教仪式上揭穿市长的真面目",
  levelBand: [1, 5],
};

describe("#12 campaign genesis — blindbox seed expansion", () => {
  test("a one-sentence seed produces a runnable CampaignBible with ≥2 milestones", () => {
    const bible = genesisCampaign(seed);
    expect(bible.milestones.length).toBeGreaterThanOrEqual(2);
  });

  test("every milestone has a non-empty goal and enterCue", () => {
    const bible = genesisCampaign(seed);
    for (const m of bible.milestones) {
      expect(m.goal.trim().length).toBeGreaterThan(0);
      expect(m.enterCue.trim().length).toBeGreaterThan(0);
      expect(m.id.trim().length).toBeGreaterThan(0);
    }
  });

  test("the generated bible has ≥1 world clock", () => {
    const bible = genesisCampaign(seed);
    expect(bible.worldClocks.length).toBeGreaterThanOrEqual(1);
  });

  test("each world clock has ≥2 named segments", () => {
    const bible = genesisCampaign(seed);
    for (const wc of bible.worldClocks) {
      expect(wc.segments.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("the generated bible has a non-empty secretTruth (AIDM-private)", () => {
    const bible = genesisCampaign(seed);
    expect(bible.secretTruth.trim().length).toBeGreaterThan(0);
  });

  test("milestones are in coarse skeleton form — scenes/triggers/branchPoints empty (JIT)", () => {
    const bible = genesisCampaign(seed);
    for (const m of bible.milestones) {
      // Coarse skeleton: details are JIT, so scenes and triggers start empty
      expect(Array.from(m.scenes)).toEqual([]);
      expect(Array.from(m.triggers)).toEqual([]);
      expect(Array.from(m.branchPoints)).toEqual([]);
    }
  });

  // BLINDBOX default (ADR-0007): owner-facing view omits secretTruth
  test("ownerView in blindbox mode (default) omits secretTruth", () => {
    const bible = genesisCampaign(seed);
    const view = ownerView(bible);
    expect(Object.keys(view)).not.toContain("secretTruth");
  });

  test("ownerView in blindbox mode still exposes milestones and worldClocks", () => {
    const bible = genesisCampaign(seed);
    const view = ownerView(bible);
    expect(view.milestones.length).toBeGreaterThanOrEqual(2);
    expect(view.worldClocks.length).toBeGreaterThanOrEqual(1);
  });

  test("ownerView in spoiler mode includes secretTruth", () => {
    const bible = genesisCampaign(seed);
    const view = ownerView(bible, "spoiler");
    expect("secretTruth" in view).toBe(true);
    if ("secretTruth" in view) {
      expect((view as { secretTruth: string }).secretTruth.trim().length).toBeGreaterThan(0);
    }
  });

  test("ownerView in co-create mode includes secretTruth", () => {
    const bible = genesisCampaign(seed);
    const view = ownerView(bible, "co-create");
    expect("secretTruth" in view).toBe(true);
  });

  // blindbox mode explicitly
  test("genesisCampaign with explicit blindbox option produces same shape", () => {
    const bible = genesisCampaign(seed, { mode: "blindbox" });
    expect(bible.milestones.length).toBeGreaterThanOrEqual(2);
    expect(bible.secretTruth.trim().length).toBeGreaterThan(0);
  });

  // spoiler mode: same bible (secretTruth always in the bible; ownerView is the gating layer)
  test("genesisCampaign with spoiler opt still has secretTruth in the full bible", () => {
    const bible = genesisCampaign(seed, { mode: "spoiler" });
    expect(bible.secretTruth.trim().length).toBeGreaterThan(0);
  });

  // Determinism: same seed → same output every time (no randomness)
  test("genesis is deterministic — same seed produces identical output", () => {
    const b1 = genesisCampaign(seed);
    const b2 = genesisCampaign(seed);
    expect(b1).toEqual(b2);
  });

  // bespokeRules starts empty (v1 residual bucket)
  test("bespokeRules is an empty object in v1", () => {
    const bible = genesisCampaign(seed);
    expect(bible.bespokeRules).toEqual({});
  });
});
