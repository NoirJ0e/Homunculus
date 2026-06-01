import { describe, expect, test } from "vitest";
import { genesisTools, type CampaignStore } from "../../src/adapters/agent-sdk/genesis-mcp.js";
import type { CampaignBible } from "../../src/domain/campaign.js";

/**
 * #28/#29-seam — the concierge's genesis_campaign tool registers a CampaignBible
 * in the shared store keyed by campaign id, so the AIDM can read it back and
 * narrate on-theme (the bug the #28 live e2e surfaced). Headless: no SDK call,
 * no discord.js; drive the tool handler directly against a real Map store.
 */
async function callGenesis(store: CampaignStore, args: unknown): Promise<string> {
  const t = genesisTools(store).find((x) => x.name === "genesis_campaign");
  if (!t) throw new Error("no genesis_campaign tool");
  const result = await t.handler(args as never, undefined as never);
  return result.content.map((c) => ("text" in c ? c.text : "")).join("");
}

describe("genesis_campaign MCP tool", () => {
  test("registers a CampaignBible keyed by campaignId, derived from the seed", async () => {
    const store: CampaignStore = new Map<string, CampaignBible>();

    await callGenesis(store, {
      campaignId: "cat-123",
      premise: "沉船湾海底的古老诅咒正在苏醒",
      tone: "克系恐怖",
      desiredClimax: "潜入沉船核心斩断诅咒之源",
      minLevel: 1,
      maxLevel: 5,
    });

    const bible = store.get("cat-123");
    expect(bible).toBeDefined();
    // The deterministic distiller embeds premise/tone/climax into the AIDM 底牌.
    expect(bible?.secretTruth).toContain("沉船湾海底的古老诅咒正在苏醒");
    expect(bible?.secretTruth).toContain("克系恐怖");
    // And derives a 3-act milestone skeleton.
    expect(bible?.milestones.length).toBe(3);
  });

  test("exposes exactly the genesis_campaign tool", () => {
    const names = genesisTools(new Map()).map((t) => t.name);
    expect(names).toEqual(["genesis_campaign"]);
  });
});
