import type { CampaignBible } from "../domain/campaign.js";

/**
 * Runtime progress along the spine (ADR-0007). One cursor PER BRANCH
 * (ADR-0004/0005) — branches each carry their own. The AIDM judges a milestone
 * complete and writes the advance; the engine owns the state.
 */
export interface MilestoneCursorState {
  /** Id of the current load-bearing milestone, or null once the spine is done. */
  readonly currentMilestone: string | null;
  readonly completed: readonly string[];
  /** Breadcrumbs the party has uncovered — fuel for soft gravity. */
  readonly discoveredLeads: readonly string[];
}

export function initCursor(bible: CampaignBible): MilestoneCursorState {
  return {
    currentMilestone: bible.milestones[0]?.id ?? null,
    completed: [],
    discoveredLeads: [],
  };
}

/** AIDM declares the current milestone done → advance to the next (or null). */
export function completeCurrent(
  state: MilestoneCursorState,
  bible: CampaignBible,
): MilestoneCursorState {
  const current = state.currentMilestone;
  if (current === null) return state;

  const idx = bible.milestones.findIndex((m) => m.id === current);
  const next = idx >= 0 ? bible.milestones[idx + 1] : undefined;
  return {
    currentMilestone: next?.id ?? null,
    completed: [...state.completed, current],
    discoveredLeads: state.discoveredLeads,
  };
}

export function discoverLead(
  state: MilestoneCursorState,
  lead: string,
): MilestoneCursorState {
  if (state.discoveredLeads.includes(lead)) return state;
  return { ...state, discoveredLeads: [...state.discoveredLeads, lead] };
}
