import { describe, expect, test } from "vitest";
import { actorId } from "../../src/domain/ids.js";
import { assignNpcsToBots } from "../../src/runtime/npc-bot-assignment.js";

/**
 * #56 — persona → pool-bot assignment (pure). Each NPC teammate is bound to one
 * pool bot (in roster order); when the pool is smaller than the cast the extra
 * NPCs overflow (they fall back to the webhook persona — 池满时 NPC 数受池容量约束).
 */

const a = actorId("npc-a");
const b = actorId("npc-b");
const c = actorId("npc-c");

describe("assignNpcsToBots", () => {
  test("assigns each NPC its own bot index in order when the pool is big enough", () => {
    const { assignments, overflow } = assignNpcsToBots([a, b], 3);
    expect(assignments.get(a)).toBe(0);
    expect(assignments.get(b)).toBe(1);
    expect(overflow).toEqual([]);
  });

  test("caps at pool size: the extra NPCs overflow (no bot)", () => {
    const { assignments, overflow } = assignNpcsToBots([a, b, c], 2);
    expect(assignments.get(a)).toBe(0);
    expect(assignments.get(b)).toBe(1);
    expect(assignments.has(c)).toBe(false);
    expect(overflow).toEqual([c]);
  });

  test("empty pool → every NPC overflows", () => {
    const { assignments, overflow } = assignNpcsToBots([a, b], 0);
    expect(assignments.size).toBe(0);
    expect(overflow).toEqual([a, b]);
  });
});
