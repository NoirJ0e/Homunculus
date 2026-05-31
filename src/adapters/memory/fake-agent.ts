import type { AgentResponse, TurnContext } from "../../domain/agent.js";
import type { AgentPort } from "../../ports/agent.js";

/**
 * Scripted in-memory agent. Each actor id maps to a queue of responses consumed
 * in order — so the AIDM, asked twice in a beat, gets its two scripted lines.
 * Captures every TurnContext it was handed, for asserting on what an actor saw.
 */
export class FakeAgent implements AgentPort {
  private readonly scripts = new Map<string, AgentResponse[]>();
  private readonly gates: Record<string, boolean>;
  readonly seen: TurnContext[] = [];

  /**
   * @param scripts per-actor queue of responses, consumed in order.
   * @param gates   per-actor wake-gate verdict (`false` = filtered out). When
   *                an actor is absent here it always speaks.
   */
  constructor(scripts: Record<string, AgentResponse[]>, gates: Record<string, boolean> = {}) {
    for (const [id, responses] of Object.entries(scripts)) {
      this.scripts.set(id, [...responses]);
    }
    this.gates = gates;
  }

  async takeTurn(ctx: TurnContext): Promise<AgentResponse> {
    this.seen.push(ctx);
    const queue = this.scripts.get(ctx.actorId);
    if (!queue || queue.length === 0) {
      throw new Error(`FakeAgent: no scripted response left for actor "${ctx.actorId}"`);
    }
    return queue.shift()!;
  }

  async shouldSpeak(ctx: TurnContext): Promise<boolean> {
    return this.gates[ctx.actorId] ?? true;
  }
}
