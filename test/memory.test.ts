import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { createSoul } from "../src/domain/soul.js";
import { remember, recall } from "../src/engine/memory.js";

const id = actorId("soul:kael");
const cellar = sceneId("scene:cellar");
const market = sceneId("scene:market");

describe("#7 two-layer memory — recency + keyword recall (ADR-0004 v1)", () => {
  test("remember appends a scene-scoped episodic memory with a monotonic seq", () => {
    let soul = createSoul(id, { name: "凯尔", temperament: "高傲", goals: [] });
    soul = remember(soul, { sceneId: cellar, summary: "在地窖发现邪教符号", tags: ["邪教", "地窖"] });
    soul = remember(soul, { sceneId: market, summary: "在集市与商人争执", tags: ["集市"] });

    expect(soul.episodic.map((m) => m.seq)).toEqual([0, 1]);
    expect(soul.episodic[0]!.sceneId).toBe(cellar);
  });

  test("recall ranks by keyword overlap, then recency, and respects a limit", () => {
    let soul = createSoul(id, { name: "凯尔", temperament: "高傲", goals: [] });
    soul = remember(soul, { sceneId: cellar, summary: "邪教符号", tags: ["邪教"] });
    soul = remember(soul, { sceneId: market, summary: "买了绳子", tags: ["补给"] });
    soul = remember(soul, { sceneId: cellar, summary: "邪教祭坛", tags: ["邪教", "祭坛"] });

    const hits = recall(soul, { tags: ["邪教"], limit: 2 });
    // Both 邪教 memories match; the more recent one ranks first.
    expect(hits.map((m) => m.summary)).toEqual(["邪教祭坛", "邪教符号"]);
  });

  test("recall never returns memories from scenes the soul did not live through", () => {
    let soul = createSoul(id, { name: "凯尔", temperament: "高傲", goals: [] });
    soul = remember(soul, { sceneId: cellar, summary: "地窖往事", tags: ["x"] });

    const hits = recall(soul, { tags: ["x"], scenes: [market] }); // only market in scope
    expect(hits).toEqual([]);
  });
});
