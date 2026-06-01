import type { Soul } from "../domain/soul.js";
import type { CharacterSheet } from "../ports/card-store.js";
import type { CampaignBible } from "../domain/campaign.js";
import type { SanctionedException } from "../domain/card-lifecycle.js";

/**
 * card-verifier.ts — the PROVENANCE-AGNOSTIC card-legality gate (ADR-0012).
 *
 * Legality is a fact about "this card vs the campaign's rules" — it does NOT
 * depend on who made the card or how. So the verifier is a single reusable core
 * consumed by BOTH paths: the human `/verify-card` feedback loop (#35) and the
 * AI auto-rewrite loop (#37). An AI-generated teammate card is NOT exempt; it
 * goes through the exact same gate.
 *
 * The real verdict is an LLM call (HITL). The LLM is INJECTED as
 * {@link CardVerifierLlm} so tests stub it — no network, fully headless.
 *
 * IRON RULE (enforced structurally, not by convention):
 *   1. The verifier is handed ONLY {@link CampaignLegality} — the authoritative
 *      legality state. That type carries NO prose-approval field and NO channel
 *      for "我跟 DM 商量过/已获批准" claims. A player literally cannot construct
 *      one; the ONLY exception authority is the owner-written
 *      {@link SanctionedException}[] (written via `/批准`, #31 owner-only). The
 *      verifier prompt is also told to ignore any approval claims in card prose.
 *   2. NO `secretTruth` (blindbox, ADR-0007). {@link buildLegality} derives the
 *      legality context from a {@link CampaignBible} by reading ONLY its
 *      non-secret legality fields; `secretTruth` is never copied in, and
 *      `CampaignLegality` has no field to hold it.
 */

/** The card under review: the narrative persona draft + the mechanical sheet. */
export interface VerifiableCard {
  readonly soul: Soul;
  readonly sheet: CharacterSheet;
}

/**
 * The AUTHORITATIVE legality state the verifier is allowed to see. This is the
 * whole input surface — there is deliberately no prose-approval field and no
 * `secretTruth` field, so neither can ever reach the verifier. Tone/era/levelBand
 * are the bible's legality knobs; `bespokeRules` is the bible's residual rule
 * bucket; `exceptions` is the owner-sanctioned allow-list (the sole exception
 * authority).
 */
export interface CampaignLegality {
  /** Tonal genre the card must fit (e.g. "黑色侦探", "克系恐怖"). */
  readonly tone?: string;
  /** Era/setting label the card must fit (e.g. "1920s", "中世纪"). */
  readonly era?: string;
  /** [minLevel, maxLevel] the card's power must sit within. */
  readonly levelBand?: readonly [number, number];
  /** The bible's residual bespoke mechanics bucket (authoritative). */
  readonly bespokeRules: Readonly<Record<string, unknown>>;
  /** Owner-sanctioned exceptions — the ONLY source of exception authority. */
  readonly exceptions: readonly SanctionedException[];
}

/** The verdict the gate returns: pass/fail + feedback to relay to the author. */
export interface Verdict {
  readonly passed: boolean;
  readonly feedback: string;
}

/**
 * The injected adjudicator (an LLM in production, a stub in tests). It is handed
 * ONLY the card and the authoritative legality state — by construction it has no
 * access to prose-approval claims or `secretTruth`.
 */
export interface CardVerifierLlm {
  adjudicate(card: VerifiableCard, legality: CampaignLegality): Promise<Verdict>;
}

/**
 * Build the authoritative legality context from a campaign bible + the owner's
 * sanctioned exceptions. Reads ONLY the bible's non-secret legality fields;
 * `secretTruth` is structurally dropped (the output type has no field for it).
 * Optional legality knobs (`tone`/`era`/`levelBand`) are supplied alongside —
 * they are authoritative campaign facts, not derivable from this v1 bible shape.
 */
export function buildLegality(
  bible: CampaignBible,
  exceptions: readonly SanctionedException[],
  knobs: { tone?: string; era?: string; levelBand?: readonly [number, number] } = {},
): CampaignLegality {
  return {
    ...(knobs.tone !== undefined ? { tone: knobs.tone } : {}),
    ...(knobs.era !== undefined ? { era: knobs.era } : {}),
    ...(knobs.levelBand !== undefined ? { levelBand: knobs.levelBand } : {}),
    bespokeRules: bible.bespokeRules,
    exceptions,
    // NOTE: bible.secretTruth is intentionally NOT read — blindbox (ADR-0007).
  };
}

/**
 * Adjudicate a card against the authoritative legality state. The verdict is the
 * injected LLM's; this core just enforces that it ONLY ever receives the
 * authoritative context (card + legality) — no prose-approval channel, no
 * secretTruth.
 */
export function verifyCard(
  card: VerifiableCard,
  legality: CampaignLegality,
  llm: CardVerifierLlm,
): Promise<Verdict> {
  return llm.adjudicate(card, legality);
}
