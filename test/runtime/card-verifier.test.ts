import { describe, expect, test } from "vitest";
import { actorId } from "../../src/domain/ids.js";
import { createSoul, type Soul } from "../../src/domain/soul.js";
import type { CharacterSheet } from "../../src/ports/card-store.js";
import {
  buildLegality,
  verifyCard,
  type CampaignLegality,
  type VerifiableCard,
  type CardVerifierLlm,
} from "../../src/runtime/card-verifier.js";
import type { CampaignBible } from "../../src/domain/campaign.js";

/**
 * #35 — the provenance-agnostic verifier CORE (the reusable legality gate used
 * by both the human path #35 and the AI path #37). `verifyCard(card, legality,
 * llm)` takes a card (soul + sheet draft) + the campaign's AUTHORITATIVE
 * legality state and returns a verdict + feedback. The real verdict is an LLM
 * call (HITL); the LLM is INJECTED so tests stub it.
 *
 * Iron rule (structural, ADR-0012): the verifier is handed ONLY the
 * authoritative legality state. There is NO prose-approval channel — a player
 * cannot smuggle "我跟 DM 商量过/已获批准" past the gate; the only exception
 * authority is the owner-written SanctionedException[]. And NO secretTruth
 * (blindbox, ADR-0007) ever enters the legality context.
 */

const sheet: CharacterSheet = { system: "coc7", skills: { 侦查: 60 } };

function card(soul: Soul, over: Partial<VerifiableCard> = {}): VerifiableCard {
  return { soul, sheet, ...over };
}

const bible = (over: Partial<CampaignBible> = {}): CampaignBible => ({
  secretTruth: "【AIDM 底牌】真凶是市长，严禁泄露",
  milestones: [],
  npcs: [],
  worldClocks: [],
  bespokeRules: { 禁用现代武器: true },
  ...over,
});

/** A stub LLM that decides purely from what the legality state actually carries. */
function llmStub(
  decide: (card: VerifiableCard, legality: CampaignLegality) => { passed: boolean; feedback: string },
): CardVerifierLlm {
  return { adjudicate: async (card, legality) => decide(card, legality) };
}

describe("verifyCard — provenance-agnostic legality gate", () => {
  test("illegal item with NO matching exception → reject", async () => {
    const soul = createSoul(actorId("a-1"), {
      name: "枪手",
      temperament: "鲁莽",
      plotSummary: "随身带一把现代手枪",
    });
    const legality = buildLegality(bible(), []);

    // The stub mimics the real verifier: it rejects the off-era item because no
    // exception in `legality.exceptions` sanctions it.
    const llm = llmStub((_c, l) =>
      l.exceptions.some((e) => e.item === "现代手枪")
        ? { passed: true, feedback: "ok" }
        : { passed: false, feedback: "现代手枪与战役设定不符" },
    );

    const verdict = await verifyCard(card(soul), legality, llm);
    expect(verdict.passed).toBe(false);
    expect(verdict.feedback).toContain("现代手枪");
  });

  test("after the owner sanctions the item, the same card re-verifies → pass", async () => {
    const soul = createSoul(actorId("a-1"), {
      name: "枪手",
      temperament: "鲁莽",
      plotSummary: "随身带一把现代手枪",
    });
    const exception = { item: "现代手枪", note: "owner 批准的时代错置道具" };
    const legality = buildLegality(bible(), [exception]);

    const llm = llmStub((_c, l) =>
      l.exceptions.some((e) => e.item === "现代手枪")
        ? { passed: true, feedback: "已获 owner 批准，放行" }
        : { passed: false, feedback: "现代手枪与战役设定不符" },
    );

    const verdict = await verifyCard(card(soul), legality, llm);
    expect(verdict.passed).toBe(true);
  });

  test("blindbox: the legality context handed to the verifier never contains secretTruth", async () => {
    const legality = buildLegality(bible({ secretTruth: "真凶是市长" }), []);

    // Structural: there is no secretTruth FIELD on the legality object at all.
    expect(Object.keys(legality)).not.toContain("secretTruth");
    expect(JSON.stringify(legality)).not.toContain("真凶是市长");

    // And the adjudicator only ever receives this secret-free context.
    let seen: CampaignLegality | undefined;
    const llm: CardVerifierLlm = {
      adjudicate: async (_c, l) => {
        seen = l;
        return { passed: true, feedback: "" };
      },
    };
    const soul = createSoul(actorId("a-1"), { name: "侦探", temperament: "冷静" });
    await verifyCard(card(soul), legality, llm);
    expect(JSON.stringify(seen)).not.toContain("真凶是市长");
  });

  test("prose-approval is structurally impossible: the authoritative context exposes no approval channel beyond owner exceptions", () => {
    const legality = buildLegality(bible(), []);
    // The legality surface the verifier sees: exactly the authoritative fields.
    // No "approvals" / "playerClaims" / prose channel exists to smuggle a
    // "我跟 DM 商量过" claim through — the only allow-list is `exceptions`.
    const keys = Object.keys(legality).sort();
    expect(keys).toEqual(["bespokeRules", "exceptions"]);
  });
});
