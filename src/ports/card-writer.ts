import type { ActorId, CampaignId } from "../domain/ids.js";
import type { CharacterSheet } from "./card-store.js";

/**
 * The non-AIDM write seam for character sheets (ADR-0012).
 *
 * {@link CardStore} is deliberately READ-ONLY because the AIDM must never write
 * sheets (ADR-0002 red line: AIDM only reads). Card creation / verify-bind is a
 * *different* actor, so it gets a *different*, narrower interface — this one.
 * The same file backend implements both, but the AIDM is only ever handed the
 * `CardStore` view; no write tool / MCP surface is exposed to it.
 */
export interface CardWriter {
  write(campaign: CampaignId, actor: ActorId, sheet: CharacterSheet): void;
}
