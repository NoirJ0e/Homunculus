import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { holdInitialDrafts } from "../../runtime/card-creation.js";
import type { CardCreationSession } from "../../runtime/card-creation-session.js";
import type { DiceSystem } from "../../ports/card-store.js";

/**
 * Open-card-assistant MCP adapter (ADR-0009 「能力=进程内工具」, ADR-0012 Phase 5).
 *
 * Closes the draft-pipeline open circuit: the assistant used to be a PLAIN
 * conversational query, so a persona the player spent a session shaping had
 * nowhere to land — `session.drafts` stayed empty and `/verify-card` always
 * adjudicated the genesis fallback. `hold_card` gives the assistant the one
 * write it needs: park the settled concept as PENDING drafts on the session
 * (via the unit-tested {@link holdInitialDrafts}); binding stays verify-pass
 * (#35). Re-calling overwrites — the player changing their mind mid-thread is
 * the normal case, and drafts are only drafts until verified.
 *
 * The session is resolved lazily per call (the tool is created before the
 * session is bound to the thread), and the campaign's rule SYSTEM rides along
 * so a dnd5e campaign's draft gets a dnd5e baseline sheet.
 */

/** Where a held draft lands: the thread's session + the campaign's rule system. */
export interface CardDraftTarget {
  readonly session: CardCreationSession;
  readonly system: DiceSystem;
}

export function cardTools(
  resolveTarget: () => CardDraftTarget | undefined,
): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      "hold_card",
      "把聊定的人设落成 PENDING 草稿持在本开卡 session 上（人设 + 本团系统的机械基线卡），" +
        "供 `/verify-card` 审。玩家确认一版人设后就调用；之后改主意再调一次即覆盖。" +
        "只落草稿，不入库——入库发生在审核通过时。",
      {
        name: z.string().describe("角色名"),
        temperament: z.string().describe("性格/气质，一两句"),
        goals: z.array(z.string()).optional().describe("角色目标（可选，逐条）"),
      },
      async (args) => {
        const target = resolveTarget();
        if (!target) {
          return {
            content: [
              { type: "text", text: "开卡 session 尚未绑定到本线程，草稿没处落——请玩家重新 `/create-character-card`。" },
            ],
          };
        }
        holdInitialDrafts(
          target.session,
          {
            name: args.name,
            temperament: args.temperament,
            ...(args.goals !== undefined && { goals: args.goals }),
          },
          target.system,
        );
        return {
          content: [
            {
              type: "text",
              text: `草稿已落：${args.name}（附 ${target.system} 基线机械卡）。请提示玩家用 \`/verify-card\` 交审；再聊再调可覆盖。`,
            },
          ],
        };
      },
    ),
  ];
}

/** Build the open-card assistant's in-process MCP server for ONE thread. */
export function createCardMcpServer(
  resolveTarget: () => CardDraftTarget | undefined,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: "card", version: "0.1.0", tools: cardTools(resolveTarget) });
}
