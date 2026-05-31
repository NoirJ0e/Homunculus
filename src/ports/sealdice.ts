import type { ActorId } from "../domain/ids.js";

/**
 * SealDice port — the dice/rules authority (ADR-0001, ADR-0002). SealDice owns
 * the character sheet and is the sole writer of mechanical state; the AIDM only
 * reads. A real HTTP/IPC sidecar adapter lands in #5; tests use a scripted fake.
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

export interface SealDicePort {
  roll(req: RollRequest): Promise<RollResult>;
}
