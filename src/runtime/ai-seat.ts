import type { ActorId, CampaignId } from "../domain/ids.js";
import type { CharacterSheet } from "../ports/card-store.js";
import type { SoulStore } from "../ports/soul-store.js";
import type { CardWriter } from "../ports/card-writer.js";
import type { RosterStore } from "../ports/roster-store.js";
import type { RosterEntry } from "../domain/card-lifecycle.js";
import { genesisFullAuto } from "../genesis/soul-genesis.js";
import {
  verifyCard,
  type CampaignLegality,
  type CardVerifierLlm,
  type VerifiableCard,
} from "./card-verifier.js";

/**
 * ai-seat.ts — the AI-teammate seat lifecycle (ADR-0012 修正, #37).
 *
 * THE POINT (a user catch): an AI-generated teammate card is NOT exempt from
 * review. It walks the SAME create→verify→bind path as a human, through the very
 * same provenance-agnostic {@link verifyCard} gate (no provenance branch). The
 * only difference from the human `/verify-card` loop is WHO revises on a reject:
 * a human edits in-thread, an AI seat is revised automatically by an injected
 * {@link AiReviser} — capped at {@link AiSeatDeps.maxRevisions} tries. On a pass
 * the card is bound (soul saved + sheet written + roster markApproved); on
 * exhausting the cap the owner is notified and the seat is NOT bound (owner can
 * `/批准` an exception or change archetype).
 *
 * Deterministic genesis can't self-vary, so revision MUST go through the reviser
 * seam (an LLM in prod, a stub in tests). This module is fully headless: every
 * collaborator (verifier LLM, reviser, stores, owner notifier) is injected.
 */

/** The default cap on automated revise attempts before owner fallback. */
export const DEFAULT_MAX_REVISIONS = 3;

/**
 * The injected automated reviser: given the rejected draft and the verifier's
 * feedback, produce a revised draft to re-verify. An LLM in production; a stub
 * in tests. (Deterministic genesis can't self-vary, so the revise step lives
 * here rather than re-rolling genesis.)
 */
export type AiReviser = (card: VerifiableCard, feedback: string) => Promise<VerifiableCard>;

export interface AiSeatDeps {
  readonly campaignId: CampaignId;
  /** The actor id this AI seat binds to. */
  readonly actorId: ActorId;
  /** Archetype label fed to one-click genesis for the initial draft. */
  readonly archetype: string;
  /** The mechanical sheet to attach to the draft (v1: supplied by the caller). */
  readonly sheet: CharacterSheet;
  /** Authoritative campaign legality the verifier adjudicates against (#35). */
  readonly legality: CampaignLegality;
  /** The SAME provenance-agnostic verifier the human path uses (#35). */
  readonly verifierLlm: CardVerifierLlm;
  /** Automated reviser seam (LLM in prod, stub in tests). */
  readonly reviser: AiReviser;
  readonly soulStore: SoulStore;
  readonly cardWriter: CardWriter;
  readonly rosterStore: RosterStore;
  /** Notify the owner when the revise cap is exhausted (owner fallback). */
  readonly notifyOwner: (message: string) => Promise<void>;
  /** Cap on automated revise attempts; defaults to {@link DEFAULT_MAX_REVISIONS}. */
  readonly maxRevisions?: number;
}

export interface AiSeatResult {
  /** Whether the seat passed verify and was bound. */
  readonly bound: boolean;
  /** How many automated revise attempts ran (0 = passed on the first draft). */
  readonly revisions: number;
}

/**
 * Run the AI seat through genesis → SAME verifier → capped auto-revise loop →
 * bind / owner-fallback. Returns whether the seat was bound and how many
 * revisions it took.
 */
export async function addAiSeat(deps: AiSeatDeps): Promise<AiSeatResult> {
  const cap = deps.maxRevisions ?? DEFAULT_MAX_REVISIONS;

  // create: deterministic genesis draft (soul + the supplied sheet).
  let card: VerifiableCard = {
    soul: genesisFullAuto(deps.actorId, deps.archetype),
    sheet: deps.sheet,
  };

  for (let revisions = 0; ; revisions += 1) {
    // verify: the SAME provenance-agnostic gate, no provenance branch.
    const verdict = await verifyCard(card, deps.legality, deps.verifierLlm);

    if (verdict.passed) {
      bind(deps, card.soul, card.sheet);
      return { bound: true, revisions };
    }

    if (revisions >= cap) {
      await deps.notifyOwner(ownerFallbackMessage(deps, verdict.feedback, cap));
      return { bound: false, revisions };
    }

    // revise: the reviser adjusts the draft from the feedback, then re-verify.
    card = await deps.reviser(card, verdict.feedback);
  }
}

function bind(deps: AiSeatDeps, soul: VerifiableCard["soul"], sheet: CharacterSheet): void {
  deps.soulStore.save(soul);
  deps.cardWriter.write(deps.campaignId, deps.actorId, sheet);
  deps.rosterStore.markApproved(deps.campaignId, deps.actorId);
}

function ownerFallbackMessage(deps: AiSeatDeps, lastFeedback: string, cap: number): string {
  return (
    `AI 队友席位「${deps.actorId}」自动改写 ${cap} 次仍未过审，已停止并交回。` +
    `最后一次反馈：${lastFeedback}。` +
    `可用 \`/approve\` 批准例外，或更换 archetype 重试。`
  );
}

/** Re-exported for callers wiring the roster (kind "ai" seat). */
export type { RosterEntry };
