import { describe, expect, test } from "vitest";
import { actorId } from "../src/domain/ids.js";
import { classifyBeat, type TurnOutcome } from "../src/engine/pacing.js";

const h1 = actorId("human-1");
const h2 = actorId("human-2");
const n1 = actorId("npc-1");

const outcomes = (entries: Array<[ReturnType<typeof actorId>, TurnOutcome]>) =>
  new Map(entries);

describe("pacing — barrier classification (ADR-0003 silence semantics)", () => {
  test("all awaited acted-or-passed → released", () => {
    expect(
      classifyBeat(outcomes([[h1, "acted"], [n1, "passed"]])),
    ).toBe("released");
  });

  test("everyone explicitly passing → released (wakes the AIDM)", () => {
    expect(
      classifyBeat(outcomes([[h1, "passed"], [n1, "passed"]])),
    ).toBe("released");
  });

  test("a single silent human holds the beat indefinitely", () => {
    expect(
      classifyBeat(outcomes([[h1, "acted"], [h2, "silent"], [n1, "passed"]])),
    ).toBe("held");
  });

  test("a human who explicitly passed does NOT hold (pass ≠ silence)", () => {
    expect(classifyBeat(outcomes([[h1, "passed"]]))).toBe("released");
  });
});
