import { describe, expect, test } from "vitest";
import { actorId, campaignId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import type { CharacterSheet } from "../../src/ports/card-store.js";
import type { SoulStore } from "../../src/ports/soul-store.js";
import type { CardWriter } from "../../src/ports/card-writer.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import type { RosterEntry } from "../../src/domain/card-lifecycle.js";
import type { CampaignLegality, CardVerifierLlm, VerifiableCard } from "../../src/runtime/card-verifier.js";
import type { AiReviser } from "../../src/runtime/ai-seat.js";
import type { Soul } from "../../src/domain/soul.js";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { createAddAiSeatHandler } from "../../src/adapters/discord/add-ai-seat-handler.js";

/**
 * #37 — the owner-facing `/add-ai-seat` handler (owner-scoped, gated by #31's
 * router). It runs the SAME create→verify→bind path as a human seat via
 * `addAiSeat`: genesis draft → SAME verifier → capped auto-revise → on pass bind
 * (+ append an APPROVED "ai" roster entry) and reply; on cap-exhaustion reply the
 * owner-fallback notice and DON'T add an approved seat. Headless: verifier LLM
 * stub, reviser stub, store fakes, reply recorder.
 */

const sheet: CharacterSheet = { system: "coc7", skills: { 侦查: 50 } };
const camp = campaignId("camp-1");

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "add-ai-seat",
  invokerId: "owner-1",
  channelId: "chan-x",
  options: { archetype: "战士" },
  ...over,
});

interface Harness {
  handler: ReturnType<typeof createAddAiSeatHandler>;
  roster: RosterEntry[];
  binds: { souls: string[]; sheets: number; approved: string[]; lastSoul?: Soul };
  replies: string[];
}

function makeHarness(verdicts: Array<{ passed: boolean; feedback: string }>): Harness {
  const roster: RosterEntry[] = [];
  const binds = { souls: [] as string[], sheets: 0, approved: [] as string[] } as Harness["binds"];
  const replies: string[] = [];

  let i = 0;
  const llm: CardVerifierLlm = {
    adjudicate: async () => verdicts[Math.min(i++, verdicts.length - 1)] ?? { passed: false, feedback: "n/a" },
  };
  const reviser: AiReviser = async (card, feedback) => ({
    soul: createSoul(card.soul.id, { name: card.soul.personaCore.name, temperament: feedback }),
    sheet: card.sheet,
  });

  const soulStore: SoulStore = {
    load: () => undefined,
    save: (s) => {
      binds.souls.push(s.id);
      binds.lastSoul = s;
    },
  };
  const cardWriter: CardWriter = { write: () => { binds.sheets += 1; } };
  const rosterStore: RosterStore = {
    get: () => roster,
    set: (_c, r) => { roster.length = 0; roster.push(...r); },
    markApproved: (_c, a) => { binds.approved.push(a); },
  };

  const handler = createAddAiSeatHandler({
    resolveCampaign: () => camp,
    resolveActor: (event) => actorId(`npc-${event.options["name"] ?? "teammate"}`),
    legality: (): CampaignLegality => ({ bespokeRules: {}, exceptions: [] }),
    sheetFor: () => sheet,
    // System-aware default (#47): a CoC campaign's empty seat is an investigator.
    defaultArchetype: () => "调查员",
    verifierLlm: () => llm,
    reviser,
    soulStore,
    cardWriter,
    rosterStore,
    reply: async (t) => { replies.push(t); },
    maxRevisions: 1,
  });

  return { handler, roster, binds, replies };
}

describe("add-ai-seat handler", () => {
  test("verifier passes → seat bound + an APPROVED ai roster entry appended + reply", async () => {
    const h = makeHarness([{ passed: true, feedback: "通过" }]);

    await h.handler(event());

    expect(h.binds.souls).toEqual(["npc-teammate"]);
    expect(h.binds.sheets).toBe(1);
    expect(h.binds.approved).toEqual(["npc-teammate"]);
    // The roster now carries the bound AI seat: kind "ai", approved.
    expect(h.roster).toHaveLength(1);
    expect(h.roster[0]).toMatchObject({ actorId: "npc-teammate", kind: "ai", approved: true });
    expect(h.replies.join("\n")).toMatch(/绑定|过审|已加入/);
  });

  test("no archetype option → uses the system-aware default seam (not a hardcoded 战士)", async () => {
    const h = makeHarness([{ passed: true, feedback: "通过" }]);

    // No archetype in options → handler falls back to deps.defaultArchetype (调查员).
    await h.handler(event({ options: {} }));

    expect(h.binds.lastSoul).toBeDefined();
    // The bound persona is the CoC investigator, NOT the D&D fighter preset.
    expect(h.binds.lastSoul?.personaCore.name).not.toBe("铁拳·冈");
  });

  test("verifier rejects past the cap → NOT bound, no approved seat, owner-fallback reply", async () => {
    const h = makeHarness([{ passed: false, feedback: "题材不符" }]);

    await h.handler(event());

    expect(h.binds).toEqual({ souls: [], sheets: 0, approved: [] });
    expect(h.roster).toHaveLength(0);
    expect(h.replies.join("\n")).toContain("题材不符");
  });
});
