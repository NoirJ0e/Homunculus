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

/**
 * Bind teammates to pool bots and hand back the actor→bot map the substrate's
 * `botFor` consults (arch-C1: the same recipe was reinlined in the runner and
 * every live script). Generic over the bot type so this stays pure; `onBind`
 * is where the live caller hangs the best-effort nickname write.
 */
export function npcBotBindings<B>(
  teammates: ReadonlyArray<{ readonly id: ActorId; readonly name: string }>,
  pool: readonly B[],
  onBind?: (bot: B, name: string) => void,
): Map<ActorId, B> {
  const { assignments } = assignNpcsToBots(
    teammates.map((t) => t.id),
    pool.length,
  );
  const byActor = new Map<ActorId, B>();
  for (const t of teammates) {
    const idx = assignments.get(t.id);
    if (idx === undefined) continue;
    const bot = pool[idx]!;
    byActor.set(t.id, bot);
    onBind?.(bot, t.name);
  }
  return byActor;
}
