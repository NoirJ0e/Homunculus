import { describe, expect, test } from "vitest";
import { postAssistantText } from "../../src/runtime/runners.js";
import type { DiscordClient, SentMessage } from "../../src/adapters/discord/discord-substrate.js";

/**
 * Regression for the live "[ready] 但完全没反应" bug: the conversational concierge /
 * card-creation runners drained their query stream but never posted the model's
 * replies back to Discord, so they ran invisibly. `postAssistantText` now does
 * the posting; these tests pin that behavior headless (fake stream + recording
 * client), no real discord.js / SDK.
 */
function recordingClient(): {
  client: DiscordClient;
  posts: Array<{ channelId: string; msg: SentMessage }>;
} {
  const posts: Array<{ channelId: string; msg: SentMessage }> = [];
  const client: DiscordClient = {
    async sendWebhookMessage(channelId, msg) {
      posts.push({ channelId, msg });
    },
    async fetchMessages() {
      return [];
    },
  };
  return { client, posts };
}

async function* fakeStream(msgs: readonly unknown[]): AsyncIterable<unknown> {
  for (const m of msgs) yield m;
}

describe("postAssistantText", () => {
  test("posts each assistant text block to the channel as the given persona", async () => {
    const { client, posts } = recordingClient();

    await postAssistantText(
      client,
      "chan-1",
      "门房",
      fakeStream([
        { type: "assistant", message: { content: [{ type: "text", text: "想跑什么基调的团？" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "好的，建团中…" }] } },
      ]),
    );

    expect(posts.map((p) => p.msg.content)).toEqual(["想跑什么基调的团？", "好的，建团中…"]);
    expect(posts.every((p) => p.channelId === "chan-1" && p.msg.username === "门房")).toBe(true);
  });

  test("skips non-text blocks, blank text, and non-assistant messages", async () => {
    const { client, posts } = recordingClient();

    await postAssistantText(
      client,
      "c",
      "门房",
      fakeStream([
        { type: "system" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use" },
              { type: "text", text: "   " },
              { type: "text", text: "真正的回复" },
            ],
          },
        },
        { type: "result" },
      ]),
    );

    expect(posts.map((p) => p.msg.content)).toEqual(["真正的回复"]);
  });
});
