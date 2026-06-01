import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import type { CampaignStore } from "../../ports/campaign-store.js";
import { campaignId } from "../../domain/ids.js";
import { genesisCampaign } from "../../genesis/campaign-genesis.js";

/**
 * genesis-mcp.ts — the concierge's campaign-genesis tool (ADR-0011, closing the
 * gap #28's live e2e surfaced: without this the AIDM only saw a Discord category
 * id as "campaign" and narrated off-theme content).
 *
 * `genesis_campaign` takes the chatted-out CampaignSeed, runs the deterministic
 * `genesisCampaign` distiller, and PERSISTS the resulting bible via the injected
 * {@link CampaignStore} port keyed by campaign id (= the Discord category id the
 * concierge just created). The AIDM runner reads it back to build a brief.
 *
 * #32: the store is now the file-backed CampaignStore (ADR-0012), so campaign
 * context survives a restart — the bible lands on disk, not just in memory.
 *
 * Purity: adapter ring; imports only the port + genesis + domain types, never
 * src/engine/. AIDM stays read-only (ADR-0002); this is the concierge write seam.
 */
export function genesisTools(store: CampaignStore): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      "genesis_campaign",
      "把聊好的 CampaignSeed 展开成战役（确定性 genesis）并登记到 campaignId（= create_category 返回的 category id），供 AIDM 之后读取开场。在 create_category 之后、set_channel_topic 之前调用。",
      {
        campaignId: z.string(),
        premise: z.string(),
        tone: z.string(),
        desiredClimax: z.string(),
        minLevel: z.number(),
        maxLevel: z.number(),
      },
      async (args) => {
        const bible = genesisCampaign({
          premise: args.premise,
          tone: args.tone,
          desiredClimax: args.desiredClimax,
          levelBand: [args.minLevel, args.maxLevel],
        });
        store.set(campaignId(args.campaignId), bible);
        return {
          content: [
            {
              type: "text",
              text: `campaign ${args.campaignId} 已展开并登记（${bible.milestones.length} 个里程碑）`,
            },
          ],
        };
      },
    ),
  ];
}

/** Build the concierge's in-process campaign-genesis MCP server. */
export function createGenesisMcpServer(store: CampaignStore): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: "genesis", version: "0.1.0", tools: genesisTools(store) });
}
