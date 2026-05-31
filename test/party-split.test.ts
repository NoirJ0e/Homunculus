import { describe, expect, test } from "vitest";
import { splitWorld, writeWorld, mergeWorld, WorldConflictError } from "../src/engine/world-branch.js";
import { actorId, sceneId } from "../src/domain/ids.js";
import { createSoul } from "../src/domain/soul.js";
import { remember } from "../src/engine/memory.js";
import { fork, merge as mergeSouls } from "../src/engine/canonicity.js";
import { FakeSoulStore } from "../src/adapters/memory/fake-soul-store.js";

describe("#10 party split — strictly isolated parallel branches", () => {
  test("a split forks parallel branches that advance independently", () => {
    const base = { gate: "closed" };
    const [a, b] = splitWorld(base, ["A", "B"]);
    writeWorld(a!, "cellarLooted", true);
    writeWorld(b!, "rooftopWatched", true);

    // Each branch only sees its own delta.
    expect(a!.delta.has("rooftopWatched")).toBe(false);
    expect(b!.delta.has("cellarLooted")).toBe(false);
  });

  test("merge is a deterministic union of disjoint deltas — no manual reconciliation", () => {
    const base = { gate: "closed" };
    const [a, b] = splitWorld(base, ["A", "B"]);
    writeWorld(a!, "cellarLooted", true);
    writeWorld(b!, "rooftopWatched", true);

    const merged = mergeWorld(base, [a!, b!]);
    expect(merged).toEqual({ gate: "closed", cellarLooted: true, rooftopWatched: true });
  });

  test("overlapping writes to shared world state are blocked at merge (strict isolation)", () => {
    const base = { boss: "alive" };
    const [a, b] = splitWorld(base, ["A", "B"]);
    writeWorld(a!, "boss", "dead-by-A");
    writeWorld(b!, "boss", "dead-by-B"); // both touched the same seam

    expect(() => mergeWorld(base, [a!, b!])).toThrow(WorldConflictError);
  });

  test("idempotent writes (same key, same value) are not a conflict", () => {
    const base = {};
    const [a, b] = splitWorld(base, ["A", "B"]);
    writeWorld(a!, "alarmRaised", true);
    writeWorld(b!, "alarmRaised", true); // same conclusion, no contradiction

    expect(mergeWorld(base, [a!, b!])).toEqual({ alarmRaised: true });
  });

  test("after the reunion world state unions, but each character's memory stays branch-local", async () => {
    const alice = actorId("soul:alice");
    const bob = actorId("soul:bob");
    const cellar = sceneId("scene:cellar");
    const roof = sceneId("scene:roof");
    const store = new FakeSoulStore();
    store.save(createSoul(alice, { name: "爱丽丝", temperament: "谨慎", goals: [] }));
    store.save(createSoul(bob, { name: "鲍勃", temperament: "莽撞", goals: [] }));

    // The party splits: Alice's group into the cellar, Bob's onto the roof.
    const groupA = await fork({ branchId: "A", soulIds: [alice], store });
    const groupB = await fork({ branchId: "B", soulIds: [bob], store });
    groupA.souls.set(alice, remember(groupA.souls.get(alice)!, { sceneId: cellar, summary: "地窖里的祭坛", tags: [] }));
    groupB.souls.set(bob, remember(groupB.souls.get(bob)!, { sceneId: roof, summary: "屋顶的狙击手", tags: [] }));

    // World state from both groups unions deterministically.
    const [wa, wb] = splitWorld({}, ["A", "B"]);
    writeWorld(wa!, "cellarAltarFound", true);
    writeWorld(wb!, "roofSniperSpotted", true);
    const world = mergeWorld({}, [wa!, wb!]);
    expect(world).toEqual({ cellarAltarFound: true, roofSniperSpotted: true });

    // Souls merge per-branch; memory does NOT cross over.
    await mergeSouls(groupA, { store });
    await mergeSouls(groupB, { store });
    expect(store.load(alice)!.episodic.map((m) => m.summary)).toEqual(["地窖里的祭坛"]);
    expect(store.load(bob)!.episodic.map((m) => m.summary)).toEqual(["屋顶的狙击手"]);
    // Alice never learns the roof events first-hand (only via in-fiction retelling).
    expect(store.load(alice)!.episodic.some((m) => m.summary.includes("屋顶"))).toBe(false);
  });
});
