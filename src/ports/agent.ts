import type { AgentResponse, TurnContext } from "../domain/agent.js";

/**
 * Agent port — the seam behind which every non-deterministic narrator lives
 * (a real LLM in #3, scripted fakes in tests). The engine never knows which.
 */
export interface AgentPort {
  takeTurn(ctx: TurnContext): Promise<AgentResponse>;

  /**
   * Cheap two-stage wake-gate (ADR-0003): a small/cheap judgement of whether
   * this actor has anything to say *before* paying for full generation. When
   * omitted, the actor always speaks. AI-only — humans are never gated.
   */
  shouldSpeak?(ctx: TurnContext): Promise<boolean>;
}
