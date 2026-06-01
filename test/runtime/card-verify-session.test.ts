import { describe, expect, test } from "vitest";
import { actorId, campaignId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import type { CharacterSheet } from "../../src/ports/card-store.js";
import {
  CardVerifySession,
  CardVerifySessionTable,
} from "../../src/runtime/card-verify-session.js";
import type { CampaignLegality, CardVerifierLlm, VerifiableCard } from "../../src/runtime/card-verifier.js";

/**
 * #35 — the STATEFUL per-thread verify session (verify → feedback → revise →
 * re-verify → … → pass → bind). One session per player thread (isolation); the
 * re-verify after a revise reuses the SAME session (statefulness). On `passed`
 * it binds: SoulStore.save + CardWriter.write + RosterStore.markApproved.
 *
 * Headless: the verifier LLM is an injected stub; the stores are recording fakes.
 */

const sheet: CharacterSheet = { system: "coc7", skills: { 侦查: 60 } };

const legality = (over: Partial<CampaignLegality> = {}): CampaignLegality => ({
  bespokeRules: {},
  exceptions: [],
  ...over,
});

interface BindRecord {
  soulsSaved: string[];
  sheetsWritten: Array<{ campaign: string; actor: string }>;
  approved: Array<{ campaign: string; actor: string }>;
}

function makeSession(opts: {
  llm: CardVerifierLlm;
  card: () => VerifiableCard;
  legality: () => CampaignLegality;
}): { session: CardVerifySession; rec: BindRecord } {
  const rec: BindRecord = { soulsSaved: [], sheetsWritten: [], approved: [] };
  const session = new CardVerifySession({
    threadId: "thread-alice",
    actorId: actorId("actor-alice"),
    campaignId: campaignId("camp-1"),
    llm: opts.llm,
    readCard: opts.card,
    readLegality: opts.legality,
    soulStore: { load: () => undefined, save: (s) => rec.soulsSaved.push(s.id) },
    cardWriter: { write: (campaign, actor) => rec.sheetsWritten.push({ campaign, actor }) },
    rosterStore: {
      get: () => undefined,
      set: () => {},
      markApproved: (campaign, actor) => rec.approved.push({ campaign, actor }),
    },
  });
  return { session, rec };
}

describe("CardVerifySession — stateful feedback loop + bind", () => {
  test("first verify rejects → not bound; re-verify after revise (same session) passes → bound", async () => {
    const soul = createSoul(actorId("actor-alice"), { name: "枪手", temperament: "鲁莽" });
    // The draft text the verifier sees changes between rounds (player revised);
    // model that as the legality gaining the exception OR the card changing.
    let revised = false;
    const llm: CardVerifierLlm = {
      adjudicate: async () =>
        revised
          ? { passed: true, feedback: "通过" }
          : { passed: false, feedback: "现代手枪与设定不符，请改" },
    };

    const { session, rec } = makeSession({
      llm,
      card: () => ({ soul, sheet }),
      legality: () => legality(),
    });

    const first = await session.verify();
    expect(first.passed).toBe(false);
    expect(first.feedback).toContain("请改");
    // NOT bound on reject.
    expect(rec.soulsSaved).toEqual([]);
    expect(rec.sheetsWritten).toEqual([]);
    expect(rec.approved).toEqual([]);

    // Player revises in-thread, then re-runs /verify-card on the SAME session.
    revised = true;
    const second = await session.verify();
    expect(second.passed).toBe(true);

    // Bound: soul saved, sheet written, roster marked approved.
    expect(rec.soulsSaved).toEqual(["actor-alice"]);
    expect(rec.sheetsWritten).toEqual([{ campaign: "camp-1", actor: "actor-alice" }]);
    expect(rec.approved).toEqual([{ campaign: "camp-1", actor: "actor-alice" }]);
  });

  test("the table keeps one session per thread (per-player isolation, stateful re-verify)", () => {
    const table = new CardVerifySessionTable();
    expect(table.get("thread-x")).toBeUndefined();
    const { session } = makeSession({
      llm: { adjudicate: async () => ({ passed: true, feedback: "" }) },
      card: () => ({ soul: createSoul(actorId("a"), { name: "n", temperament: "t" }), sheet }),
      legality: () => legality(),
    });
    table.bind(session);
    expect(table.get("thread-alice")).toBe(session);
  });

  test("verify hands the adjudicator ONLY the authoritative legality (no prose-approval channel)", async () => {
    let seenKeys: string[] = [];
    const llm: CardVerifierLlm = {
      adjudicate: async (_c, l) => {
        seenKeys = Object.keys(l).sort();
        return { passed: false, feedback: "" };
      },
    };
    const { session } = makeSession({
      llm,
      card: () => ({ soul: createSoul(actorId("a"), { name: "n", temperament: "t" }), sheet }),
      legality: () => legality(),
    });
    await session.verify();
    expect(seenKeys).toEqual(["bespokeRules", "exceptions"]);
  });
});
