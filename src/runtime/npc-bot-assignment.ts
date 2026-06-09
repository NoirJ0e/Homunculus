import type { ActorId } from "../domain/ids.js";

/**
 * npc-bot-assignment.ts — pure NPC→pool-bot assignment (#56).
 *
 * Each AI teammate becomes its own @-mentionable bot identity. The pool may be
 * smaller than the cast, so this binds the first `poolSize` NPCs (in roster
 * order) to bot indices 0..poolSize-1 and reports the rest as `overflow` — those
 * fall back to the shared webhook persona (池满时 NPC 数受池容量约束). Pure +
 * unit-tested; the live login/nickname wiring consumes this mapping.
 */
export interface NpcBotAssignment {
  /** NPC actor id → pool bot index (0-based). Only the bound NPCs appear. */
  readonly assignments: ReadonlyMap<ActorId, number>;
  /** NPCs with no bot left in the pool — webhook-persona fallback. */
  readonly overflow: readonly ActorId[];
}

export function assignNpcsToBots(
  npcActorIds: readonly ActorId[],
  poolSize: number,
): NpcBotAssignment {
  const assignments = new Map<ActorId, number>();
  const overflow: ActorId[] = [];
  npcActorIds.forEach((actor, i) => {
    if (i < poolSize) assignments.set(actor, i);
    else overflow.push(actor);
  });
  return { assignments, overflow };
}
