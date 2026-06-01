import type { SceneId } from "../domain/ids.js";
import type { Soul, EpisodicMemory } from "../domain/soul.js";

/**
 * Two-layer memory recall (ADR-0004). The resident persona core is always in
 * context; this module handles the *episodic* layer: writing scene-scoped
 * memories and recalling the relevant few.
 *
 * v1 strategy (ADR-0008): recency + keyword overlap, no vector store. The
 * `recall` signature is the swap point — a future embedding-backed recall keeps
 * the same query/return shape, so nothing downstream changes.
 */

export interface MemoryWrite {
  readonly sceneId: SceneId;
  readonly summary: string;
  readonly tags?: readonly string[];
}

export interface RecallQuery {
  /** Keywords to match against memory tags. */
  readonly tags?: readonly string[];
  /** Restrict to these scenes (the actor's current horizon, ADR-0005). When
   *  omitted, all of the soul's own memories are in scope. */
  readonly scenes?: readonly SceneId[];
  readonly limit?: number;
}

/** Append a scene-scoped episodic memory with the next monotonic seq. */
export function remember(soul: Soul, write: MemoryWrite): Soul {
  const memory: EpisodicMemory = {
    sceneId: write.sceneId,
    seq: soul.episodic.length,
    summary: write.summary,
    tags: write.tags ?? [],
  };
  return { ...soul, episodic: [...soul.episodic, memory] };
}

/**
 * Recall the most relevant memories: keyword overlap first, recency as the
 * tiebreaker. Memories outside the query's scene scope are never returned, so a
 * soul can't recall scenes it didn't live through (anti-metagaming for free).
 */
export function recall(soul: Soul, query: RecallQuery): EpisodicMemory[] {
  const scopeSet = query.scenes ? new Set(query.scenes) : null;
  const queryTags = new Set(query.tags ?? []);

  const inScope = soul.episodic.filter((m) => !scopeSet || scopeSet.has(m.sceneId));

  const scored = inScope.map((m) => ({
    m,
    overlap: m.tags.reduce((n, t) => (queryTags.has(t) ? n + 1 : n), 0),
  }));

  return scored
    .filter((s) => queryTags.size === 0 || s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.m.seq - a.m.seq)
    .slice(0, query.limit ?? Infinity)
    .map((s) => s.m);
}
