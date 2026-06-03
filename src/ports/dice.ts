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
  readonly difficulty?: string;
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
