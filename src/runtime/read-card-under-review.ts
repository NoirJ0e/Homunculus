import type { ActorId } from "../domain/ids.js";
import type { CharacterSheet } from "../ports/card-store.js";
import type { VerifiableCard } from "./card-verifier.js";
import type { CardCreationSession } from "./card-creation-session.js";
import { genesisFullAuto } from "../genesis/soul-genesis.js";

/**
 * read-card-under-review.ts — the `readCard` seam for the `/verify-card` handler
 * (ADR-0012; #36 wiring). The verifier core needs a COMPLETE
 * {@link VerifiableCard} (soul + sheet) to adjudicate; the open-card session
 * holds them as OPTIONAL pending drafts, populated by the assistant's
 * `hold_card` tool (arch-C2 — the talked-out persona lands as drafts).
 *
 * Held drafts win; the genesis-derived default + baseline sheet remain the
 * EXCEPTION branch — a player who `/verify-card`s before settling a concept
 * (or a session lost to restart) still gets a complete, adjudicable card.
 * Pure + headless-testable (genesis is deterministic).
 */

export interface ReadCardDeps {
  /** Look up the open-card session bound to this thread (drafts source). */
  readonly sessionFor: (threadId: string) => CardCreationSession | undefined;
  /** The actor id the card binds to (for the genesis fallback persona). */
  readonly actorId: ActorId;
  /** Archetype fed to the genesis fallback when no soul draft is held. */
  readonly fallbackArchetype: string;
  /** The v1 baseline sheet used when no sheet draft is held. */
  readonly fallbackSheet: CharacterSheet;
}

/**
 * Resolve the card under review for a thread: held drafts first, deterministic
 * genesis / baseline fallback for any missing half.
 */
export function readCardUnderReview(threadId: string, deps: ReadCardDeps): VerifiableCard {
  const drafts = deps.sessionFor(threadId)?.drafts;
  const soul = drafts?.soul ?? genesisFullAuto(deps.actorId, deps.fallbackArchetype);
  const sheet = drafts?.sheet ?? deps.fallbackSheet;
  return { soul, sheet };
}
