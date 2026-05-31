import type { TurnContext } from "../domain/agent.js";

/**
 * What an NPC contributes when the engine pulls it up for its slot (ADR-0009).
 * NPCs are pure-narrative (ADR-0002): they `speak` or `pass`, or emit a `roll`
 * to resolve a check the AIDM called on them (#18). They never narrate or write
 * authoritative state — that has no representation here, by construction.
 */
export type NpcTurn =
  | { readonly kind: "speak"; readonly prose: string }
  | { readonly kind: "pass" }
  | { readonly kind: "roll" };

/**
 * NPC port — the seam behind which each NPC agent lives (a real per-soul Agent
 * SDK single call in production; a scripted fake in tests). Unlike the DM, an
 * NPC is NOT a self-driving loop: the engine pulls it up once per slot, paced
 * by the simplified combat round (ADR-0009).
 */
export interface NpcPort {
  /**
   * Cheap two-stage wake-gate (ADR-0003): does this NPC have anything to say
   * *before* paying for full generation? Omit → it always speaks. AI-only —
   * a gated NPC is a decision (≈ pass), never the "silence" that holds a beat.
   */
  shouldSpeak?(ctx: TurnContext): Promise<boolean>;

  /** The NPC's single out-turn for this slot. */
  takeTurn(ctx: TurnContext): Promise<NpcTurn>;
}
