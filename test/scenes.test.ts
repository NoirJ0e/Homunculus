import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import type { Post } from "../src/domain/post.js";
import { SceneBook } from "../src/engine/scenes.js";

const A = sceneId("scene:A");
const B = sceneId("scene:B");
const alice = actorId("alice");
const bob = actorId("bob");

const post = (scene: ReturnType<typeof sceneId>, actor: ReturnType<typeof actorId>, prose: string): Post => ({
  sceneId: scene,
  actorId: actor,
  prose,
});

describe("SceneBook — visibility = scene membership (ADR-0005)", () => {
  test("an actor's horizon contains only the scenes it belongs to", () => {
    const book = new SceneBook();
    book.addMember(A, alice);
    book.addMember(B, bob);

    const pA = post(A, alice, "A 组：撬开了地窖。");
    const pB = post(B, bob, "B 组：在屋顶蹲守。");
    book.record(pA);
    book.record(pB);

    // The party is split: neither group sees the other's events.
    expect(book.horizon(alice)).toEqual([pA]);
    expect(book.horizon(bob)).toEqual([pB]);
  });

  test("horizon preserves global ordering across the actor's scenes", () => {
    const book = new SceneBook();
    book.addMember(A, alice);
    book.addMember(B, alice); // alice is in both

    const p1 = post(A, alice, "一");
    const p2 = post(B, alice, "二");
    const p3 = post(A, alice, "三");
    book.record(p1);
    book.record(p2);
    book.record(p3);

    expect(book.horizon(alice)).toEqual([p1, p2, p3]);
  });

  test("AIDM tool calls add/remove scene members; membership is maintained", () => {
    const book = new SceneBook();
    book.addMember(A, alice);
    expect(book.isMember(A, bob)).toBe(false);

    book.addMember(A, bob); // bob joins A (e.g. reunion)
    expect(book.isMember(A, bob)).toBe(true);
    expect([...book.membersOf(A)]).toContain(bob);

    book.removeMember(A, bob);
    expect(book.isMember(A, bob)).toBe(false);
  });
});
