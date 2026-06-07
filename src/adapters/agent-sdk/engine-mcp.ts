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
      "nominate",
      "AIDM 串行点名（取代批量 await_actors，ADR-0003 改写）：点名一个在场角色 actor、附一句 in-fiction 的 cue 散文 desc，引擎阻塞这一槽直到该角色出手/掷骰/pass（真人沉默则无限期挂起=暂停/存档），然后把【该角色这一拍做了什么】+【本轮还剩谁没点 remaining】返回给你——你据此决定要不要喊检定、接下来点谁。引擎兜底：只能点 remaining 内的角色，点重复/点不在场会被拒；本轮全员点完才进下一轮（自动重置为全员）。仅 DM 可用。",
      { sceneId: z.string(), actor: z.string(), desc: z.string().optional() },
      async (args) => {
        const res = await referee.nominate(
          sceneId(args.sceneId),
          actorId(args.actor),
          args.desc,
        );
        const left =
          res.remaining.length > 0 ? `还剩：${res.remaining.join("、")}` : "本轮已全部点完";
        let text: string;
        switch (res.kind) {
          case "rejected":
            text = `点名被拒：${res.reason}。${left}`;
            break;
          case "held":
            text = `${res.actor} 沉默（真人未回应）→ 屏障挂起=暂停/存档；轮到他时仍等他。`;
            break;
          case "acted":
            text = `${res.actor}：${res.prose}\n${left}`;
            break;
          case "passed":
            text = `${res.actor} 过（没有要说/做的）。${left}`;
            break;
          case "checked":
            text = `${res.actor} 掷 ${res.skill}：${res.detail}（${res.success ? "成功" : "失败"}，total=${res.total}）\n${left}`;
            break;
        }
        return { content: [{ type: "text", text }] };
      },
    ),
    tool(
      "call_check",
      "AIDM 喊检定：对某个角色就某项技能/难度发起检定（只喊不掷）。引擎登记为待掷，待该角色自己 roll 时由骰子裁决。mode 区分 check（属性检定，默认）与 attack（攻击骰，difficulty=目标 AC）。仅 DM 可用。",
      {
        actor: z.string(),
        skill: z.string(),
        difficulty: z.string().optional(),
        mode: z.enum(["check", "attack"]).optional(),
      },
      async (args) => {
        await referee.callCheck(actorId(args.actor), args.skill, args.difficulty, args.mode);
        return { content: [{ type: "text", text: `check called on ${args.actor}: ${args.skill}` }] };
      },
    ),
    tool(
      "read_card",
      "AIDM 只读查看某角色的机械数值卡（ADR-0001/0002）。只读——没有 write_card：骰子权威（v1 = NativeDice）是角色卡的唯一写者。仅 DM 可用。",
      { actor: z.string() },
      async (args) => {
        const sheet = referee.readCard(actorId(args.actor));
        return { content: [{ type: "text", text: JSON.stringify(sheet ?? null) }] };
      },
    ),
    tool(
      "advance_milestone",
      "AIDM 判定当前里程碑达成：推进剧情脊柱游标到下一节点（ADR-0007）。仅 DM 可用。",
      {},
      async () => {
        referee.advanceMilestone();
        const cur = referee.cursorState()?.currentMilestone ?? "<spine-done>";
        return { content: [{ type: "text", text: `milestone → ${cur}` }] };
      },
    ),
    tool(
      "discover_lead",
      "AIDM 记录一条线索面包屑（软引力的燃料，ADR-0007）。仅 DM 可用。",
      { lead: z.string() },
      async (args) => {
        referee.discoverLead(args.lead);
        return { content: [{ type: "text", text: `lead recorded: ${args.lead}` }] };
      },
    ),
    tool(
      "advance_clock",
      "AIDM 推进一个隐藏世界时钟（反派计划/沦陷度，ADR-0007）。玩家永远只感知定性程度，看不到数字。仅 DM 可用。",
      { clockId: z.string() },
      async (args) => {
        referee.advanceClock(args.clockId);
        return { content: [{ type: "text", text: `clock ticked: ${args.clockId}` }] };
      },
    ),
    tool(
      "add_member",
      "AIDM 把一个角色加入场景（ADR-0005）：其可见地平线随即包含该场景的记录。仅 DM 可用。",
      { sceneId: z.string(), actor: z.string() },
      async (args) => {
        referee.addMember(sceneId(args.sceneId), actorId(args.actor));
        return { content: [{ type: "text", text: `${args.actor} → ${args.sceneId}` }] };
      },
    ),
    tool(
      "remove_member",
      "AIDM 把一个角色移出场景（ADR-0005）：该场景的记录随即离开其地平线。仅 DM 可用。",
      { sceneId: z.string(), actor: z.string() },
      async (args) => {
        referee.removeMember(sceneId(args.sceneId), actorId(args.actor));
        return { content: [{ type: "text", text: `${args.actor} ✕ ${args.sceneId}` }] };
      },
    ),
  ];
}

/**
 * The NPC's in-process MCP tool surface (ADR-0009). The DM/NPC partition is
 * physical: NPCs get `roll` and NOTHING else — never `narrate`, `call_check`,
 * or `read_card`. `roll` resolves only the calling character's OWN pending
 * check (enforced in the referee); there is no way to roll another's.
 */
export function npcTools(referee: Referee): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      "roll",
      "角色掷骰：解析 AIDM 对自己喊的待掷检定（.ra）。只能掷自己的待掷检定。掷骰的实际裁决发生在引擎拉起该角色的出手槽时。",
      { actor: z.string() },
      async (args) => {
        // The roll is resolved by the engine during `await_actors` (the round
        // pulls the actor up and consumes its own pending check). This tool is
        // the NPC-side signal of intent; it carries no resolution itself.
        void referee;
        return { content: [{ type: "text", text: `roll intent: ${args.actor}` }] };
      },
    ),
  ];
}

/** Build the DM's in-process MCP tool server (the engine's referee surface). */
export function createDmMcpServer(referee: Referee): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: "engine", version: "0.1.0", tools: dmTools(referee) });
}

/** Build the NPC's in-process MCP tool server — the `roll`-only partition. */
export function createNpcMcpServer(referee: Referee): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: "engine-npc", version: "0.1.0", tools: npcTools(referee) });
}
