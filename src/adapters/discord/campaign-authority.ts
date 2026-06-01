import type { CampaignId } from "../../domain/ids.js";
import type { RosterStore } from "../../ports/roster-store.js";
import type { CampaignMetaStore } from "../../ports/campaign-meta-store.js";
import type { CommandAuthority, CommandEvent } from "./command-router.js";

/**
 * campaign-authority.ts — the real {@link CommandAuthority} (ADR-0012; #33),
 * binding #31's injected permission predicates to the stored campaign owner and
 * the explicit party:
 *
 *   - `isOwner`  — the invoker matches the stored ownerId (CampaignMetaStore).
 *     No stored owner ⇒ false (owner-scoped commands are denied until an owner
 *     is recorded by `/set-roster`).
 *   - `inRoster` — the invoker matches a roster entry's discordUserId
 *     (RosterStore). No declared roster ⇒ false.
 *
 * The campaign is resolved per-event (channel → campaign) via an injected
 * resolver, keeping this free of routing concerns. Pure + headless.
 */

export interface CampaignAuthorityDeps {
  readonly metaStore: CampaignMetaStore;
  readonly rosterStore: RosterStore;
  /** Resolve the campaign the command targets (channel → campaign). */
  readonly resolveCampaign: (event: CommandEvent) => CampaignId;
}

export function createCampaignAuthority(deps: CampaignAuthorityDeps): CommandAuthority {
  return {
    isOwner(event: CommandEvent): boolean {
      const meta = deps.metaStore.get(deps.resolveCampaign(event));
      return meta !== undefined && meta.ownerId === event.invokerId;
    },
    inRoster(event: CommandEvent): boolean {
      const roster = deps.rosterStore.get(deps.resolveCampaign(event));
      return roster !== undefined && roster.some((e) => e.discordUserId === event.invokerId);
    },
  };
}
