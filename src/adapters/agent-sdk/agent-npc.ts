import type { TurnContext } from "../../domain/agent.js";
import type { NpcPort, NpcTurn } from "../../ports/npc.js";
import { buildNpcPrompt } from "./npc-prompt.js";

/**
 * AgentNpc — the production NpcPort (ADR-0009/0010). When the engine pulls this
 * NPC up in a combat round, it runs one LLM turn and speaks.
 *
 * `generate` is the DI seam: production passes a thunk that runs a single
 * Agent-SDK `query()` and returns its text; tests pass a stub. v1 keeps it to
 * speak/pass only — `roll` arrives with dice, and the wake-gate (`shouldSpeak`)
 * is deferred (always speaks), per ADR-0010's first-slice scope.
 */
export interface AgentNpcDeps {
  /** The NPC's resident persona core. */
  readonly persona: string;
  /** Run one NPC turn from a prompt, returning its prose (empty = nothing to add). */
  readonly generate: (prompt: string) => Promise<string>;
}

export class AgentNpc implements NpcPort {
  constructor(private readonly deps: AgentNpcDeps) {}

  async shouldSpeak(_ctx: TurnContext): Promise<boolean> {
    return true; // wake-gate deferred (ADR-0010)
  }

  async takeTurn(ctx: TurnContext): Promise<NpcTurn> {
    const prompt = buildNpcPrompt({ persona: this.deps.persona, transcript: ctx.transcript });
    const prose = (await this.deps.generate(prompt)).trim();
    if (prose.length === 0) return { kind: "pass" };
    return { kind: "speak", prose };
  }
}
