import { describe, expect, test } from "vitest";
import { mapInteractionToCommandEvent } from "../../src/adapters/discord/command-interaction.js";

/**
 * A minimal interaction-shaped object — the slice of discord.js'
 * ChatInputCommandInteraction the mapping reads. discord.js is NOT loaded here;
 * the mapping is a pure transform over this shape.
 */
function interaction(overrides: Record<string, unknown> = {}) {
  return {
    isChatInputCommand: () => true,
    commandName: "create-character-card",
    user: { id: "user-1" },
    channelId: "chan-1",
    channel: { isThread: () => false },
    options: { data: [] as Array<{ name: string; value: unknown }> },
    ...overrides,
  };
}

describe("#31 mapInteractionToCommandEvent — pure interaction→CommandEvent transform", () => {
  test("maps name, invokerId, channelId from a chat-input interaction", () => {
    const ev = mapInteractionToCommandEvent(interaction());
    expect(ev).toEqual({
      name: "create-character-card",
      invokerId: "user-1",
      channelId: "chan-1",
      options: {},
    });
  });

  test("sets threadId when the channel is a thread", () => {
    const ev = mapInteractionToCommandEvent(
      interaction({
        channelId: "thread-42",
        channel: { isThread: () => true },
      }),
    );
    expect(ev?.threadId).toBe("thread-42");
  });

  test("collects string options keyed by name, coercing values to strings", () => {
    const ev = mapInteractionToCommandEvent(
      interaction({
        options: {
          data: [
            { name: "concept", value: "a wandering bard" },
            { name: "level", value: 3 },
          ],
        },
      }),
    );
    expect(ev?.options).toEqual({ concept: "a wandering bard", level: "3" });
  });

  test("returns null for a non-chat-input interaction (e.g. a button click)", () => {
    const ev = mapInteractionToCommandEvent(interaction({ isChatInputCommand: () => false }));
    expect(ev).toBeNull();
  });
});
