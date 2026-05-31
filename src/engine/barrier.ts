import type { ActorId } from "../domain/ids.js";

/**
 * 屏障 (barrier) — the pacing primitive of ADR-0003.
 *
 * The AIDM throws a beat that awaits responses from a set of actors and the
 * barrier holds the beat until each awaited actor has "acted or explicitly
 * passed". This module is the pure bookkeeping of that hold; the richer
 * pass/hold/wake-gate semantics of #2 layer on top of it.
 */
export interface BarrierState {
  /** Actors whose turn the beat is still waiting on. */
  readonly waiting: readonly ActorId[];
  /** Actors that have already taken their turn (acted or passed). */
  readonly acted: readonly ActorId[];
}

export function openBarrier(waiting: readonly ActorId[]): BarrierState {
  return { waiting: [...waiting], acted: [] };
}

export function recordAction(b: BarrierState, actor: ActorId): BarrierState {
  if (!b.waiting.includes(actor) || b.acted.includes(actor)) return b;
  return { waiting: b.waiting, acted: [...b.acted, actor] };
}

export function isReleased(b: BarrierState): boolean {
  return b.waiting.every((a) => b.acted.includes(a));
}
