import { describe, expect, test } from "vitest";
import { actorId, campaignId } from "../src/domain/ids.js";
import { createSoul } from "../src/domain/soul.js";
import type { CharacterSheet } from "../src/ports/card-store.js";
import { CardCreationSession } from "../src/runtime/card-creation-session.js";
import { readCardUnderReview } from "../src/runtime/read-card-under-review.js";

/**
 * #36 — the `readCard` bridge for `/verify-card`. The verifier needs a COMPLETE
 * card; the open-card session holds optional drafts. Held drafts win; any missing
 * half falls back to a deterministic genesis persona / baseline sheet so the
 * human verify loop is runnable today.
 */

const actor = actorId("p1");
const fallbackSheet: CharacterSheet = { system: "coc7", skills: { 侦查: 25 } };
const deps = {
  actorId: actor,
  fallbackArchetype: "侦探",
  fallbackSheet,
};

function sessionWith(drafts: {
  soul?: ReturnType<typeof createSoul>;
  sheet?: CharacterSheet;
}): CardCreationSession {
  const s = new CardCreationSession({
    threadId: "t1",
    actorId: actor,
    campaignId: campaignId("c1"),
    deliver: () => {},
  });
  if (drafts.soul) s.holdSoulDraft(drafts.soul);
  if (drafts.sheet) s.holdSheetDraft(drafts.sheet);
  return s;
}

describe("readCardUnderReview", () => {
  test("prefers held drafts when present", () => {
    const soul = createSoul(actor, { name: "捏的", temperament: "稳重", goals: [] });
    const sheet: CharacterSheet = { system: "dnd5e", skills: { 调查: 3 } };
    const session = sessionWith({ soul, sheet });
    const card = readCardUnderReview("t1", { ...deps, sessionFor: () => session });
    expect(card.soul.personaCore.name).toBe("捏的");
    expect(card.sheet).toBe(sheet);
  });

  test("falls back to genesis soul + baseline sheet when no drafts / no session", () => {
    const card = readCardUnderReview("t1", { ...deps, sessionFor: () => undefined });
    expect(card.soul.id).toBe(actor);
    expect(card.soul.personaCore.name.length).toBeGreaterThan(0);
    expect(card.sheet).toBe(fallbackSheet);
  });

  test("fills only the missing half from fallback", () => {
    const soul = createSoul(actor, { name: "只捏了人设", temperament: "急躁", goals: [] });
    const session = sessionWith({ soul });
    const card = readCardUnderReview("t1", { ...deps, sessionFor: () => session });
    expect(card.soul.personaCore.name).toBe("只捏了人设");
    expect(card.sheet).toBe(fallbackSheet);
  });
});
