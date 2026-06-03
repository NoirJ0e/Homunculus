import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Referee } from "../../engine/referee.js";
import { createDmMcpServer } from "./engine-mcp.js";

/**
 * sdk-runner.ts — the live Agent-SDK glue (ADR-0010). NOT unit-tested: it is the
 * irreducible HITL boundary (real query(), real auth via CLAUDE_CODE_OAUTH_TOKEN
 * / ANTHROPIC_API_KEY in env). The testable cores are the drivers/prompts that
 * consume these via DI seams. Validated by the Phase-0 spike + the Phase-5 run.
 */

/** Collect the assistant text from a finished one-shot query stream. */
async function collectText(stream: AsyncIterable<unknown>): Promise<string> {
  let out = "";
  for await (const msg of stream as AsyncIterable<{
    type: string;
    error?: string;
    message?: { content?: Array<{ type: string; text?: string }> };
  }>) {
    if (msg.type === "assistant") {
      if (msg.error) throw new Error(`NPC query error: ${msg.error}`);
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text" && block.text) out += block.text;
      }
    }
  }
  return out;
}

/** The NPC's `generate` seam: one self-contained query turn → its prose. */
export async function npcGenerate(prompt: string): Promise<string> {
  return collectText(
    query({ prompt, options: { permissionMode: "bypassPermissions", maxTurns: 1 } }),
  );
}

/**
 * The DM's `runQuery` seam: a long-lived self-driving query() wired to the
 * engine's MCP tools. allowedTools is a strict allowlist of the two engine
 * tools, so the DM cannot reach the SDK's built-in Bash/file tools.
 */
export function dmQueryStream(referee: Referee, systemPrompt: string): AsyncIterable<unknown> {
  return query({
    prompt:
      "开始主持这场牌局：先用 narrate 发一段开场叙事，再用 await_actors 抛屏障等在场者回应；收齐后继续 narrate 推进。" +
      "当某个角色的行动需要机械结算（检定/攻击）时，用 call_check 对该角色喊检定（声明技能、难度=DC、mode），" +
      "然后照常 await_actors——由该角色自己用 /check 掷骰，你不要替他掷。",
    options: {
      systemPrompt,
      mcpServers: { engine: createDmMcpServer(referee) },
      allowedTools: [
        "mcp__engine__narrate",
        "mcp__engine__await_actors",
        // #44 — the AIDM 喊检定 (declares WHAT to roll); the player pulls the
        // trigger via `/check`, the NPC via its own `roll`. The AIDM never
        // auto-rolls (ADR-0013); a silent human holds the barrier (ADR-0003).
        "mcp__engine__call_check",
      ],
      permissionMode: "bypassPermissions",
    },
  });
}
