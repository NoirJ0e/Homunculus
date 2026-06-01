import type { CampaignId } from "../domain/ids.js";
import type { Soul } from "../domain/soul.js";
import type { SoulStore } from "../ports/soul-store.js";
import type { RosterStore } from "../ports/roster-store.js";

/**
 * load-teammates.ts — the AIDM cast's bound-teammate loader (ADR-0012 修正, #37).
 *
 * REPLACES the ADR-0011 bypass where `runAidmQuery` inlined `genesisFullAuto` to
 * fabricate a teammate at spin-up (that bypass dodged 审卡 entirely). The AIDM
 * cast's AI teammates are now the campaign's VERIFIED, BOUND seats: read the
 * roster, keep only approved `ai` seats, and load each one's persisted soul from
 * the {@link SoulStore} (saved at bind time by {@link addAiSeat}). A seat with no
 * saved soul is skipped (defensive). If no bound teammate exists the result is
 * empty — the runner degrades gracefully (flags it + narrates solo).
 *
 * Pure read-only composition over the two stores → fully unit-tested headless.
 */
export function loadBoundTeammates(
  rosterStore: RosterStore,
  soulStore: SoulStore,
  campaign: CampaignId,
): readonly Soul[] {
  const roster = rosterStore.get(campaign) ?? [];
  const teammates: Soul[] = [];
  for (const entry of roster) {
    if (entry.kind !== "ai" || !entry.approved) continue;
    const soul = soulStore.load(entry.actorId);
    if (soul !== undefined) teammates.push(soul);
  }
  return teammates;
}
