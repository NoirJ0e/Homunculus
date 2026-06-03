import { describe, expect, test } from "vitest";
import { mapContentToTurn } from "../../src/adapters/discord/message-mapping.js";

describe("#24 mapContentToTurn — OOC prefix dispatch", () => {
  test("a message starting with '(' (ASCII left paren) maps to OOC", () => {
    expect(mapContentToTurn("(brb, getting coffee)")).toEqual({ kind: "ooc" });
  });

  test("a message starting with '（' (fullwidth left paren) maps to OOC", () => {
    expect(mapContentToTurn("（我去倒杯水）")).toEqual({ kind: "ooc" });
  });

  test("a paren NOT at the first position does not trigger OOC (mid-sentence)", () => {
    expect(mapContentToTurn("我抽出剑（寒光闪过）冲向敌人")).toEqual({
      kind: "prose",
      prose: "我抽出剑（寒光闪过）冲向敌人",
    });
    expect(mapContentToTurn("I draw my sword (it gleams) and charge")).toEqual({
      kind: "prose",
      prose: "I draw my sword (it gleams) and charge",
    });
  });

  test("ADR-0013: .ra is no longer a roll trigger — it is ordinary prose now", () => {
    // Rolling moved to the `/check` slash command; `.ra …` chat is just prose.
    expect(mapContentToTurn(".ra 侦查")).toEqual({ kind: "prose", prose: ".ra 侦查" });
    expect(mapContentToTurn(".RA stealth")).toEqual({ kind: "prose", prose: ".RA stealth" });
  });

  test("regression: pass → pass, free text → prose are unchanged", () => {
    expect(mapContentToTurn("pass")).toEqual({ kind: "pass" });
    expect(mapContentToTurn("pass你们继续")).toEqual({ kind: "pass" });
    expect(mapContentToTurn("我搜索房间。")).toEqual({
      kind: "prose",
      prose: "我搜索房间。",
    });
  });
});
