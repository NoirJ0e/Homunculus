import type { ActorId, SceneId } from "./ids.js";

/**
 * 灵魂 (soul) — a persistent character entity (ADR-0004): growth + autobiographical
 * memory + persona core. Persists across tables, independent of who controls it
 * (ADR-0006). Growth (the SealDice sheet) lives in SealDice; this module owns the
 * persona core and the episodic memory.
 */

/**
 * 人格核心 (persona core) — the structured identity that is ALWAYS resident in the
 * agent's context to prevent amnesia / OOC. Structured (JSON) so it can be
 * reviewed and diffed at merge time (#9).
 */
export interface PersonaCore {
  readonly name: string;
  /** Character nucleus — slow to change; inertia guards it (#9). */
  readonly temperament: string;
  readonly goals: readonly string[];
  /** Relationship ledger: other actor id → current stance. */
  readonly relationships: Readonly<Record<string, string>>;
  /** A short running summary of plot progress, kept resident. */
  readonly plotSummary: string;
}

/**
 * An episodic memory: one recallable autobiographical event, scoped to the scene
 * it happened in (ADR-0005 horizon) so recall never leaks scenes the soul did not
 * live through, and so memory is naturally branch-isolated.
 */
export interface EpisodicMemory {
  readonly sceneId: SceneId;
  /** Monotonic ordinal — higher is more recent (recency recall, ADR-0004). */
  readonly seq: number;
  readonly summary: string;
  /** Keywords for keyword recall (ADR-0004 v1 strategy). */
  readonly tags: readonly string[];
}

export interface Soul {
  readonly id: ActorId;
  readonly personaCore: PersonaCore;
  readonly episodic: readonly EpisodicMemory[];
}

export interface PersonaSeed {
  readonly name: string;
  readonly temperament: string;
  readonly goals?: readonly string[];
  readonly relationships?: Readonly<Record<string, string>>;
  readonly plotSummary?: string;
}

export function createSoul(id: ActorId, seed: PersonaSeed): Soul {
  return {
    id,
    personaCore: {
      name: seed.name,
      temperament: seed.temperament,
      goals: seed.goals ?? [],
      relationships: seed.relationships ?? {},
      plotSummary: seed.plotSummary ?? "",
    },
    episodic: [],
  };
}

/** Stable, evolvable persistence (ADR-0004): plain JSON. */
export function serializeSoul(soul: Soul): string {
  return JSON.stringify(soul);
}

export function deserializeSoul(json: string): Soul {
  return JSON.parse(json) as Soul;
}
