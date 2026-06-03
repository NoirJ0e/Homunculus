/**
 * Unit tests for DiscordInbox (issue #4).
 *
 * Architecture under test:
 *   - DiscordInbox implements HumanInboxPort.
 *   - poll(actor, sceneId) fetches inbound Discord messages from the thread
 *     mapped to sceneId since the last poll, and maps them to HumanTurn:
 *       - exactly "pass" or "pass你们继续" → { kind: "pass" }
 *       - any other non-empty text → { kind: "prose", prose } (incl. ".ra …",
 *         ADR-0013: rolling moved to the `/check` slash command)
 *       - no messages (silence) → undefined
 *   - Only messages from the given actor (by Discord user ID) are returned.
 *   - A second poll with no new messages → undefined.
 *   - sceneId with no thread mapping → throws DiscordInboxError.
 *
 * All tests use a stub DiscordClient — zero real network calls.
 */

import { describe, expect, test } from "vitest";
import {
  DiscordInbox,
  type InboundMessage,
  DiscordInboxError,
} from "../../src/adapters/discord/discord-inbox.js";
import { FakeHumanInbox } from "../../src/adapters/memory/fake-human-inbox.js";
import type { HumanInboxPort } from "../../src/ports/human-inbox.js";
import { actorId, sceneId } from "../../src/domain/ids.js";
import type { ActorPersona, SceneThreadMap } from "../../src/adapters/discord/scene-threads.js";
import type { DiscordClient, SentMessage } from "../../src/adapters/discord/discord-substrate.js";

// ---------------------------------------------------------------------------
// Helpers — push-able stub client
// ---------------------------------------------------------------------------

/**
 * A stub DiscordClient whose message queue can be pushed to by tests.
 * fetchMessages returns the queued messages and clears the queue (simulates
 * Discord returning new messages since last poll).
 */
function pushableClient(): DiscordClient & {
  push(threadId: string, msg: InboundMessage): void;
} {
  const queues: Map<string, InboundMessage[]> = new Map();
  return {
    push(threadId: string, msg: InboundMessage): void {
      const q = queues.get(threadId) ?? [];
      q.push(msg);
      queues.set(threadId, q);
    },
    async sendWebhookMessage(_threadId: string, _message: SentMessage): Promise<void> {
      // no-op in inbox tests
    },
    async fetchMessages(threadId: string, _since?: string): Promise<InboundMessage[]> {
      const msgs = queues.get(threadId) ?? [];
      queues.set(threadId, []);
      return msgs;
    },
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const tavernScene = sceneId("scene-tavern");
const dungeonScene = sceneId("scene-dungeon");
const humanId = actorId("actor-human-player");
const secondHumanId = actorId("actor-human-player-2");

/** Discord user ID corresponding to actor-human-player */
const humanDiscordId = "discord-user-111";
const secondDiscordId = "discord-user-222";

const personas: ActorPersona[] = [
  {
    actorId: humanId,
    username: "Thorin the Fighter",
    avatarURL: "https://cdn.example.com/thorin.png",
    discordUserId: humanDiscordId,
  },
  {
    actorId: secondHumanId,
    username: "Mira the Mage",
    avatarURL: "https://cdn.example.com/mira.png",
    discordUserId: secondDiscordId,
  },
];

const threadMap: SceneThreadMap = {
  [tavernScene]: "thread-tavern-001",
  [dungeonScene]: "thread-dungeon-007",
};

// ---------------------------------------------------------------------------
// Silence: no messages → undefined
// ---------------------------------------------------------------------------

describe("DiscordInbox — silence (no messages) → undefined", () => {
  test("returns undefined when no messages in the thread", async () => {
    const client = pushableClient();
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn).toBeUndefined();
  });

  test("returns undefined after all queued messages are consumed", async () => {
    const client = pushableClient();
    client.push("thread-tavern-001", {
      userId: humanDiscordId,
      content: "Hello everyone.",
      messageId: "msg-1",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    // First poll consumes the message
    const first = await inbox.poll(humanId, tavernScene);
    expect(first?.kind).toBe("prose");

    // Second poll — no new messages
    const second = await inbox.poll(humanId, tavernScene);
    expect(second).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Prose mapping
// ---------------------------------------------------------------------------

describe("DiscordInbox — prose mapping", () => {
  test("ordinary text → { kind: 'prose', prose }", async () => {
    const client = pushableClient();
    client.push("thread-tavern-001", {
      userId: humanDiscordId,
      content: "I approach the barkeep and order an ale.",
      messageId: "msg-2",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn).toEqual({ kind: "prose", prose: "I approach the barkeep and order an ale." });
  });

  test("multi-word sentence → prose", async () => {
    const client = pushableClient();
    client.push("thread-dungeon-007", {
      userId: humanDiscordId,
      content: "The darkness here is unnerving. I draw my sword.",
      messageId: "msg-3",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, dungeonScene);
    expect(turn).toEqual({ kind: "prose", prose: "The darkness here is unnerving. I draw my sword." });
  });
});

// ---------------------------------------------------------------------------
// ADR-0013: `.ra` is no longer a roll trigger — rolling moved to `/check`.
// ---------------------------------------------------------------------------

describe("DiscordInbox — `.ra` is now ordinary prose (ADR-0013, rolling → /check)", () => {
  test("'.ra 感知' → prose (no longer a roll)", async () => {
    const client = pushableClient();
    client.push("thread-tavern-001", {
      userId: humanDiscordId,
      content: ".ra 感知",
      messageId: "msg-4",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn).toEqual({ kind: "prose", prose: ".ra 感知" });
  });

  test("'.RA 运动' (uppercase) → prose (case-insensitive trigger gone)", async () => {
    const client = pushableClient();
    client.push("thread-tavern-001", {
      userId: humanDiscordId,
      content: ".RA 运动",
      messageId: "msg-7",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn).toEqual({ kind: "prose", prose: ".RA 运动" });
  });
});

// ---------------------------------------------------------------------------
// Pass mapping
// ---------------------------------------------------------------------------

describe("DiscordInbox — pass mapping", () => {
  test("'pass' exactly → { kind: 'pass' }", async () => {
    const client = pushableClient();
    client.push("thread-tavern-001", {
      userId: humanDiscordId,
      content: "pass",
      messageId: "msg-8",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn).toEqual({ kind: "pass" });
  });

  test("'pass你们继续' → { kind: 'pass' }", async () => {
    const client = pushableClient();
    client.push("thread-tavern-001", {
      userId: humanDiscordId,
      content: "pass你们继续",
      messageId: "msg-9",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn).toEqual({ kind: "pass" });
  });

  test("'PASS' (uppercase) → { kind: 'pass' } (case-insensitive)", async () => {
    const client = pushableClient();
    client.push("thread-tavern-001", {
      userId: humanDiscordId,
      content: "PASS",
      messageId: "msg-10",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn).toEqual({ kind: "pass" });
  });

  test("'passingly' → prose (not a pass keyword)", async () => {
    const client = pushableClient();
    client.push("thread-tavern-001", {
      userId: humanDiscordId,
      content: "passingly I walk by",
      messageId: "msg-11",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn?.kind).toBe("prose");
  });
});

// ---------------------------------------------------------------------------
// Per-actor filtering: only messages from the polled actor
// ---------------------------------------------------------------------------

describe("DiscordInbox — per-actor filtering", () => {
  test("ignores messages from other Discord users", async () => {
    const client = pushableClient();
    // Message from the second human, not the first
    client.push("thread-tavern-001", {
      userId: secondDiscordId,
      content: "I cast fireball.",
      messageId: "msg-12",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    // Poll as the FIRST human — should not see the second human's message
    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn).toBeUndefined();
  });

  test("returns message from the correct actor when multiple messages queued", async () => {
    const client = pushableClient();
    // Message from second human first
    client.push("thread-tavern-001", {
      userId: secondDiscordId,
      content: "I summon my familiar.",
      messageId: "msg-13",
    });
    // Then message from first human
    client.push("thread-tavern-001", {
      userId: humanDiscordId,
      content: "I draw my battle axe.",
      messageId: "msg-14",
    });
    const inbox = new DiscordInbox(client, personas, threadMap);

    const turn = await inbox.poll(humanId, tavernScene);
    expect(turn).toEqual({ kind: "prose", prose: "I draw my battle axe." });
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("DiscordInbox — error handling", () => {
  test("throws DiscordInboxError when sceneId has no thread mapping", async () => {
    const client = pushableClient();
    const inbox = new DiscordInbox(client, personas, threadMap);

    await expect(
      inbox.poll(humanId, sceneId("scene-unmapped")),
    ).rejects.toThrow(DiscordInboxError);
  });

  test("error message mentions the missing sceneId", async () => {
    const client = pushableClient();
    const inbox = new DiscordInbox(client, personas, threadMap);

    const err = await inbox.poll(humanId, sceneId("scene-missing")).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DiscordInboxError);
    expect((err as DiscordInboxError).message).toContain("scene-missing");
  });

  test("throws DiscordInboxError when actorId has no persona/discordUserId", async () => {
    const client = pushableClient();
    const inbox = new DiscordInbox(client, personas, threadMap);

    await expect(
      inbox.poll(actorId("actor-no-persona"), tavernScene),
    ).rejects.toThrow(DiscordInboxError);
  });
});

// ---------------------------------------------------------------------------
// Interchangeability: both implementations satisfy HumanInboxPort
// ---------------------------------------------------------------------------

describe("HumanInboxPort interchangeability", () => {
  /**
   * A function typed against the PORT — tsc rejects if either class fails to
   * satisfy HumanInboxPort.
   */
  async function useInbox(port: HumanInboxPort): Promise<void> {
    await port.poll(humanId, tavernScene);
  }

  test("DiscordInbox is accepted as HumanInboxPort", async () => {
    const client = pushableClient();
    const discord = new DiscordInbox(client, personas, threadMap);
    await expect(useInbox(discord)).resolves.toBeUndefined();
  });

  test("FakeHumanInbox is accepted as HumanInboxPort", async () => {
    const fake = new FakeHumanInbox({ [humanId]: { kind: "pass" } });
    await expect(useInbox(fake)).resolves.toBeUndefined();
  });
});
