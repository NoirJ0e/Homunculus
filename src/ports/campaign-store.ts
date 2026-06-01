import type { CampaignId } from "../domain/ids.js";
import type { CampaignBible } from "../domain/campaign.js";

/**
 * Persistence for the {@link CampaignBible} (the plot spine + DM底牌), keyed by
 * campaign (ADR-0012). Replaces ADR-0011's in-memory bible so a restart no
 * longer forgets the campaign.
 */
export interface CampaignStore {
  get(campaign: CampaignId): CampaignBible | undefined;
  set(campaign: CampaignId, bible: CampaignBible): void;
}
