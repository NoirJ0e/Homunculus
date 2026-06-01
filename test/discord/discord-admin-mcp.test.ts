import { describe, expect, test } from "vitest";
import {
  adminTools,
  createDiscordAdminMcpServer,
} from "../../src/adapters/agent-sdk/discord-admin-mcp.js";
import type { DiscordAdminPort } from "../../src/ports/discord-admin.js";
import { encodeTopic, parseTopic } from "../../src/adapters/discord/channel-routing.js";

/**
 * #26 — the concierge's Discord-admin MCP surface. Tests inject a STUB
 * DiscordAdminPort that records every call, then drive a "build the 矿坑
 * campaign" sequence through the MCP tools and assert the provisioning order
 * and that the written topic round-trips back to role=aidm + the right campaign.
 *
 * Purity: this exercises the adapter-layer MCP server only; it never imports
 * src/engine/ and never touches real discord.js.
 */

interface RecordedCall {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/** A stub DiscordAdminPort that records calls and hands back synthetic ids. */
function makeStubPort(): { port: DiscordAdminPort; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const port: DiscordAdminPort = {
    async createCategory(name) {
      calls.push({ tool: "createCategory", args: { name } });
      return `cat-${name}`;
    },
    async createTextChannel(categoryId, name) {
      calls.push({ tool: "createTextChannel", args: { categoryId, name } });
      return `chan-${name}`;
    },
    async createWebhook(channelId, name) {
      calls.push({ tool: "createWebhook", args: { channelId, name } });
      return `https://discord.test/webhooks/${channelId}/${name}`;
    },
    async createThread(channelId, name) {
      calls.push({ tool: "createThread", args: { channelId, name } });
      return `thread-${name}`;
    },
    async setChannelTopic(channelId, topic) {
      calls.push({ tool: "setChannelTopic", args: { channelId, topic } });
    },
  };
  return { port, calls };
}

/** Find an admin tool by name and invoke its handler with raw args. */
async function callTool(
  port: DiscordAdminPort,
  name: string,
  args: unknown,
): Promise<string> {
  const t = adminTools(port).find((x) => x.name === name);
  if (!t) throw new Error(`no such admin tool: ${name}`);
  const result = await t.handler(args as never, undefined as never);
  return result.content.map((c) => ("text" in c ? c.text : "")).join("");
}

describe("discord-admin MCP", () => {
  test("drives the 矿坑 campaign skeleton: category → main channel → webhook, topic round-trips to role=aidm", async () => {
    const { port, calls } = makeStubPort();
    const campaign = "mine-01";

    // The concierge provisions the skeleton through the MCP tools.
    const categoryId = await callTool(port, "create_category", {
      name: "凡达林的矿坑",
    });
    const channelId = await callTool(port, "create_text_channel", {
      categoryId,
      name: "主线",
    });
    await callTool(port, "create_webhook", {
      channelId,
      name: "AIDM",
    });
    await callTool(port, "set_channel_topic", {
      channelId,
      topic: encodeTopic({ campaign, role: "aidm" }),
    });

    // Order: category → main text channel → webhook (→ topic).
    expect(calls.map((c) => c.tool)).toEqual([
      "createCategory",
      "createTextChannel",
      "createWebhook",
      "setChannelTopic",
    ]);

    // The text channel was created INSIDE the category just made.
    expect(calls[1]?.args.categoryId).toBe(categoryId);
    // The webhook was created on that very channel.
    expect(calls[2]?.args.channelId).toBe(channelId);

    // The topic written round-trips through parseTopic to the right routing.
    const topicCall = calls.find((c) => c.tool === "setChannelTopic");
    const routing = parseTopic(String(topicCall?.args.topic));
    expect(routing).not.toBeNull();
    expect(routing?.role).toBe("aidm");
    expect(routing?.campaign).toBe(campaign);
  });

  test("exposes exactly the five admin tools, no engine tools", () => {
    const { port } = makeStubPort();
    const names = adminTools(port).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_category",
        "create_text_channel",
        "create_webhook",
        "create_thread",
        "set_channel_topic",
      ].sort(),
    );
    // narrate / await_actors / roll must NOT live on the admin surface.
    expect(names).not.toContain("narrate");
    expect(names).not.toContain("await_actors");
  });

  test("createDiscordAdminMcpServer builds a server named discord-admin", () => {
    const { port } = makeStubPort();
    const server = createDiscordAdminMcpServer(port);
    expect(server.name).toBe("discord-admin");
  });
});
