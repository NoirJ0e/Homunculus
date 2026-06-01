import type { ActorId, CampaignId } from "../domain/ids.js";
import type { SoulStore } from "../ports/soul-store.js";
import type { CardWriter } from "../ports/card-writer.js";
import type { RosterStore } from "../ports/roster-store.js";
import {
  verifyCard,
  type CampaignLegality,
  type CardVerifierLlm,
  type VerifiableCard,
  type Verdict,
} from "./card-verifier.js";

/**
 * card-verify-session.ts — the STATEFUL, per-thread 审卡反馈环 (ADR-0012 Phase 6,
 * #35). It is NOT one-shot: verify → feedback → player revises in-thread →
 * `/verify-card` again → … → pass → BIND. One session per player thread
 * (per-player isolation); the re-verify after a revise reuses the SAME session
 * (statefulness lives in the thread→session binding + the live drafts/legality
 * being re-read each round).
 *
 * The verdict itself comes from the provenance-agnostic core
 * ({@link verifyCard}) which is handed ONLY the authoritative legality state —
 * no prose-approval channel, no secretTruth (see card-verifier.ts). On a `passed`
 * verdict the session BINDS the card:
 *   - {@link SoulStore.save} (narrative persona → souls/),
 *   - {@link CardWriter.write} (mechanical sheet → sheets/, the non-AIDM path),
 *   - {@link RosterStore.markApproved} (the seat's verify state → roster.json).
 *
 * `readCard` / `readLegality` are seams the live wiring binds to the open-card
 * session's current drafts and the campaign's authoritative state; they are
 * re-invoked on every `verify()` so a revise is reflected on re-verify.
 */

export interface CardVerifySessionInit {
  readonly threadId: string;
  readonly actorId: ActorId;
  readonly campaignId: CampaignId;
  /** The injected adjudicator (real LLM in prod, stub in tests). */
  readonly llm: CardVerifierLlm;
  /** Read the card under review NOW (re-read each round → revises are seen). */
  readonly readCard: () => VerifiableCard;
  /** Read the campaign's authoritative legality NOW (picks up new exceptions). */
  readonly readLegality: () => CampaignLegality;
  readonly soulStore: SoulStore;
  readonly cardWriter: CardWriter;
  readonly rosterStore: RosterStore;
}

export class CardVerifySession {
  readonly threadId: string;
  readonly actorId: ActorId;
  readonly campaignId: CampaignId;
  private readonly init: CardVerifySessionInit;

  constructor(init: CardVerifySessionInit) {
    this.threadId = init.threadId;
    this.actorId = init.actorId;
    this.campaignId = init.campaignId;
    this.init = init;
  }

  /**
   * Run one round of the feedback loop: read the current card + authoritative
   * legality, adjudicate via the provenance-agnostic core, and on `passed` BIND
   * (save soul + write sheet + mark roster approved). Returns the verdict so the
   * handler can post the feedback back into the thread.
   */
  async verify(): Promise<Verdict> {
    const card = this.init.readCard();
    const legality = this.init.readLegality();
    const verdict = await verifyCard(card, legality, this.init.llm);

    if (verdict.passed) {
      this.init.soulStore.save(card.soul);
      this.init.cardWriter.write(this.campaignId, this.actorId, card.sheet);
      this.init.rosterStore.markApproved(this.campaignId, this.actorId);
    }

    return verdict;
  }
}

/**
 * The per-thread verify-session table. Keyed by threadId so re-running
 * `/verify-card` in the same thread continues the SAME stateful session (and
 * never crosses into another player's thread).
 */
export class CardVerifySessionTable {
  private readonly byThread = new Map<string, CardVerifySession>();

  bind(session: CardVerifySession): void {
    this.byThread.set(session.threadId, session);
  }

  get(threadId: string): CardVerifySession | undefined {
    return this.byThread.get(threadId);
  }

  delete(threadId: string): void {
    this.byThread.delete(threadId);
  }
}
