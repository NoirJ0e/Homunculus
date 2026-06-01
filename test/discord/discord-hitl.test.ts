/**
 * HITL integration test — requires a real Discord server and credentials.
 *
 * This test is SKIPPED in CI. To run it:
 *
 *   1. Follow the runbook in src/adapters/discord/README.md.
 *   2. Set environment variables:
 *        DISCORD_BOT_TOKEN      — bot token
 *        DISCORD_WEBHOOK_URL    — webhook URL
 *        DISCORD_TEST_THREAD_ID — Discord thread snowflake ID for the test scene
 *   3. Run:
 *        DISCORD_BOT_TOKEN=... DISCORD_WEBHOOK_URL=... DISCORD_TEST_THREAD_ID=... \
 *          npx vitest run test/discord/discord-hitl.test.ts
 *
 * What this test verifies:
 *   - A webhook message can be sent to a real Discord thread via the factory client.
 *   - The sent message appears in the thread with the correct actor persona.
 *   - Inbound messages can be fetched from the thread.
 *
 * The acceptance criterion "在真实 Discord 服务器里人工验证跑通一整回合" requires a
 * human player to be present in the server and manually type responses. That
 * cannot be automated; it must be done by a person following the runbook.
 */

import { test, expect } from "vitest";
import { createRealDiscordClient } from "../../src/adapters/discord/create-real-discord.js";
import { DiscordSubstrate } from "../../src/adapters/discord/discord-substrate.js";
import { DiscordInbox } from "../../src/adapters/discord/discord-inbox.js";
import { actorId, sceneId } from "../../src/domain/ids.js";
import type { ActorPersona, SceneThreadMap } from "../../src/adapters/discord/scene-threads.js";

// ---------------------------------------------------------------------------
// HITL: send a post via real webhook
// ---------------------------------------------------------------------------

test.skip("HITL: send post to real Discord thread via webhook persona", async () => {
  const botToken = process.env["DISCORD_BOT_TOKEN"];
  const webhookUrl = process.env["DISCORD_WEBHOOK_URL"];
  const testThreadId = process.env["DISCORD_TEST_THREAD_ID"];

  if (!botToken || !webhookUrl || !testThreadId) {
    throw new Error(
      "HITL test requires DISCORD_BOT_TOKEN, DISCORD_WEBHOOK_URL, and DISCORD_TEST_THREAD_ID env vars",
    );
  }

  const sceneKey = sceneId("scene-hitl-test");
  const actorKey = actorId("actor-hitl-dm");

  const personas: ActorPersona[] = [
    {
      actorId: actorKey,
      username: "Homunculus DM [HITL Test]",
      // avatarURL omitted intentionally to test the no-avatar path
    },
  ];

  const threadMap: SceneThreadMap = {
    [sceneKey]: testThreadId,
  };

  const client = await createRealDiscordClient({ botToken, webhookUrl });
  const substrate = new DiscordSubstrate(client, personas, threadMap);

  // Should not throw — post sent to real Discord
  await expect(
    substrate.emit({
      sceneId: sceneKey,
      actorId: actorKey,
      prose: "[HITL Test] Homunculus engine is online. The tavern door creaks open.",
    }),
  ).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// HITL: fetch messages from real Discord thread
// ---------------------------------------------------------------------------

test.skip("HITL: fetch messages from real Discord thread", async () => {
  const botToken = process.env["DISCORD_BOT_TOKEN"];
  const webhookUrl = process.env["DISCORD_WEBHOOK_URL"];
  const testThreadId = process.env["DISCORD_TEST_THREAD_ID"];
  const testDiscordUserId = process.env["DISCORD_TEST_USER_ID"];

  if (!botToken || !webhookUrl || !testThreadId || !testDiscordUserId) {
    throw new Error(
      "HITL test requires DISCORD_BOT_TOKEN, DISCORD_WEBHOOK_URL, " +
        "DISCORD_TEST_THREAD_ID, and DISCORD_TEST_USER_ID env vars",
    );
  }

  const sceneKey = sceneId("scene-hitl-test");
  const humanActorId = actorId("actor-hitl-human");

  const personas: ActorPersona[] = [
    {
      actorId: humanActorId,
      username: "HITL Human Player",
      discordUserId: testDiscordUserId,
    },
  ];

  const threadMap: SceneThreadMap = {
    [sceneKey]: testThreadId,
  };

  const client = await createRealDiscordClient({ botToken, webhookUrl });
  const inbox = new DiscordInbox(client, personas, threadMap);

  // Poll — may return undefined if no human messages present
  const turn = await inbox.poll(humanActorId, sceneKey);

  // Structural assertions only — content depends on what the human typed
  if (turn !== undefined) {
    expect(["prose", "pass", "roll"]).toContain(turn.kind);
    console.log("HITL inbox poll result:", turn);
  } else {
    console.log("HITL inbox poll: no messages (human is silent — expected if thread is empty)");
  }
});
