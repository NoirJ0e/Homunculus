import type { AgentResponse, TurnContext } from "../domain/agent.js";

/**
 * Agent port — the seam behind which every non-deterministic narrator lives
 * (a real LLM in #3, scripted fakes in tests). The engine never knows which.
 */
export interface AgentPort {
  takeTurn(ctx: TurnContext): Promise<AgentResponse>;
}
