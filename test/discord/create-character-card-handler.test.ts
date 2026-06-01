import { describe, expect, test } from "vitest";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { actorId } from "../../src/domain/ids.js";
import { CardCreationSessionTable } from "../../src/runtime/card-creation-session.js";
import { createCreateCharacterCardHandler } from "../../src/adapters/discord/create-character-card-handler.js";

/**
 * #34 — the `/create-character-card` command handler. On invoke (player, already
 * roster-gated by #31's router) it: launches the player's private thread (admin
 * port `createThread` — the live thread create is HITL glue, here a stub), binds
 * `threadId → session` in the table, starts the open-card assistant for the
 * thread, and posts the onboarding message. Headless: thread create + assistant
 * start + onboarding post are recording stubs.
 */

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "create-character-card",
  invokerId: "user-alice",
  channelId: "chan-roster",
  options: {},
  ...over,
});

interface Harness {
  table: CardCreationSessionTable;
  threadsCreated: Array<{ channelId: string; name: string }>;
  onboardingPosts: Array<{ threadId: string; text: string }>;
  assistantStarts: string[];
  handler: ReturnType<typeof createCreateCharacterCardHandler>;
}

function makeHarness(): Harness {
  const table = new CardCreationSessionTable();
  const threadsCreated: Array<{ channelId: string; name: string }> = [];
  const onboardingPosts: Array<{ threadId: string; text: string }> = [];
  const assistantStarts: string[] = [];

  const handler = createCreateCharacterCardHandler({
    sessionTable: table,
    createThread: async (channelId, name) => {
      threadsCreated.push({ channelId, name });
      return `thread-for-${name}`;
    },
    resolveActor: (invokerId) => actorId(`actor-${invokerId}`),
    resolveCampaign: () => "mine-01" as never,
    startAssistant: (threadId) => {
      assistantStarts.push(threadId);
      return (_text: string) => {};
    },
    postOnboarding: async (threadId, text) => {
      onboardingPosts.push({ threadId, text });
    },
  });

  return { table, threadsCreated, onboardingPosts, assistantStarts, handler };
}

describe("createCharacterCard handler", () => {
  test("launches a thread, binds threadId→session, starts the assistant, posts onboarding", async () => {
    const h = makeHarness();
    await h.handler(event({ invokerId: "user-alice" }));

    expect(h.threadsCreated).toHaveLength(1);
    const threadId = `thread-for-${h.threadsCreated[0]?.name}`;

    const session = h.table.get(threadId);
    expect(session).toBeDefined();
    expect(session?.actorId).toBe(actorId("actor-user-alice"));

    expect(h.assistantStarts).toEqual([threadId]);
    expect(h.onboardingPosts).toHaveLength(1);
    expect(h.onboardingPosts[0]?.threadId).toBe(threadId);
    // Onboarding tells the player where to chat + how to advance (/verify-card).
    expect(h.onboardingPosts[0]?.text).toContain("/verify-card");
  });

  test("the bound session streams thread text to the started assistant", async () => {
    const table = new CardCreationSessionTable();
    const delivered: string[] = [];
    const handler = createCreateCharacterCardHandler({
      sessionTable: table,
      createThread: async () => "thread-x",
      resolveActor: (id) => actorId(`actor-${id}`),
      resolveCampaign: () => "mine-01" as never,
      startAssistant: () => (text) => delivered.push(text),
      postOnboarding: async () => {},
    });

    await handler(event());
    table.get("thread-x")?.deliver("我想玩一个侦探");
    expect(delivered).toEqual(["我想玩一个侦探"]);
  });

  test("two players each get their own thread + isolated session", async () => {
    const h = makeHarness();
    await h.handler(event({ invokerId: "user-alice" }));
    await h.handler(event({ invokerId: "user-bob" }));

    expect(h.threadsCreated).toHaveLength(2);
    const aliceThread = `thread-for-${h.threadsCreated[0]?.name}`;
    const bobThread = `thread-for-${h.threadsCreated[1]?.name}`;
    expect(aliceThread).not.toBe(bobThread);
    expect(h.table.get(aliceThread)?.actorId).toBe(actorId("actor-user-alice"));
    expect(h.table.get(bobThread)?.actorId).toBe(actorId("actor-user-bob"));
  });
});
