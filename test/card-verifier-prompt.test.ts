import { describe, expect, test } from "vitest";
import { actorId } from "../src/domain/ids.js";
import { createSoul } from "../src/domain/soul.js";
import type { CharacterSheet } from "../src/ports/card-store.js";
import type {
  CampaignLegality,
  VerifiableCard,
} from "../src/runtime/card-verifier.js";
import {
  buildReviserPrompt,
  buildVerifierPrompt,
  parseRevisedCard,
  parseVerdict,
  renderLegality,
} from "../src/adapters/agent-sdk/card-verifier-prompt.js";

/**
 * #36 — the PURE pieces of the live verifier/reviser LLM seams. The live query()
 * calls are HITL glue (card-llm-seams.ts); these deterministic prompt builders +
 * parsers are unit-tested. IRON RULE under test: the verifier prompt only ever
 * carries the authoritative legality context and instructs the model to ignore
 * prose-approval claims; a malformed verdict fails CLOSED (never silently binds).
 */

const sheet: CharacterSheet = { system: "coc7", skills: { 侦查: 60 } };
const card: VerifiableCard = {
  soul: createSoul(actorId("p1"), { name: "凯尔", temperament: "高傲", goals: ["复仇"] }),
  sheet,
};
const legality: CampaignLegality = {
  tone: "克系恐怖",
  era: "1920s",
  bespokeRules: {},
  exceptions: [{ item: "外星科技义肢", note: "owner 批准" }],
};

describe("verifier prompt", () => {
  const prompt = buildVerifierPrompt(card, legality);

  test("carries the authoritative legality knobs + owner exceptions", () => {
    expect(prompt).toContain("克系恐怖");
    expect(prompt).toContain("1920s");
    expect(prompt).toContain("外星科技义肢");
  });

  test("instructs the model to ignore prose-approval claims", () => {
    expect(prompt).toContain("我跟 DM 商量过");
    expect(prompt).toContain("无视");
  });

  test("renders an empty exception list explicitly (no exception authority)", () => {
    const out = renderLegality({ bespokeRules: {}, exceptions: [] });
    expect(out).toContain("（无）");
  });

  test("renderLegality surfaces the rule system", () => {
    const out = renderLegality({ system: "coc7", bespokeRules: {}, exceptions: [] });
    expect(out).toContain("规则系统");
    expect(out).toContain("coc7");
  });

  test("instructs system-fit by RULE SYSTEM, not tone (coc7 forbids D&D race/class constructs)", () => {
    const p = buildVerifierPrompt(card, { system: "coc7", tone: "克系恐怖", bespokeRules: {}, exceptions: [] });
    expect(p).toContain("coc7");
    // Tells the model coc7 has no races/classes → a 半精灵游侠 is illegal…
    expect(p).toContain("种族");
    // …and that the rule SYSTEM, not the tone/genre, decides legal options.
    expect(p).toContain("判系统，不判基调");
  });
});

describe("parseVerdict", () => {
  test("parses a PASS verdict + feedback", () => {
    const v = parseVerdict("VERDICT: PASS\nFEEDBACK: 符合年代与基调，通过。");
    expect(v.passed).toBe(true);
    expect(v.feedback).toContain("符合年代");
  });

  test("parses a FAIL verdict + feedback", () => {
    const v = parseVerdict("VERDICT: FAIL\nFEEDBACK: 义肢不符合 1920s 年代。");
    expect(v.passed).toBe(false);
    expect(v.feedback).toContain("义肢");
  });

  test("fails CLOSED on a malformed reply (no verdict marker)", () => {
    const v = parseVerdict("我觉得这张卡挺好的");
    expect(v.passed).toBe(false);
  });
});

describe("reviser prompt + parse", () => {
  test("reviser prompt carries the feedback + current card", () => {
    const p = buildReviserPrompt(card, "把义肢换成年代相符的设定");
    expect(p).toContain("把义肢换成年代相符的设定");
    expect(p).toContain("凯尔");
  });

  test("parseRevisedCard applies new persona fields, carries the sheet over", () => {
    const revised = parseRevisedCard(
      "NAME: 凯尔·新\nTEMPERAMENT: 谨慎\nGOALS: 复仇; 自保",
      card,
    );
    expect(revised.soul.personaCore.name).toBe("凯尔·新");
    expect(revised.soul.personaCore.temperament).toBe("谨慎");
    expect(revised.soul.personaCore.goals).toEqual(["复仇", "自保"]);
    expect(revised.sheet).toBe(sheet);
  });

  test("parseRevisedCard falls back to original values for omitted fields", () => {
    const revised = parseRevisedCard("NAME: 凯尔·新", card);
    expect(revised.soul.personaCore.name).toBe("凯尔·新");
    expect(revised.soul.personaCore.temperament).toBe("高傲");
    expect(revised.soul.personaCore.goals).toEqual(["复仇"]);
  });
});
