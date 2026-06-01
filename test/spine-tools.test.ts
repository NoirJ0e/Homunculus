import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import type { CampaignBible } from "../src/domain/campaign.js";
import { Referee } from "../src/engine/referee.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { dmTools } from "../src/adapters/agent-sdk/engine-mcp.js";

/**
 * #19 — the plot-spine / scene / world-clock kernels exposed as DM-only MCP
 * tools (ADR-0007/0005/0002/0009). The tools are thin wrappers over the pure
 * kernels the Referee now holds; players never see clock digits.
 */
const aidm = actorId("aidm");
const cellar = sceneId("scene:cellar");

const bible: CampaignBible = {
  secretTruth: "市长就是邪教首领。",
  system: "dnd5e",
  tone: "黑色侦探",
  levelBand: [1, 5],
  milestones: [
    { id: "m1", goal: "进城遇袭", enterCue: "城门口的骚乱", scenes: [], triggers: [], branchPoints: [] },
    { id: "m2", goal: "查到邪教线索", enterCue: "地窖的符号", scenes: [], triggers: [], branchPoints: [] },
    { id: "m3", goal: "对峙市长", enterCue: "市政厅", scenes: [], triggers: [], branchPoints: [] },
  ],
  npcs: [],
  worldClocks: [{ id: "cult", name: "邪教仪式", segments: ["平静", "集结", "献祭前夜", "仪式完成"] }],
  bespokeRules: {},
};

/** Find a DM tool by name and invoke its handler with raw args. */
async function callTool(referee: Referee, name: string, args: unknown): Promise<void> {
  const t = dmTools(referee).find((x) => x.name === name);
  if (!t) throw new Error(`no such DM tool: ${name}`);
  await t.handler(args as never, undefined as never);
}

function newReferee(scenes?: Record<string, readonly string[]>): Referee {
  return new Referee({
    aidmId: aidm,
    substrate: new FakeSubstrate(),
    campaign: bible,
    ...(scenes ? { scenes } : {}),
  });
}

describe("#19 spine / scene / world-clock DM tools", () => {
  test("advance_milestone advances the per-branch cursor", async () => {
    const referee = newReferee();
    expect(referee.cursorState()?.currentMilestone).toBe("m1");

    await callTool(referee, "advance_milestone", {});
    expect(referee.cursorState()?.currentMilestone).toBe("m2");
    expect(referee.cursorState()?.completed).toEqual(["m1"]);

    await callTool(referee, "advance_milestone", {});
    expect(referee.cursorState()?.currentMilestone).toBe("m3");
    expect(referee.cursorState()?.completed).toEqual(["m1", "m2"]);
  });

  test("discover_lead records a breadcrumb on the cursor", async () => {
    const referee = newReferee();
    await callTool(referee, "discover_lead", { lead: "下水道的脚印" });
    await callTool(referee, "discover_lead", { lead: "信徒的纹身" });
    await callTool(referee, "discover_lead", { lead: "下水道的脚印" }); // dedup
    expect(referee.cursorState()?.discoveredLeads).toEqual(["下水道的脚印", "信徒的纹身"]);
  });

  test("advance_clock advances the world clock; players see only a band, never digits", async () => {
    const referee = newReferee();
    expect(referee.clockDmView("cult")?.position).toBe(0);
    expect(referee.clockPlayerSignal("cult")?.band).toBe("calm");

    await callTool(referee, "advance_clock", { clockId: "cult" });
    expect(referee.clockDmView("cult")?.position).toBe(1);

    await callTool(referee, "advance_clock", { clockId: "cult" });
    const dm = referee.clockDmView("cult");
    const player = referee.clockPlayerSignal("cult");
    expect(dm?.position).toBe(2);
    expect(player?.band).toBe("imminent");
    // The player signal must never leak the raw number (ADR-0007).
    expect(Object.keys(player!)).toEqual(["name", "band"]);
    expect(JSON.stringify(player)).not.toContain("2");
  });

  test("add_member / remove_member move membership AND visibility follows", async () => {
    const pc = actorId("pc-alice");
    // Tavern starts with the AIDM only-ish; cellar is where the secret post lands.
    const referee = newReferee({ "scene:cellar": [] });

    // A secret post in the cellar; nobody is a member yet → not in pc's horizon.
    await referee.narrate(cellar, "墙上刻着邪教的符号。");
    expect(referee.horizonOf(pc).map((p) => p.prose)).not.toContain("墙上刻着邪教的符号。");

    await callTool(referee, "add_member", { sceneId: cellar, actor: pc });
    expect(referee.membersOf(cellar)).toContainEqual(pc);
    expect(referee.horizonOf(pc).map((p) => p.prose)).toContain("墙上刻着邪教的符号。");

    await callTool(referee, "remove_member", { sceneId: cellar, actor: pc });
    expect(referee.membersOf(cellar)).not.toContainEqual(pc);
    expect(referee.horizonOf(pc).map((p) => p.prose)).not.toContain("墙上刻着邪教的符号。");
  });

  test("all five tools are DM-only — they live in dmTools", () => {
    const referee = newReferee();
    const names = dmTools(referee).map((t) => t.name);
    for (const n of ["advance_milestone", "discover_lead", "advance_clock", "add_member", "remove_member"]) {
      expect(names).toContain(n);
    }
  });
});
