import type { ActorId } from "../domain/ids.js";
import type { Soul } from "../domain/soul.js";
import type { SoulStore } from "../ports/soul-store.js";
import type { CardShimPort, CardSnapshot } from "../ports/card-shim.js";

/**
 * canonicity — the git model for souls (ADR-0004).
 *
 * A session opens by FORKING the involved souls from canonical HEAD onto a
 * branch; their growth + memory + persona evolve on the branch. The session
 * closes with the owner's choice:
 *   - merge   → land growth + memory + persona (and death) into canonical.
 *   - discard → roll back as if nothing happened (even sheet-tearing death).
 *
 * Memory does NOT merge across party-split branches (ADR-0005) — only the world
 * state does; that lives in #10. This module is the per-soul fork/merge/discard.
 */
export interface SessionBranch {
  readonly branchId: string;
  /** Working copies of the forked souls — mutate these during the session. */
  readonly souls: Map<ActorId, Soul>;
  /** Card snapshots taken at fork, used to restore on discard. */
  readonly cardSnapshots: readonly CardSnapshot[];
}

export interface BranchDeps {
  readonly store: SoulStore;
  readonly cards?: CardShimPort;
}

export interface ForkRequest extends BranchDeps {
  readonly branchId: string;
  readonly soulIds: readonly ActorId[];
}

/** Open a branch: copy each soul off canonical HEAD and snapshot its sheet. */
export async function fork(req: ForkRequest): Promise<SessionBranch> {
  const souls = new Map<ActorId, Soul>();
  const cardSnapshots: CardSnapshot[] = [];
  for (const id of req.soulIds) {
    const soul = req.store.load(id);
    if (soul) souls.set(id, soul); // load() returns an independent (deserialized) copy
    if (req.cards) cardSnapshots.push(await req.cards.snapshot(id));
  }
  return { branchId: req.branchId, souls, cardSnapshots };
}

/** Land the branch: commit working souls to canonical; branch sheet state stands. */
export async function merge(branch: SessionBranch, _deps: BranchDeps): Promise<void> {
  for (const soul of branch.souls.values()) {
    _deps.store.save(soul);
  }
}

/** Drop the branch: canonical souls untouched; sheets restored to their fork
 *  snapshots (undoing in-session changes, including death). */
export async function discard(branch: SessionBranch, deps: BranchDeps): Promise<void> {
  // Intentionally do NOT save souls — canonical stays as it was.
  if (deps.cards) {
    for (const snap of branch.cardSnapshots) {
      await deps.cards.restore(snap);
    }
  }
}
