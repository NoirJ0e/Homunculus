import type { SealDicePort, RollRequest, RollResult } from "../../ports/sealdice.js";

/**
 * Scripted in-memory dice authority: returns pre-canned results in order, so
 * tests stay deterministic without a real SealDice sidecar. Records requests.
 */
export class FakeSealDice implements SealDicePort {
  private readonly results: RollResult[];
  readonly requests: RollRequest[] = [];

  constructor(results: readonly RollResult[]) {
    this.results = [...results];
  }

  async roll(req: RollRequest): Promise<RollResult> {
    this.requests.push(req);
    const result = this.results.shift();
    if (!result) {
      throw new Error(`FakeSealDice: no scripted result left for "${req.skill}"`);
    }
    return result;
  }
}
