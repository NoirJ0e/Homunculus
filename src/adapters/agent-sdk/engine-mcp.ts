import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { actorId, sceneId } from "../../domain/ids.js";
import type { Referee } from "../../engine/referee.js";

/**
 * Engine-as-MCP-referee adapter (ADR-0009). Wraps the pure {@link Referee}'s
 * methods into in-process Agent-SDK MCP tools (`createSdkMcpServer` + `tool()`,
 * Zod schemas). The tool handlers are same-process closures that call the
 * referee directly — zero IPC, shared state.
 *
 * This is an ADAPTER (not part of the engine) precisely because it imports the
 * Agent SDK; the engine purity guard forbids that import under the engine ring.
 *
 * The DM/NPC tool partition is the physical form of pure-narrative co-governance
 * (ADR-0002): the DM server carries `narrate` (and, in later slices, the state
 * writes); the NPC server never will. This slice (#15) ships the DM `narrate`.
 */
export function dmTools(referee: Referee): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      "narrate",
      "AIDM 发叙事：把一段散文落到指定场景的记录并广播给在场者。仅 DM 可用。",
      { sceneId: z.string(), prose: z.string() },
      async (args) => {
        await referee.narrate(sceneId(args.sceneId), args.prose);
        return { content: [{ type: "text", text: `narrated → ${args.sceneId}` }] };
      },
    ),
    tool(
      "await_actors",
      "AIDM 抛屏障：按出手顺序跑一轮简化战斗轮，引擎逐个拉起在场者（NPC 过唤醒闸后出手，真人经收件箱）。全员行动/明确 pass → 返回；真人沉默 → 溢出一轮后挂起（暂停/存档）。仅 DM 可用。",
      { sceneId: z.string(), order: z.array(z.string()) },
      async (args) => {
        const outcome = await referee.awaitActors(
          sceneId(args.sceneId),
          args.order.map(actorId),
        );
        const text =
          outcome.status === "released"
            ? `released: ${outcome.posts.length} post(s)`
            : `held: waiting on ${outcome.pause.waitingOn.join(", ")}`;
        return { content: [{ type: "text", text }] };
      },
    ),
  ];
}

/** Build the DM's in-process MCP tool server (the engine's referee surface). */
export function createDmMcpServer(referee: Referee): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: "engine", version: "0.1.0", tools: dmTools(referee) });
}
