import type { DicePort, RollRequest, RollResult } from "../../ports/dice.js";

/**
 * Scripted in-memory dice authority: returns pre-canned results in order, so
 * tests stay deterministic without a real dice authority. Records requests.
 */
export class FakeDice implements DicePort {
  private readonly results: RollResult[];
  readonly requests: RollRequest[] = [];

  constructor(results: readonly RollResult[]) {
    this.results = [...results];
  }

  async roll(req: RollRequest): Promise<RollResult> {
    this.requests.push(req);
    const result = this.results.shift();
    if (!result) {
      throw new Error(`FakeDice: no scripted result left for "${req.skill}"`);
    }
    return result;
  }
}
