import { describe, expect, test } from "vitest";
import { actorId, campaignId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import type { Soul } from "../../src/domain/soul.js";
import type { CharacterSheet } from "../../src/ports/card-store.js";
import type {
  CampaignLegality,
  CardVerifierLlm,
  VerifiableCard,
  Verdict,
} from "../../src/runtime/card-verifier.js";
import type { SoulStore } from "../../src/ports/soul-store.js";
import type { CardWriter } from "../../src/ports/card-writer.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import type { RosterEntry } from "../../src/domain/card-lifecycle.js";
import { addAiSeat, type AiReviser, type AiSeatDeps } from "../../src/runtime/ai-seat.js";

/**
 * #37 — the AI-teammate seat goes through the SAME provenance-agnostic verifier
 * as a human (ADR-0012). genesis draft → verifyCard → on reject an automated,
 * capped revise loop (the injected reviser adjusts the draft from the feedback)
 * → re-verify → … → on pass BIND (soul saved, sheet written, roster
 * markApproved, kind "ai"); on exhausting the cap the owner is notified and the
 * seat is NOT bound. Headless: stub verifier LLM, stub reviser, fake stores.
 */

const sheet: CharacterSheet = { system: "coc7", skills: { 侦查: 50 } };

const legality = (): CampaignLegality => ({ tone: "克系恐怖", bespokeRules: {}, exceptions: [] });

interface Harness {
  deps: AiSeatDeps;
  binds: { souls: Soul[]; sheets: number; approved: string[] };
  roster: RosterEntry[];
  notified: string[];
  verifyCalls: VerifiableCard[];
  reviseCalls: Array<{ card: VerifiableCard; feedback: string }>;
}

function makeHarness(opts: {
  /** Verdict sequence the stub verifier returns, in order. */
  verdicts: Verdict[];
  maxRevisions?: number;
}): Harness {
  const binds = { souls: [] as Soul[], sheets: 0, approved: [] as string[] };
  const roster: RosterEntry[] = [];
  const notified: string[] = [];
  const verifyCalls: VerifiableCard[] = [];
  const reviseCalls: Array<{ card: VerifiableCard; feedback: string }> = [];

  let i = 0;
  const llm: CardVerifierLlm = {
    adjudicate: async (card) => {
      verifyCalls.push(card);
      const v = opts.verdicts[Math.min(i, opts.verdicts.length - 1)];
      i += 1;
      return v ?? { passed: false, feedback: "n/a" };
    },
  };

  // The reviser produces a DISTINCT revised draft each time (deterministic
  // genesis can't self-vary, so revision must come through this seam).
  const reviser: AiReviser = async (card, feedback) => {
    reviseCalls.push({ card, feedback });
    return {
      soul: createSoul(card.soul.id, {
        name: card.soul.personaCore.name,
        temperament: `${card.soul.personaCore.temperament}（已据反馈调整：${feedback}）`,
      }),
      sheet: card.sheet,
    };
  };

  const soulStore: SoulStore = { load: () => undefined, save: (s) => binds.souls.push(s) };
  const cardWriter: CardWriter = { write: () => { binds.sheets += 1; } };
  const rosterStore: RosterStore = {
    get: () => roster,
    set: (_c, r) => { roster.length = 0; roster.push(...r); },
    markApproved: (_c, a) => { binds.approved.push(a); },
  };

  const deps: AiSeatDeps = {
    campaignId: campaignId("camp-1"),
    actorId: actorId("npc-teammate"),
    archetype: "战士",
    sheet,
    legality: legality(),
    verifierLlm: llm,
    reviser,
    soulStore,
    cardWriter,
    rosterStore,
    notifyOwner: async (msg) => { notified.push(msg); },
    ...(opts.maxRevisions !== undefined ? { maxRevisions: opts.maxRevisions } : {}),
  };

  return { deps, binds, roster, notified, verifyCalls, reviseCalls };
}

describe("addAiSeat — AI teammate goes through the SAME verifier", () => {
  test("reject once, reviser adjusts, re-verify passes → bound (soul saved, sheet written, roster markApproved kind ai)", async () => {
    const h = makeHarness({
      verdicts: [
        { passed: false, feedback: "题材不符，去掉现代元素" },
        { passed: true, feedback: "通过" },
      ],
    });

    const result = await addAiSeat(h.deps);

    expect(result.bound).toBe(true);
    // The SAME verifier ran twice (draft, then the revised draft).
    expect(h.verifyCalls).toHaveLength(2);
    // The reviser was driven by the rejection feedback exactly once.
    expect(h.reviseCalls).toHaveLength(1);
    expect(h.reviseCalls[0]?.feedback).toContain("题材不符");
    // Bound: soul saved, sheet written, roster marked approved for THIS actor.
    expect(h.binds.souls.map((s) => s.id)).toEqual(["npc-teammate"]);
    expect(h.binds.sheets).toBe(1);
    expect(h.binds.approved).toEqual(["npc-teammate"]);
    // The bound soul is the REVISED one (carries the reviser's adjustment).
    expect(h.binds.souls[0]?.personaCore.temperament).toContain("已据反馈调整");
    // Owner not bothered on success.
    expect(h.notified).toEqual([]);
  });

  test("rejected every time → loop stops at cap N, owner notified, NOT bound", async () => {
    const h = makeHarness({
      verdicts: [{ passed: false, feedback: "始终不符合题材" }],
      maxRevisions: 2,
    });

    const result = await addAiSeat(h.deps);

    expect(result.bound).toBe(false);
    expect(result.revisions).toBe(2);
    // Cap N=2 → 1 initial verify + 2 re-verifies after each revise = 3 verifies,
    // and exactly N=2 revise attempts (no further revise once the cap is hit).
    expect(h.verifyCalls).toHaveLength(3);
    expect(h.reviseCalls).toHaveLength(2);
    // NOT bound: nothing persisted, roster not marked.
    expect(h.binds).toEqual({ souls: [], sheets: 0, approved: [] });
    // Owner notified for fallback, carrying the last feedback.
    expect(h.notified).toHaveLength(1);
    expect(h.notified[0]).toContain("始终不符合题材");
    expect(h.notified[0]).toContain("npc-teammate");
  });
});
