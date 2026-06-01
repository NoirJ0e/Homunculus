import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import type { Post } from "../src/domain/post.js";
import {
  runCombatRound,
  type ProduceSlot,
} from "../src/engine/combat-round.js";

const scn = sceneId("scene-1");
const aidm = actorId("aidm");
const a = actorId("a");
const b = actorId("b");
const c = actorId("c");

const post = (actor: ReturnType<typeof actorId>, prose: string): Post => ({
  sceneId: scn,
  actorId: actor,
  prose,
});

describe("combat-round — 后手看前手 (later actors see earlier posts this round)", () => {
  test("a later actor receives an earlier actor's just-made post", async () => {
    const seenBy = new Map<string, readonly Post[]>();
    const produce: ProduceSlot = (actor, seenThisRound) => {
      seenBy.set(actor, seenThisRound);
      return { kind: "acted", post: post(actor, `${actor} acts`) };
    };

    await runCombatRound(scn, aidm, [a, b], produce);

    // a is first, sees nothing; b sees a's just-made post.
    expect(seenBy.get(a)).toEqual([]);
    expect(seenBy.get(b)).toEqual([post(a, "a acts")]);
  });
});

describe("combat-round — acted accumulates posts in order", () => {
  test("each acted slot's post is appended to result.posts", async () => {
    const produce: ProduceSlot = (actor) => ({
      kind: "acted",
      post: post(actor, `${actor} acts`),
    });

    const result = await runCombatRound(scn, aidm, [a, b, c], produce);

    expect(result.posts).toEqual([
      post(a, "a acts"),
      post(b, "b acts"),
      post(c, "c acts"),
    ]);
  });
});

describe("combat-round — released when no silence", () => {
  test("all acted → released, no pause, outcomes recorded", async () => {
    const produce: ProduceSlot = (actor) => ({
      kind: "acted",
      post: post(actor, `${actor} acts`),
    });

    const result = await runCombatRound(scn, aidm, [a, b], produce);

    expect(result.status).toBe("released");
    expect(result.pause).toBeUndefined();
    expect(result.outcomes.get(a)).toBe("acted");
    expect(result.outcomes.get(b)).toBe("acted");
  });

  test("explicit pass also releases (pass ≠ silence)", async () => {
    const produce: ProduceSlot = (actor) =>
      actor === a
        ? { kind: "acted", post: post(actor, "a acts") }
        : { kind: "passed" };

    const result = await runCombatRound(scn, aidm, [a, b], produce);

    expect(result.status).toBe("released");
    expect(result.pause).toBeUndefined();
    expect(result.outcomes.get(b)).toBe("passed");
  });
});

describe("combat-round — silence holds the beat (ADR-0003)", () => {
  test("effect retention: earlier posts survive a later silence (no rollback)", async () => {
    const produce: ProduceSlot = (actor) =>
      actor === a
        ? { kind: "acted", post: post(actor, "a acts") }
        : { kind: "silent" };

    const result = await runCombatRound(scn, aidm, [a, b], produce);

    expect(result.posts).toEqual([post(a, "a acts")]);
  });

  test("any silent slot → held, with a serializable PauseState", async () => {
    const produce: ProduceSlot = (actor) => {
      if (actor === a) return { kind: "acted", post: post(actor, "a acts") };
      if (actor === b) return { kind: "passed" };
      return { kind: "silent" }; // c
    };

    const result = await runCombatRound(scn, aidm, [a, b, c], produce);

    expect(result.status).toBe("held");
    expect(result.pause).toBeDefined();
    expect(result.pause?.waitingOn).toEqual([c]);
    expect(result.pause?.acted).toEqual([a, b]);
    expect(result.pause?.awaiting).toEqual([a, b, c]);
    // JSON-round-trippable pause/save state.
    const roundTripped = JSON.parse(JSON.stringify(result.pause));
    expect(roundTripped).toEqual(result.pause);
  });

  test("溢出一轮: a silent actor does NOT stop later actors' slots", async () => {
    const got: string[] = [];
    const produce: ProduceSlot = (actor) => {
      got.push(actor);
      if (actor === b) return { kind: "silent" };
      return { kind: "acted", post: post(actor, `${actor} acts`) };
    };

    const result = await runCombatRound(scn, aidm, [a, b, c], produce);

    // every actor in order got their slot, even after b went silent.
    expect(got).toEqual([a, b, c]);
    expect(result.outcomes.get(c)).toBe("acted");
    // and the round only holds AFTER running to completion.
    expect(result.status).toBe("held");
  });
});
