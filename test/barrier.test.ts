import { describe, expect, test } from "vitest";
import { actorId } from "../src/domain/ids.js";
import { openBarrier, recordAction, isReleased } from "../src/engine/barrier.js";

describe("barrier", () => {
  const a = actorId("npc-a");
  const c = actorId("npc-b");

  test("an opened barrier awaiting two actors is not released until both have acted", () => {
    let b = openBarrier([a, c]);
    expect(isReleased(b)).toBe(false);

    b = recordAction(b, a);
    expect(isReleased(b)).toBe(false);

    b = recordAction(b, c);
    expect(isReleased(b)).toBe(true);
  });

  test("a barrier awaiting nobody is released immediately", () => {
    const b = openBarrier([]);
    expect(isReleased(b)).toBe(true);
  });
});
