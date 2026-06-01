import type { ActorId, CampaignId } from "../domain/ids.js";
import type { RosterEntry } from "../domain/card-lifecycle.js";

/**
 * The explicit party list per campaign (ADR-0012): who is at the table and
 * whether each seat's card has passed verify. The open-gate (`/开场`) guard
 * reads this to require全员过审.
 */
export interface RosterStore {
  get(campaign: CampaignId): readonly RosterEntry[] | undefined;
  set(campaign: CampaignId, roster: readonly RosterEntry[]): void;
  /** Mark one seat's card approved (verify-bind succeeded). No-op if absent. */
  markApproved(campaign: CampaignId, actor: ActorId): void;
}
