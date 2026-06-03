import { DynamicLoader } from "bcdice";
import type { BcdiceEvaluator, BcdiceEval } from "./bcdice-dice.js";

/**
 * LibBcdiceEvaluator — the real {@link BcdiceEvaluator}, backed by npm `bcdice`
 * (ADR-0013). It lazily loads and caches each game-system class via BCDice's
 * `DynamicLoader`, then runs the system's static `eval`. This is the ONLY module
 * that touches the BCDice library surface; everything else sees `BcdiceEvaluator`.
 *
 * BCDice's `Result` is structurally a {@link BcdiceEval} (it carries text/
 * success/failure/critical/fumble/detailedRands), so no field mapping is needed.
 */
export class LibBcdiceEvaluator implements BcdiceEvaluator {
  private readonly loader = new DynamicLoader();
  private readonly systems = new Map<string, ReturnType<DynamicLoader["dynamicLoad"]>>();

  async eval(systemId: string, command: string): Promise<BcdiceEval | null> {
    const system = await this.load(systemId);
    return system.eval(command);
  }

  private load(systemId: string): ReturnType<DynamicLoader["dynamicLoad"]> {
    const cached = this.systems.get(systemId);
    if (cached) return cached;
    const loading = this.loader.dynamicLoad(systemId);
    this.systems.set(systemId, loading);
    return loading;
  }
}
