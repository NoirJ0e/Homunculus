import { describe, expect, test } from "vitest";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import type { BcdiceEvaluator, BcdiceEval } from "../../src/adapters/dice/bcdice-dice.js";
import { createRollHandler } from "../../src/adapters/discord/roll-handler.js";

/**
 * #44 — the `/roll <expr>` handler. A FREE BCDice roll (not tied to any pending
 * check): evaluate the expression for the campaign's rule system and post the
 * result text back to the channel. The system id comes from the campaign system
 * (coc7 → Cthulhu7th, dnd5e → DungeonsAndDragons5, via the shared SYSTEM_ID map).
 */

const ev = (text: string): BcdiceEval => ({
  text,
  success: false,
  failure: false,
  critical: false,
  fumble: false,
  detailedRands: [],
});

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "roll",
  invokerId: "player-1",
  channelId: "chan-main",
  options: { expr: "2d6" },
  ...over,
});

function recordingEvaluator(result: BcdiceEval | null): {
  evaluator: BcdiceEvaluator;
  calls: Array<{ systemId: string; command: string }>;
} {
  const calls: Array<{ systemId: string; command: string }> = [];
  return {
    calls,
    evaluator: {
      async eval(systemId, command) {
        calls.push({ systemId, command });
        return result;
      },
    },
  };
}

describe("/roll handler", () => {
  test("evaluates the expr for the campaign system and posts the result text", async () => {
    const { evaluator, calls } = recordingEvaluator(ev("(2D6) ＞ 7"));
    const posts: Array<{ channelId: string; text: string }> = [];
    const handler = createRollHandler({
      evaluator,
      systemFor: () => "coc7",
      post: async (channelId, text) => {
        posts.push({ channelId, text });
      },
      reply: async () => {},
    });

    await handler(event());

    expect(calls).toEqual([{ systemId: "Cthulhu7th", command: "2d6" }]);
    expect(posts).toEqual([{ channelId: "chan-main", text: "(2D6) ＞ 7" }]);
  });

  test("uses the D&D5e system id when the campaign is dnd5e", async () => {
    const { evaluator, calls } = recordingEvaluator(ev("(1D20) ＞ 14"));
    const handler = createRollHandler({
      evaluator,
      systemFor: () => "dnd5e",
      post: async () => {},
      reply: async () => {},
    });
    await handler(event({ options: { expr: "1d20" } }));
    expect(calls).toEqual([{ systemId: "DungeonsAndDragons5", command: "1d20" }]);
  });

  test("an unrecognized expression → ephemeral reply, no channel post", async () => {
    const { evaluator } = recordingEvaluator(null);
    const posts: unknown[] = [];
    const replies: string[] = [];
    const handler = createRollHandler({
      evaluator,
      systemFor: () => "coc7",
      post: async (_c, _t) => {
        posts.push(_t);
      },
      reply: async (t) => {
        replies.push(t);
      },
    });
    await handler(event({ options: { expr: "好耶" } }));
    expect(posts).toEqual([]);
    expect(replies.length).toBe(1);
  });

  test("a missing expr → ephemeral reply, no eval", async () => {
    const { evaluator, calls } = recordingEvaluator(ev("x"));
    const replies: string[] = [];
    const handler = createRollHandler({
      evaluator,
      systemFor: () => "coc7",
      post: async () => {},
      reply: async (t) => {
        replies.push(t);
      },
    });
    await handler(event({ options: {} }));
    expect(calls).toEqual([]);
    expect(replies.length).toBe(1);
  });
});
