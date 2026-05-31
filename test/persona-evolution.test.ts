import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { createSoul } from "../src/domain/soul.js";
import { remember } from "../src/engine/memory.js";
import { reflect, applyChangelog, type PersonaChangeProposal } from "../src/engine/reflection.js";

const id = actorId("soul:kael");
const battle = sceneId("scene:battle");

function kaelWith(n: number) {
  let soul = createSoul(id, { name: "凯尔", temperament: "高傲的贵公子", goals: [] });
  for (let i = 0; i < n; i++) {
    soul = remember(soul, { sceneId: battle, summary: `并肩生死第${i}次`, tags: ["战友"] });
  }
  return soul;
}

describe("#9 persona evolution — reflection with guardrails", () => {
  test("a change citing no (or an invalid) event is rejected — evidence required", () => {
    const soul = kaelWith(1);
    const proposals: PersonaChangeProposal[] = [
      { kind: "relationship", subject: "soul:pc", to: "信任", citedEvents: [] }, // no evidence
      { kind: "relationship", subject: "soul:pc", to: "信任", citedEvents: [99] }, // bad citation
    ];
    const r = reflect(soul, proposals);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["no-evidence", "bad-citation"]);
  });

  test("core temperament has inertia: a single event can't flip it, several can", () => {
    const onceProposal: PersonaChangeProposal = { kind: "temperament", to: "重情义", citedEvents: [0] };
    expect(reflect(kaelWith(1), [onceProposal]).rejected[0]?.reason).toBe("insufficient-inertia");

    const manyProposal: PersonaChangeProposal = { kind: "temperament", to: "重情义", citedEvents: [0, 1] };
    expect(reflect(kaelWith(2), [manyProposal]).accepted).toHaveLength(1);
  });

  test("a relationship update is accepted from a single cited event", () => {
    const r = reflect(kaelWith(1), [{ kind: "relationship", subject: "soul:pc", to: "亏欠", citedEvents: [0] }]);
    expect(r.accepted).toHaveLength(1);
  });

  test("at merge the owner can veto individual persona changes", () => {
    const soul = kaelWith(2);
    const { accepted } = reflect(soul, [
      { kind: "relationship", subject: "soul:pc", to: "亏欠", citedEvents: [0] },
      { kind: "temperament", to: "重情义", citedEvents: [0, 1] },
    ]);
    // Veto the temperament change (index 1); keep the relationship one.
    const core = applyChangelog(soul.personaCore, accepted, { veto: [1] });
    expect(core.relationships["soul:pc"]).toBe("亏欠");
    expect(core.temperament).toBe("高傲的贵公子"); // unchanged — vetoed
  });

  test("the let-go switch accepts every change automatically", () => {
    const soul = kaelWith(2);
    const { accepted } = reflect(soul, [
      { kind: "relationship", subject: "soul:pc", to: "亏欠", citedEvents: [0] },
      { kind: "temperament", to: "重情义", citedEvents: [0, 1] },
    ]);
    const core = applyChangelog(soul.personaCore, accepted, { letGo: true });
    expect(core.temperament).toBe("重情义");
    expect(core.relationships["soul:pc"]).toBe("亏欠");
  });
});
