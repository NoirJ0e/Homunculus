import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import {
  createSoul,
  serializeSoul,
  deserializeSoul,
  type Soul,
} from "../src/domain/soul.js";

const id = actorId("soul:kael");

describe("#7 persistent soul", () => {
  test("a fresh soul carries a resident persona core and empty episodic memory", () => {
    const soul = createSoul(id, {
      name: "凯尔",
      temperament: "高傲的贵公子",
      goals: ["证明自己配得上家族之名"],
    });
    expect(soul.personaCore.name).toBe("凯尔");
    expect(soul.personaCore.relationships).toEqual({});
    expect(soul.episodic).toEqual([]);
  });

  test("a soul round-trips through serialization (persist + reload across sessions)", () => {
    const soul = createSoul(id, { name: "凯尔", temperament: "高傲", goals: [] });
    const reloaded: Soul = deserializeSoul(serializeSoul(soul));
    expect(reloaded).toEqual(soul);
  });
});
