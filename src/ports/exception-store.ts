import type { CampaignId } from "../domain/ids.js";
import type { SanctionedException } from "../domain/card-lifecycle.js";

/**
 * The owner-sanctioned card-legality exception list, keyed by campaign
 * (ADR-0012). Append-only via `/批准`; the card verifier reads it as the *only*
 * source of exception authority (prose claims are ignored).
 */
export interface ExceptionStore {
  list(campaign: CampaignId): readonly SanctionedException[];
  add(campaign: CampaignId, exception: SanctionedException): void;
}
