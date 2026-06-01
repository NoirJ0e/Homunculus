import type { ActorId } from "./ids.js";
import type { ActorKind } from "../engine/roster.js";

/**
 * An owner-sanctioned exception to a campaign's card-legality rules (ADR-0012).
 * Authority comes only from the owner's `/批准` command writing this entry —
 * never from prose the player wrote. The verifier reads these; it ignores any
 * "我跟 DM 商量过" claims in the card text.
 */
export interface SanctionedException {
  /** The thing being allowed (e.g. an off-era item, a forbidden lineage). */
  readonly item: string;
  /** Optional owner note recorded with the approval. */
  readonly note?: string;
}

/**
 * One seat on the explicit party list (ADR-0012). `kind` reuses the engine's
 * human/AI distinction; `approved` is the per-seat verify state the open-gate
 * (`/开场`) guard checks. `discordUserId` binds a human seat to its player.
 */
export interface RosterEntry {
  readonly actorId: ActorId;
  readonly discordUserId?: string;
  readonly kind: ActorKind;
  readonly approved: boolean;
}
