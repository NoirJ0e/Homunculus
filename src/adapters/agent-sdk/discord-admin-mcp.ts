import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import type { DiscordAdminPort } from "../../ports/discord-admin.js";
import { encodeTopic } from "../discord/channel-routing.js";

/**
 * Discord-admin MCP adapter (ADR-0011). Wraps an injected {@link DiscordAdminPort}
 * into in-process Agent-SDK MCP tools (`createSdkMcpServer` + `tool()`, Zod
 * schemas), exactly parallel to `engine-mcp.ts`. The concierge skill mounts
 * THESE tools (and only these) to provision a campaign's channel skeleton.
 *
 * Purity: this server lives in the ADAPTER ring and MUST NOT import anything
 * from `src/engine/`. The concierge's `narrate`/`await_actors` powers do not
 * exist here — provisioning and narration are physically separate surfaces.
 */
export function adminTools(admin: DiscordAdminPort): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      "create_category",
      "建一个 Category（= 一场团的文件夹，如「凡达林的矿坑」）。返回新 category 的 id，供建主线频道时作父级。",
      { name: z.string() },
      async (args) => {
        const id = await admin.createCategory(args.name);
        return { content: [{ type: "text", text: id }] };
      },
    ),
    tool(
      "create_text_channel",
      "在指定 category 下建一个文字频道（= AIDM 主线场景）。返回新频道的 id。",
      { categoryId: z.string(), name: z.string() },
      async (args) => {
        const id = await admin.createTextChannel(args.categoryId, args.name);
        return { content: [{ type: "text", text: id }] };
      },
    ),
    tool(
      "create_webhook",
      "在指定频道上建一个 webhook（用来以角色分身的用户名/头像发言）。返回 webhook URL。",
      { channelId: z.string(), name: z.string() },
      async (args) => {
        const url = await admin.createWebhook(args.channelId, args.name);
        return { content: [{ type: "text", text: url }] };
      },
    ),
    tool(
      "create_thread",
      "在指定频道下建一个 thread（如开卡子场景）。返回新 thread 的 id。",
      { channelId: z.string(), name: z.string() },
      async (args) => {
        const id = await admin.createThread(args.channelId, args.name);
        return { content: [{ type: "text", text: id }] };
      },
    ),
    tool(
      "set_channel_topic",
      "把路由指针写进频道 topic（dispatcher 据此判频道 role）。你只给结构化字段——campaign（用 create_category 返回的 id 作稳定标识）、role、可选 scene——topic 字符串由路由编解码器确定性生成，你【不要】自己拼 topic 文本（否则会漏掉命名空间前缀，dispatcher 读不出来）。",
      {
        channelId: z.string(),
        campaign: z.string(),
        role: z.enum(["aidm", "concierge", "cardcreation"]),
        scene: z.string().optional(),
      },
      async (args) => {
        const topic = encodeTopic(
          args.scene !== undefined
            ? { campaign: args.campaign, role: args.role, scene: args.scene }
            : { campaign: args.campaign, role: args.role },
        );
        await admin.setChannelTopic(args.channelId, topic);
        return { content: [{ type: "text", text: `topic set on ${args.channelId}: ${topic}` }] };
      },
    ),
  ];
}

/** Build the concierge's in-process Discord-admin MCP server. */
export function createDiscordAdminMcpServer(
  admin: DiscordAdminPort,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "discord-admin",
    version: "0.1.0",
    tools: adminTools(admin),
  });
}
