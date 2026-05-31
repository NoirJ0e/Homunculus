import type { ActorId, SceneId } from "../domain/ids.js";

/**
 * The outcome of one awaited actor's turn within a beat (ADR-0003):
 * - `acted`  — contributed prose.
 * - `passed` — an explicit, deliberate pass (AI `pass`, or a human's
 *              "pass / 你们继续"). Releases the barrier.
 * - `silent` — a human gave no input at all. NOT a pass: holds the beat
 *              indefinitely (the one true "cold table" = pause/save state).
 *
 * AI actors are never `silent`: the wake-gate may filter them, but that is a
 * decision (≈ pass), not absence.
 */
export type TurnOutcome = "acted" | "passed" | "silent";

/**
 * The barrier releases iff every awaited actor has acted or explicitly passed.
 * A single silent human holds it — no timeout, no AI fallback (ADR-0003).
 */
export function classifyBeat(
  outcomes: ReadonlyMap<ActorId, TurnOutcome>,
): "released" | "held" {
  for (const outcome of outcomes.values()) {
    if (outcome === "silent") return "held";
  }
  return "released";
}

/**
 * A held beat, captured as a plain serializable object. ADR-0003's key insight:
 * an indefinite hold IS the pause/save state, so this is literally what you
 * persist to "stop for tonight" and resume later. JSON-round-trippable.
 */
export interface PauseState {
  readonly sceneId: SceneId;
  readonly aidmId: ActorId;
  /** The full set the beat awaited. */
  readonly awaiting: readonly ActorId[];
  /** Those who already resolved (acted or explicitly passed). */
  readonly acted: readonly ActorId[];
  /** Silent actors the beat is still holding for (resume targets). */
  readonly waitingOn: readonly ActorId[];
}

export function pauseFrom(
  sceneId: SceneId,
  aidmId: ActorId,
  awaiting: readonly ActorId[],
  outcomes: ReadonlyMap<ActorId, TurnOutcome>,
): PauseState {
  return {
    sceneId,
    aidmId,
    awaiting: [...awaiting],
    acted: awaiting.filter((a) => {
      const o = outcomes.get(a);
      return o === "acted" || o === "passed";
    }),
    waitingOn: awaiting.filter((a) => outcomes.get(a) === "silent"),
  };
}
