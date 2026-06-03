import type { ActorId } from "../domain/ids.js";

/**
 * Dice port — the dice/rules authority (ADR-0001, ADR-0002, ADR-0013). The dice
 * authority owns mechanical resolution and is the sole writer of mechanical
 * state; the AIDM only reads. The production implementation is BCDice in-process
 * (ADR-0013); `NativeDice` remains the offline/test fallback on the same port.
 *
 * Historically named `SealDicePort` after the planned SealDice sidecar (ADR-0001);
 * renamed to `DicePort` once ADR-0013 dropped SealDice for BCDice.
 */
export interface RollRequest {
  readonly actorId: ActorId;
  readonly skill: string;
  /**
   * Difficulty band or target number.
   * - CoC7: "hard" | "extreme" (collapses the success threshold).
   * - D&D5e: a DC or AC as a string like "dc15" or "15"; parsed as a number.
   *   Default 10 when absent. For attacks this is the target AC.
   */
  readonly difficulty?: string;

  // ── D&D5e-specific fields (#42). All optional; ignored for CoC7. ──

  /**
   * Roll mode for D&D5e:
   * - "check"  (default) → ability check via BCDice `AR±mod>=DC`
   * - "attack"           → attack roll via BCDice `AT±mod>=AC`
   *
   * When absent, treated as "check".
   */
  readonly mode?: "check" | "attack";

  /**
   * Advantage / disadvantage for D&D5e:
   * - "advantage"    → roll 2d20, take the higher (BCDice `A` suffix)
   * - "disadvantage" → roll 2d20, take the lower  (BCDice `D` suffix)
   *
   * When absent, a straight roll is used.
   */
  readonly advantage?: "advantage" | "disadvantage";
}

export interface RollResult {
  readonly actorId: ActorId;
  readonly skill: string;
  readonly total: number;
  readonly success: boolean;
  /** Human-readable roll breakdown, e.g. "d100=37 ≤ 60 侦查 → 成功". */
  readonly detail: string;
}

export interface DicePort {
  roll(req: RollRequest): Promise<RollResult>;
}
