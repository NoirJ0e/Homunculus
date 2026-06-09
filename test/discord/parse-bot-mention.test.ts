import { describe, expect, test } from "vitest";
import { parseBotMentions } from "../../src/adapters/discord/parse-bot-mention.js";

/**
 * #56 — the main bot's gateway must resolve which POOL bot a player @-mentioned
 * (seeds the #57 @bot coordination channel). Pure parse of `<@id>` / `<@!id>`
 * tags, intersected with the pool's bot ids, in order of appearance.
 */
const pool = ["111", "222"];

describe("parseBotMentions", () => {
  test("returns the pool bot a message @-mentions", () => {
    expect(parseBotMentions("<@111> 帮我过个检定", pool)).toEqual(["111"]);
  });

  test("handles the nickname mention form <@!id> and preserves appearance order", () => {
    expect(parseBotMentions("先 <@!222> 再 <@111>", pool)).toEqual(["222", "111"]);
  });

  test("ignores mentions of non-pool users (e.g. the human or main bot)", () => {
    expect(parseBotMentions("<@999> 普通发言", pool)).toEqual([]);
  });

  test("no mention → empty", () => {
    expect(parseBotMentions("就是一句普通的话", pool)).toEqual([]);
  });

  test("dedupes a doubly-mentioned bot", () => {
    expect(parseBotMentions("<@111> ... <@111>", pool)).toEqual(["111"]);
  });
});
