import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import type { CampaignBible } from "../../domain/campaign.js";
import { genesisCampaign } from "../../genesis/campaign-genesis.js";

/**
 * genesis-mcp.ts — the concierge's campaign-genesis tool (ADR-0011, closing the
 * gap #28's live e2e surfaced: without this the AIDM only saw a Discord category
 * id as "campaign" and narrated off-theme content).
 *
 * `genesis_campaign` takes the chatted-out CampaignSeed, runs the deterministic
 * `genesisCampaign` distiller, and REGISTERS the resulting bible in a shared
 * in-memory {@link CampaignStore} keyed by campaign id (= the Discord category id
 * the concierge just created). The AIDM runner reads it back to build a brief.
 *
 * v1 SCOPE: the store is in-memory (single process), so campaign context is lost
 * on restart — PERSISTENT, evolving campaign/soul storage (keyed by campaign id,
 * tied to ADR-0004 git canonicity) is the separate slice #29. This deliberately
 * does NOT decide a persistence location.
 *
 * Purity: adapter ring; imports only genesis + domain types, never src/engine/.
 */
export type CampaignStore = Map<string, CampaignBible>;

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
        store.set(args.campaignId, bible);
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
