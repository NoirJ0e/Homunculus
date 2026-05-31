/**
 * Unit tests for DiscordSubstrate (issue #4).
 *
 * Architecture under test:
 *   - DiscordSubstrate implements SubstratePort.
 *   - emit(post) sends the post's prose to the Discord thread mapped from
 *     post.sceneId, via a WEBHOOK impersonating the actor (webhook 人格分身):
 *       username = actor's display name, avatarURL = actor's avatar URL.
 *   - Posts to different scenes go to different threads.
 *   - Absence of a scene mapping → throws DiscordSubstrateError.
 *   - Absence of an actor persona → throws DiscordSubstrateError.
 *
 * All tests use a stub DiscordClient — zero real network calls.
 */

import { describe, expect, test } from "vitest";
import {
  DiscordSubstrate,
  type DiscordClient,
  type SentMessage,
  DiscordSubstrateError,
} from "../../src/adapters/discord/discord-substrate.js";
import { FakeSubstrate } from "../../src/adapters/memory/fake-substrate.js";
import type { SubstratePort } from "../../src/ports/substrate.js";
import { actorId, sceneId } from "../../src/domain/ids.js";
import type { ActorPersona, SceneThreadMap } from "../../src/adapters/discord/scene-threads.js";

// ---------------------------------------------------------------------------
// Helpers — fake Discord client
// ---------------------------------------------------------------------------

/** A captured call to the stub client. */
interface SentCall {
  threadId: string;
  message: SentMessage;
}

/** Stub Discord client that records sent messages instead of hitting the network. */
function stubClient(): DiscordClient & { calls: SentCall[] } {
  const calls: SentCall[] = [];
  return {
    calls,
    async sendWebhookMessage(threadId: string, message: SentMessage): Promise<void> {
      calls.push({ threadId, message });
    },
    async fetchMessages(_threadId: string, _since?: string): Promise<[]> {
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const tavernScene = sceneId("scene-tavern");
const dungeonScene = sceneId("scene-dungeon");

const bardId = actorId("actor-bard");
const rogueId = actorId("actor-rogue");
const dmId = actorId("actor-dm");

const personas: ActorPersona[] = [
  { actorId: bardId, username: "Lyra the Bard", avatarURL: "https://cdn.example.com/lyra.png" },
  { actorId: rogueId, username: "Shadow", avatarURL: "https://cdn.example.com/shadow.png" },
  { actorId: dmId, username: "The Dungeon Master", avatarURL: "https://cdn.example.com/dm.png" },
];

const threadMap: SceneThreadMap = {
  [tavernScene]: "thread-tavern-001",
  [dungeonScene]: "thread-dungeon-007",
};

// ---------------------------------------------------------------------------
// Happy path: emit routes to correct thread with correct persona
// ---------------------------------------------------------------------------

describe("DiscordSubstrate — emit routes to thread mapped from sceneId", () => {
  test("sends message to the thread mapped from post.sceneId", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    await substrate.emit({ sceneId: tavernScene, actorId: bardId, prose: "I play a tune." });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.threadId).toBe("thread-tavern-001");
  });

  test("sends message to a different thread for a different sceneId", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    await substrate.emit({ sceneId: dungeonScene, actorId: rogueId, prose: "I scout ahead." });

    expect(client.calls[0]!.threadId).toBe("thread-dungeon-007");
  });

  test("posts to different scenes go to different threads", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    await substrate.emit({ sceneId: tavernScene, actorId: bardId, prose: "I play a tune." });
    await substrate.emit({ sceneId: dungeonScene, actorId: rogueId, prose: "I scout ahead." });

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]!.threadId).toBe("thread-tavern-001");
    expect(client.calls[1]!.threadId).toBe("thread-dungeon-007");
  });
});

// ---------------------------------------------------------------------------
// Webhook persona: username + avatarURL (人格分身)
// ---------------------------------------------------------------------------

describe("DiscordSubstrate — webhook persona (人格分身)", () => {
  test("uses the actor's display name as webhook username", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    await substrate.emit({ sceneId: tavernScene, actorId: bardId, prose: "A melody fills the room." });

    expect(client.calls[0]!.message.username).toBe("Lyra the Bard");
  });

  test("uses the actor's avatar URL for the webhook avatar", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    await substrate.emit({ sceneId: tavernScene, actorId: bardId, prose: "A melody fills the room." });

    expect(client.calls[0]!.message.avatarURL).toBe("https://cdn.example.com/lyra.png");
  });

  test("uses the rogue's persona for a different actor", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    await substrate.emit({ sceneId: tavernScene, actorId: rogueId, prose: "I slide into the shadows." });

    expect(client.calls[0]!.message.username).toBe("Shadow");
    expect(client.calls[0]!.message.avatarURL).toBe("https://cdn.example.com/shadow.png");
  });

  test("sends the exact prose as the message content", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    const prose = "The dragon's scales glint in the torchlight.";
    await substrate.emit({ sceneId: dungeonScene, actorId: dmId, prose });

    expect(client.calls[0]!.message.content).toBe(prose);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("DiscordSubstrate — error handling", () => {
  test("throws DiscordSubstrateError when sceneId has no thread mapping", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    await expect(
      substrate.emit({ sceneId: sceneId("scene-unmapped"), actorId: bardId, prose: "Hello?" }),
    ).rejects.toThrow(DiscordSubstrateError);
  });

  test("error message mentions the missing sceneId", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    const err = await substrate
      .emit({ sceneId: sceneId("scene-missing"), actorId: bardId, prose: "Hello?" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DiscordSubstrateError);
    expect((err as DiscordSubstrateError).message).toContain("scene-missing");
  });

  test("throws DiscordSubstrateError when actorId has no persona", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    await expect(
      substrate.emit({ sceneId: tavernScene, actorId: actorId("actor-unknown"), prose: "Who am I?" }),
    ).rejects.toThrow(DiscordSubstrateError);
  });

  test("error message mentions the missing actorId", async () => {
    const client = stubClient();
    const substrate = new DiscordSubstrate(client, personas, threadMap);

    const err = await substrate
      .emit({ sceneId: tavernScene, actorId: actorId("actor-ghost"), prose: "Boo!" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DiscordSubstrateError);
    expect((err as DiscordSubstrateError).message).toContain("actor-ghost");
  });
});

// ---------------------------------------------------------------------------
// Interchangeability: both implementations satisfy SubstratePort
// ---------------------------------------------------------------------------

describe("SubstratePort interchangeability", () => {
  /**
   * A function typed against the PORT — tsc rejects if either class fails to
   * satisfy SubstratePort.
   */
  async function useSubstrate(port: SubstratePort): Promise<void> {
    await port.emit({ sceneId: tavernScene, actorId: bardId, prose: "test" });
  }

  test("DiscordSubstrate is accepted as SubstratePort", async () => {
    const client = stubClient();
    const discord = new DiscordSubstrate(client, personas, threadMap);
    await expect(useSubstrate(discord)).resolves.toBeUndefined();
  });

  test("FakeSubstrate is accepted as SubstratePort", async () => {
    const fake = new FakeSubstrate();
    await expect(useSubstrate(fake)).resolves.toBeUndefined();
    expect(fake.transcript).toHaveLength(1);
  });
});
