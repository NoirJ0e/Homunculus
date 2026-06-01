import type { ActorId } from "../domain/ids.js";

/**
 * 分支快照垫片 (card-snapshot shim) — the seam that keeps SealDice's card state
 * consistent with our branch decisions (ADR-0004/0001). SealDice doesn't know
 * about our branches, so at fork we snapshot the sheet and on discard we restore
 * it (undoing in-session changes, including a sheet-tearing death). On merge the
 * branch's sheet state simply stands.
 */
export interface CardSnapshot {
  readonly actorId: ActorId;
  readonly state: Readonly<Record<string, unknown>>;
}

export interface CardShimPort {
  snapshot(actor: ActorId): Promise<CardSnapshot>;
  restore(snap: CardSnapshot): Promise<void>;
}
