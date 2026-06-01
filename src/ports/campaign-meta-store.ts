import type { CampaignId } from "../domain/ids.js";

/**
 * Per-campaign meta that is neither bible nor roster (ADR-0012). v1 holds only
 * the campaign OWNER — the Discord user whose id the `isOwner` authority
 * predicate checks for owner-scoped commands (`/开场`, `/批准`, `/set-roster`).
 *
 * The owner is the lobby invoker who created the campaign; the proper capture
 * point is provisioning. As a #33 slice this is persisted by the `set-roster`
 * handler instead (the first owner-gated touch); wiring owner-capture into
 * provisioning is a flagged follow-up.
 */
export interface CampaignMeta {
  /** Discord user snowflake of the campaign owner. */
  readonly ownerId: string;
}

export interface CampaignMetaStore {
  get(campaign: CampaignId): CampaignMeta | undefined;
  set(campaign: CampaignId, meta: CampaignMeta): void;
}
