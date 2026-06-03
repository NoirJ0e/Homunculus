import { describe, expect, test } from "vitest";
import { actorId, campaignId } from "../../src/domain/ids.js";
import { CardCreationSession } from "../../src/runtime/card-creation-session.js";
import type { DiscordClient, SentMessage } from "../../src/adapters/discord/discord-substrate.js";
import {
  STANDARD_COC7_SHEET,
  STANDARD_DND5E_SHEET,
  holdInitialDrafts,
  postCardAssistantText,
} from "../../src/runtime/card-creation.js";

/**
 * #34 — the open-card assistant seams, headless. The live `query()`/LLM is HITL;
 * here we pin (a) the reply-posting path (reuses postAssistantText, persona =
 * 开卡向导) and (b) that the session holds a PENDING soul + sheet draft so #35's
 * verify-bind has something to promote.
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

function makeSession(): CardCreationSession {
  return new CardCreationSession({
    threadId: "thread-1",
    actorId: actorId("p-alice"),
    campaignId: campaignId("mine-01"),
    deliver: () => {},
  });
}

describe("postCardAssistantText", () => {
  test("posts the open-card assistant's replies to the thread as 开卡向导", async () => {
    const { client, posts } = recordingClient();
    await postCardAssistantText(
      client,
      "thread-1",
      fakeStream([
        { type: "assistant", message: { content: [{ type: "text", text: "你的角色叫什么？" }] } },
      ]),
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]?.channelId).toBe("thread-1");
    expect(posts[0]?.msg.username).toBe("开卡向导");
    expect(posts[0]?.msg.content).toBe("你的角色叫什么？");
  });
});

describe("holdInitialDrafts", () => {
  test("holds a PENDING soul + the structured sheet for the campaign's system", () => {
    const session = makeSession();
    expect(session.drafts).toEqual({ status: "pending" });

    holdInitialDrafts(session, { name: "Alice", temperament: "好奇而审慎" }, "coc7");

    const drafts = session.drafts;
    expect(drafts.status).toBe("pending");
    expect(drafts.soul?.id).toBe(actorId("p-alice"));
    expect(drafts.soul?.personaCore.name).toBe("Alice");
    expect(drafts.soul?.personaCore.temperament).toBe("好奇而审慎");
    // Structured baseline matching the campaign system (#43).
    expect(drafts.sheet).toEqual(STANDARD_COC7_SHEET);
  });

  test("a dnd5e campaign holds the structured D&D5e sheet, not a CoC7 one", () => {
    const session = makeSession();
    holdInitialDrafts(session, { name: "Borr", temperament: "鲁莽" }, "dnd5e");
    expect(session.drafts.sheet).toEqual(STANDARD_DND5E_SHEET);
  });
});
