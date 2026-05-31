import { describe, expect, test } from "vitest";
import type { CampaignBible } from "../src/domain/campaign.js";
import { initCursor, completeCurrent, discoverLead } from "../src/engine/milestone-cursor.js";

const bible: CampaignBible = {
  secretTruth: "市长就是邪教首领。",
  milestones: [
    { id: "m1", goal: "进城遇袭", enterCue: "城门口的骚乱", scenes: [], triggers: [], branchPoints: [] },
    { id: "m2", goal: "查到邪教线索", enterCue: "地窖的符号", scenes: [], triggers: [], branchPoints: [] },
    { id: "m3", goal: "对峙市长", enterCue: "市政厅", scenes: [], triggers: [], branchPoints: [] },
  ],
  npcs: [],
  worldClocks: [],
  bespokeRules: {},
};

describe("#11 milestone cursor (per-branch progress)", () => {
  test("a fresh cursor points at the first milestone, nothing completed", () => {
    const c = initCursor(bible);
    expect(c.currentMilestone).toBe("m1");
    expect(c.completed).toEqual([]);
  });

  test("AIDM declaring completion advances the cursor to the next milestone", () => {
    let c = initCursor(bible);
    c = completeCurrent(c, bible);
    expect(c.completed).toEqual(["m1"]);
    expect(c.currentMilestone).toBe("m2");

    c = completeCurrent(c, bible);
    expect(c.currentMilestone).toBe("m3");
  });

  test("completing the final milestone marks the campaign spine done", () => {
    let c = initCursor(bible);
    c = completeCurrent(c, bible); // m1
    c = completeCurrent(c, bible); // m2
    c = completeCurrent(c, bible); // m3 (last)
    expect(c.completed).toEqual(["m1", "m2", "m3"]);
    expect(c.currentMilestone).toBeNull();
  });

  test("discovered leads accumulate (breadcrumbs for soft gravity)", () => {
    let c = initCursor(bible);
    c = discoverLead(c, "下水道的脚印");
    c = discoverLead(c, "信徒的纹身");
    c = discoverLead(c, "下水道的脚印"); // dedup
    expect(c.discoveredLeads).toEqual(["下水道的脚印", "信徒的纹身"]);
  });
});
