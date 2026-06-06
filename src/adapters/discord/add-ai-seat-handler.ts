import type { ActorId, CampaignId } from "../../domain/ids.js";
import type { CharacterSheet } from "../../ports/card-store.js";
import type { SoulStore } from "../../ports/soul-store.js";
import type { CardWriter } from "../../ports/card-writer.js";
import type { RosterStore } from "../../ports/roster-store.js";
import type { RosterEntry } from "../../domain/card-lifecycle.js";
import type { CampaignLegality, CardVerifierLlm } from "../../runtime/card-verifier.js";
import { addAiSeat, type AiReviser } from "../../runtime/ai-seat.js";
import type { CommandEvent, CommandHandler } from "./command-router.js";

/**
 * add-ai-seat-handler.ts — the owner-facing `/add-ai-seat` handler (ADR-0012 修正,
 * #37), wired into #31's router as an OWNER-scoped registration. It is the prep-
 * time way an owner adds an AI teammate seat to the party.
 *
 * THE POINT (the漏洞 this slice plugs): the AI seat is NOT exempt from review. It
 * runs the SAME create→verify→bind path as a human via {@link addAiSeat} —
 * genesis draft → the SAME provenance-agnostic verifier (#35) → capped automated
 * revise loop → on pass BIND (soul saved + sheet written + roster markApproved),
 * on cap-exhaustion notify the owner (NO bind). On a successful bind this handler
 * also appends an APPROVED `ai` {@link RosterEntry} so the open-gate guard counts
 * it and the AIDM runner loads it (`assembleAidmCast`).
 *
 * Headless: every collaborator (verifier LLM, reviser, stores, reply) is an
 * injected seam.
 */

export interface AddAiSeatDeps {
  /** Resolve the campaign the command targets (channel → campaign). */
  readonly resolveCampaign: (event: CommandEvent) => CampaignId;
  /** The actor id the new AI seat binds to (e.g. from a `name` option). */
  readonly resolveActor: (event: CommandEvent) => ActorId;
  /** Read the campaign's authoritative legality NOW (bible knobs + exceptions). */
  readonly legality: (event: CommandEvent) => CampaignLegality;
  /** The mechanical sheet to attach to the draft (v1: caller-supplied). */
  readonly sheetFor: (event: CommandEvent) => CharacterSheet;
  /**
   * The default genesis archetype when the owner gives no `archetype` option (#47).
   * System-aware (live: `defaultArchetypeFor(systemFor(event))`), so a CoC campaign's
   * empty seat fills with an investigator, NOT a hardcoded D&D "战士".
   */
  readonly defaultArchetype: (event: CommandEvent) => string;
  /** The SAME provenance-agnostic verifier the human path uses (#35). */
  readonly verifierLlm: (event: CommandEvent) => CardVerifierLlm;
  /** Automated reviser seam (LLM in prod, stub in tests). */
  readonly reviser: AiReviser;
  readonly soulStore: SoulStore;
  readonly cardWriter: CardWriter;
  readonly rosterStore: RosterStore;
  /** Reply to the invoking owner (live: interaction reply; tests: recorder). */
  readonly reply: (text: string) => Promise<void>;
  /** Cap on automated revise attempts before owner fallback. */
  readonly maxRevisions?: number;
}

export function createAddAiSeatHandler(deps: AddAiSeatDeps): CommandHandler {
  return async (event: CommandEvent): Promise<void> => {
    const campaign = deps.resolveCampaign(event);
    const actor = deps.resolveActor(event);
    const archetype = event.options["archetype"] ?? deps.defaultArchetype(event);

    const result = await addAiSeat({
      campaignId: campaign,
      actorId: actor,
      archetype,
      sheet: deps.sheetFor(event),
      legality: deps.legality(event),
      verifierLlm: deps.verifierLlm(event),
      reviser: deps.reviser,
      soulStore: deps.soulStore,
      cardWriter: deps.cardWriter,
      rosterStore: deps.rosterStore,
      notifyOwner: deps.reply,
      ...(deps.maxRevisions !== undefined ? { maxRevisions: deps.maxRevisions } : {}),
    });

    if (!result.bound) {
      // addAiSeat already notified via notifyOwner (= reply). Nothing else to do;
      // the seat is intentionally NOT added to the roster.
      return;
    }

    // Bound: append (or upsert) an APPROVED ai seat so the open-gate guard counts
    // it and the AIDM runner loads its persisted soul.
    const existing = deps.rosterStore.get(campaign) ?? [];
    const seat: RosterEntry = { actorId: actor, kind: "ai", approved: true };
    const next = [...existing.filter((e) => e.actorId !== actor), seat];
    deps.rosterStore.set(campaign, next);

    await deps.reply(`AI 队友席位「${actor}」已过审并绑定，已加入名单（${result.revisions} 次改写）。`);
  };
}
