import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import type { DiscordAdminPort } from "../../ports/discord-admin.js";

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
      "把路由指针写进频道 topic（dispatcher 据此判频道 role）。topic 字符串必须由路由编解码器（encodeTopic）生成，不要手拼。",
      { channelId: z.string(), topic: z.string() },
      async (args) => {
        await admin.setChannelTopic(args.channelId, args.topic);
        return { content: [{ type: "text", text: `topic set on ${args.channelId}` }] };
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
