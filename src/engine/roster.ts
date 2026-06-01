import type { ActorId } from "../domain/ids.js";

/**
 * Whether an awaited actor is driven by a human or an AI. The distinction is
 * load-bearing for pacing (ADR-0003): only a human can be `silent` and hold a
 * beat; an AI either acts, passes, or is filtered by the wake-gate.
 */
export type ActorKind = "ai" | "human";

/** Authoritative knowledge of who is human vs AI at the table. */
export interface Roster {
  kindOf(actor: ActorId): ActorKind;
}

/** A roster backed by a plain map; unknown actors default to AI. */
export function mapRoster(kinds: Record<string, ActorKind>): Roster {
  return { kindOf: (actor) => kinds[actor] ?? "ai" };
}
