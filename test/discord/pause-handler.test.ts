import { describe, expect, test } from "vitest";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { createPauseHandler } from "../../src/adapters/discord/pause-handler.js";

/**
 * #55 — `/pause` handler. Any seated player (router scope = "player") may stop the
 * table: the handler flips the channel's session to held and confirms. Cross-
 * process resume is out of scope (ADR-0010).
 */

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "pause",
  invokerId: "player-1",
  channelId: "chan-main",
  options: {},
  ...over,
});

describe("/pause handler", () => {
  test("pauses the invoking channel and confirms to the player", async () => {
    const paused: string[] = [];
    const replies: string[] = [];
    const handler = createPauseHandler({
      pause: (channelId) => paused.push(channelId),
      reply: async (t) => {
        replies.push(t);
      },
    });

    await handler(event());

    expect(paused).toEqual(["chan-main"]);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("暂停");
  });
});
