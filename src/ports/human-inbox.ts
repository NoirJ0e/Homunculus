import type { ActorId, SceneId } from "../domain/ids.js";

/**
 * What a human contributed in a beat. Crucially, *absence* (the port returning
 * `undefined`) is NOT one of these — silence is distinct from an explicit pass
 * (ADR-0003) and is signalled by the port yielding nothing.
 */
export type HumanTurn =
  | { readonly kind: "prose"; readonly prose: string }
  | { readonly kind: "pass" }
  // The human pulls the trigger on their pending check via `/check` (ADR-0013):
  // the slash command injects this turn; `advantage` is the HOW the human declares
  // (the AIDM declared the WHAT via `call_check`). Absent = a straight roll.
  | { readonly kind: "roll"; readonly advantage?: "advantage" | "disadvantage" };

/**
 * Human inbox port — the inbound side of the substrate. The engine polls it for
 * an awaited human's turn; `undefined` means the human is silent (→ infinite
 * hold). A real Discord adapter backs this in #4; tests use a scripted fake.
 */
export interface HumanInboxPort {
  poll(actor: ActorId, sceneId: SceneId): Promise<HumanTurn | undefined>;
}
