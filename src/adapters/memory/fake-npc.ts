import type { TurnContext } from "../../domain/agent.js";
import type { NpcPort, NpcTurn } from "../../ports/npc.js";

/**
 * Scripted in-memory NPC driver — the new FakeAgent for the NPC side (ADR-0009).
 * Each actor id maps to a queue of out-turns consumed in order. Captures every
 * TurnContext it was handed, so tests can assert what an NPC saw (后手看前手).
 */
export class FakeNpc implements NpcPort {
  private readonly scripts = new Map<string, NpcTurn[]>();
  private readonly gates: Record<string, boolean>;
  readonly seen: TurnContext[] = [];

  /**
   * @param scripts per-actor queue of out-turns, consumed in order.
   * @param gates   per-actor wake-gate verdict (`false` = filtered out). Absent
   *                → the actor always speaks.
   */
  constructor(scripts: Record<string, NpcTurn[]>, gates: Record<string, boolean> = {}) {
    for (const [id, turns] of Object.entries(scripts)) this.scripts.set(id, [...turns]);
    this.gates = gates;
  }

  async shouldSpeak(ctx: TurnContext): Promise<boolean> {
    return this.gates[ctx.actorId] ?? true;
  }

  async takeTurn(ctx: TurnContext): Promise<NpcTurn> {
    this.seen.push(ctx);
    const queue = this.scripts.get(ctx.actorId);
    if (!queue || queue.length === 0) {
      throw new Error(`FakeNpc: no scripted turn left for actor "${ctx.actorId}"`);
    }
    return queue.shift()!;
  }
}
