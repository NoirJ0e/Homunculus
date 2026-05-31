import type { ActorId, SceneId } from "../../domain/ids.js";
import type { Referee, AwaitOutcome } from "../../engine/referee.js";

/**
 * A scripted DM tool-call flow — the new FakeAgent for the DM side (ADR-0009).
 * Instead of a fake agent returning scripted prose + control signals, we script
 * *which engine tool the model called this step*. The harness runs the steps in
 * order against the {@link Referee}'s tool handlers, deterministically.
 *
 * The DM is a self-driving loop in production, so a real `await_actors` that
 * holds simply blocks the loop. We model that faithfully: when `await_actors`
 * holds (a silent human), the flow stops — subsequent steps (e.g. a closing
 * `narrate`) are NOT executed, and the serializable pause is surfaced.
 */
export type DmStep =
  | { readonly tool: "narrate"; readonly sceneId: SceneId; readonly prose: string }
  | { readonly tool: "await_actors"; readonly sceneId: SceneId; readonly order: readonly ActorId[] };

export interface DmToolFlowResult {
  /** True iff an `await_actors` step held (the DM loop is blocked / paused). */
  readonly suspended: boolean;
  /** Every `await_actors` outcome, in the order the steps ran. */
  readonly awaits: readonly AwaitOutcome[];
  /** How many scripted steps actually executed before any suspension. */
  readonly executed: number;
}

export async function runDmToolFlow(
  referee: Referee,
  steps: readonly DmStep[],
): Promise<DmToolFlowResult> {
  const awaits: AwaitOutcome[] = [];
  let executed = 0;

  for (const step of steps) {
    executed += 1;
    if (step.tool === "narrate") {
      await referee.narrate(step.sceneId, step.prose);
      continue;
    }
    const outcome = await referee.awaitActors(step.sceneId, step.order);
    awaits.push(outcome);
    if (outcome.status === "held") {
      return { suspended: true, awaits, executed };
    }
  }

  return { suspended: false, awaits, executed };
}
