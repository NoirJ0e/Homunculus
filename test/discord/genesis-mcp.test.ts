import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { genesisTools } from "../../src/adapters/agent-sdk/genesis-mcp.js";
import type { CampaignStore } from "../../src/ports/campaign-store.js";
import { FileCampaignStore } from "../../src/adapters/store/file-campaign-store.js";
import { campaignId } from "../../src/domain/ids.js";

/**
 * #32-seam — the concierge's genesis_campaign tool now persists the CampaignBible
 * via the file-backed {@link CampaignStore} PORT (not an in-memory Map), keyed by
 * campaign id, so the AIDM can read it back after a restart and narrate on-theme.
 * Headless: no SDK call, no discord.js; drive the tool handler directly against a
 * real temp-dir FileCampaignStore (cheap, proves the disk path).
 */
async function callGenesis(store: CampaignStore, args: unknown): Promise<string> {
  const t = genesisTools(store).find((x) => x.name === "genesis_campaign");
  if (!t) throw new Error("no genesis_campaign tool");
  const result = await t.handler(args as never, undefined as never);
  return result.content.map((c) => ("text" in c ? c.text : "")).join("");
}

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "homunculus-genesis-mcp-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("genesis_campaign MCP tool", () => {
  test("persists a CampaignBible keyed by campaignId, derived from the seed", async () => {
    const store: CampaignStore = new FileCampaignStore(dataDir);

    await callGenesis(store, {
      campaignId: "cat-123",
      premise: "沉船湾海底的古老诅咒正在苏醒",
      tone: "克系恐怖",
      desiredClimax: "潜入沉船核心斩断诅咒之源",
      minLevel: 1,
      maxLevel: 5,
    });

    const bible = store.get(campaignId("cat-123"));
    expect(bible).toBeDefined();
    // The deterministic distiller embeds premise/tone/climax into the AIDM 底牌.
    expect(bible?.secretTruth).toContain("沉船湾海底的古老诅咒正在苏醒");
    expect(bible?.secretTruth).toContain("克系恐怖");
    // And derives a 3-act milestone skeleton.
    expect(bible?.milestones.length).toBe(3);
  });

  test("a FRESH store over the same dir reads the bible the tool wrote (restart semantics)", async () => {
    await callGenesis(new FileCampaignStore(dataDir), {
      campaignId: "cat-restart",
      premise: "市集深处有一扇不该存在的门",
      tone: "都市怪谈",
      desiredClimax: "封印那扇门",
      minLevel: 1,
      maxLevel: 3,
    });

    // Simulate a process restart: a brand-new instance reads from disk, not memory.
    const reloaded = new FileCampaignStore(dataDir).get(campaignId("cat-restart"));
    expect(reloaded).toBeDefined();
    expect(reloaded?.secretTruth).toContain("市集深处有一扇不该存在的门");
  });

  test("exposes exactly the genesis_campaign tool", () => {
    const names = genesisTools(new FileCampaignStore(dataDir)).map((t) => t.name);
    expect(names).toEqual(["genesis_campaign"]);
  });
});
