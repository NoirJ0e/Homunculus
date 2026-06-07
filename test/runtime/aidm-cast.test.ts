import { describe, expect, test } from "vitest";
import { actorId, campaignId } from "../../src/domain/ids.js";
import type { ActorId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import type { Soul } from "../../src/domain/soul.js";
import type { SoulStore } from "../../src/ports/soul-store.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import type { RosterEntry } from "../../src/domain/card-lifecycle.js";
import type { NpcPort } from "../../src/ports/npc.js";
import { assembleAidmCast } from "../../src/runtime/aidm-cast.js";

/**
 * #37 — the AIDM cast assembled from BOUND teammates, replacing the inlined
 * `genesisFullAuto` bypass. #51 修共脑 Bug1 — the cast now builds ONE NpcPort PER
 * teammate (each its own persona / brain), resolved by actor via `npcFor`,
 * instead of a single shared `npcPersona`. This pins that assembly headless: each
 * bound AI soul gets its own port built from ITS OWN saved persona; with none the
 * cast degrades gracefully (flagged, npcFor → undefined for everyone).
 */

const human = actorId("player");
const zhou = actorId("npc-zhoushen");
const tie = actorId("npc-tiequan");
const camp = campaignId("camp-1");

function makeStores(roster: RosterEntry[], souls: Soul[]): {
  rosterStore: RosterStore;
  soulStore: SoulStore;
} {
  const soulMap = new Map(souls.map((s) => [s.id, s]));
  return {
    rosterStore: { get: () => roster, set: () => {}, markApproved: () => {} },
    soulStore: { load: (id) => soulMap.get(id), save: () => {} },
  };
}

/** A fake NpcPort factory that records each (soul, persona) it was asked to build
 *  and hands back a distinct tagged port — so tests can prove "绝不共脑". */
function makeFakeFactory() {
  const calls: { id: ActorId; persona: string }[] = [];
  const ports = new Map<string, NpcPort>();
  const makeNpc = ({ soul, persona }: { soul: Soul; persona: string }): NpcPort => {
    calls.push({ id: soul.id, persona });
    const port: NpcPort = { takeTurn: async () => ({ kind: "pass" }) };
    ports.set(soul.id, port);
    return port;
  };
  return { makeNpc, calls, ports };
}

describe("assembleAidmCast", () => {
  test("builds ONE NpcPort per bound teammate, each from ITS OWN saved persona (绝不共脑)", () => {
    const soulZhou = createSoul(zhou, {
      name: "周慎",
      temperament: "谨慎多疑",
      goals: ["查清古籍的来历"],
    });
    const soulTie = createSoul(tie, {
      name: "铁拳·冈",
      temperament: "鲁莽好斗",
      goals: ["证明自己的拳头"],
    });
    const { rosterStore, soulStore } = makeStores(
      [
        { actorId: zhou, kind: "ai", approved: true },
        { actorId: tie, kind: "ai", approved: true },
      ],
      [soulZhou, soulTie],
    );
    const factory = makeFakeFactory();

    const cast = assembleAidmCast({
      rosterStore,
      soulStore,
      campaign: camp,
      humanId: human,
      makeNpc: factory.makeNpc,
    });

    expect(cast.degraded).toBe(false);
    expect(cast.teammates.map((t) => t.id)).toEqual([zhou, tie]);

    // One port per teammate, and each is a DISTINCT object (no shared brain).
    const portZhou = cast.npcFor(zhou);
    const portTie = cast.npcFor(tie);
    expect(portZhou).toBe(factory.ports.get(zhou));
    expect(portTie).toBe(factory.ports.get(tie));
    expect(portZhou).not.toBe(portTie);
    // Non-teammates resolve to nothing.
    expect(cast.npcFor(human)).toBeUndefined();

    // Each port was built from its OWN soul's persona core.
    const zhouCall = factory.calls.find((c) => c.id === zhou)!;
    const tieCall = factory.calls.find((c) => c.id === tie)!;
    expect(zhouCall.persona).toContain("周慎");
    expect(zhouCall.persona).toContain("谨慎多疑");
    expect(tieCall.persona).toContain("铁拳·冈");
    expect(tieCall.persona).toContain("鲁莽好斗");

    // The cast still lists human + each teammate by saved name.
    expect(cast.personas.find((p) => p.actorId === zhou)?.username).toBe("周慎");
    expect(cast.personas.find((p) => p.actorId === tie)?.username).toBe("铁拳·冈");
    expect(cast.rosterKinds[zhou]).toBe("ai");
    expect(cast.rosterKinds[tie]).toBe("ai");
    expect(cast.rosterKinds[human]).toBe("human");
  });

  test("no bound teammate → degrades gracefully (flagged, npcFor → undefined for all)", () => {
    const { rosterStore, soulStore } = makeStores([], []);
    const factory = makeFakeFactory();

    const cast = assembleAidmCast({
      rosterStore,
      soulStore,
      campaign: camp,
      humanId: human,
      makeNpc: factory.makeNpc,
    });

    expect(cast.degraded).toBe(true);
    expect(cast.teammates).toEqual([]);
    expect(cast.npcFor(zhou)).toBeUndefined();
    expect(factory.calls).toEqual([]);
    expect(cast.personas.map((p) => p.actorId)).not.toContain(zhou);
    expect(cast.rosterKinds[human]).toBe("human");
  });
});
