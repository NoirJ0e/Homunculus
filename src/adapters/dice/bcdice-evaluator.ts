import { createRequire } from "node:module";
// Type-only import (erased at runtime → no CJS-named-export crash); recovers the
// DynamicLoader instance type for the annotations below.
import type { DynamicLoader as DynamicLoaderType } from "bcdice";
import type { BcdiceEvaluator, BcdiceEval } from "./bcdice-dice.js";

/**
 * LibBcdiceEvaluator — the real {@link BcdiceEvaluator}, backed by npm `bcdice`
 * (ADR-0013). It lazily loads and caches each game-system class via BCDice's
 * `DynamicLoader`, then runs the system's static `eval`. This is the ONLY module
 * that touches the BCDice library surface; everything else sees `BcdiceEvaluator`.
 *
 * BCDice's `Result` is structurally a {@link BcdiceEval} (it carries text/
 * success/failure/critical/fumble/detailedRands), so no field mapping is needed.
 *
 * `bcdice` is a CommonJS package with no real ESM named exports: a static
 * `import { DynamicLoader } from "bcdice"` typechecks (the .d.ts declares them)
 * but CRASHES under the Node ESM loader at runtime ("does not provide an export
 * named 'DynamicLoader'"). So we `createRequire` it — the robust ESM-imports-CJS
 * pattern — and recover the types via `typeof import("bcdice")`.
 */
const { DynamicLoader } = createRequire(import.meta.url)("bcdice") as typeof import("bcdice");
export class LibBcdiceEvaluator implements BcdiceEvaluator {
  private readonly loader = new DynamicLoader();
  private readonly systems = new Map<string, ReturnType<DynamicLoaderType["dynamicLoad"]>>();

  async eval(systemId: string, command: string): Promise<BcdiceEval | null> {
    const system = await this.load(systemId);
    return system.eval(command);
  }

  private load(systemId: string): ReturnType<DynamicLoaderType["dynamicLoad"]> {
    const cached = this.systems.get(systemId);
    if (cached) return cached;
    const loading = this.loader.dynamicLoad(systemId);
    this.systems.set(systemId, loading);
    return loading;
  }
}
