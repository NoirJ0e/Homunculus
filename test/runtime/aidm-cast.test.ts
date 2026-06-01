import { describe, expect, test } from "vitest";
import { actorId, campaignId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import type { Soul } from "../../src/domain/soul.js";
import type { SoulStore } from "../../src/ports/soul-store.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import type { RosterEntry } from "../../src/domain/card-lifecycle.js";
import { assembleAidmCast } from "../../src/runtime/aidm-cast.js";

/**
 * #37 — the AIDM cast assembled from BOUND teammates, replacing the inlined
 * `genesisFullAuto` bypass. `runAidmQuery` reads the campaign's verified AI
 * teammate souls from the roster + SoulStore and builds the NPC persona from the
 * SAVED soul (not from genesis). This pins that assembly headless: with a bound
 * AI soul in the store the cast carries that persona; with none it degrades
 * gracefully (flagged, no NPC).
 */

const human = actorId("player");
const npc = actorId("npc-teammate");
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

describe("assembleAidmCast", () => {
  test("reads the bound teammate soul from the store and uses ITS persona (not genesis)", () => {
    const soul = createSoul(npc, {
      name: "面具·昙",
      temperament: "擅长伪装",
      goals: ["找到一个不需要伪装的地方"],
    });
    const { rosterStore, soulStore } = makeStores(
      [{ actorId: npc, kind: "ai", approved: true }],
      [soul],
    );

    const cast = assembleAidmCast({ rosterStore, soulStore, campaign: camp, humanId: human });

    expect(cast.degraded).toBe(false);
    expect(cast.teammates.map((t) => t.id)).toEqual(["npc-teammate"]);
    // The NPC persona is built from the SAVED soul's persona core.
    expect(cast.npcPersona).toContain("面具·昙");
    expect(cast.npcPersona).toContain("擅长伪装");
    expect(cast.npcPersona).toContain("找到一个不需要伪装的地方");
    // The cast lists the human + the bound teammate (by its saved name).
    expect(cast.personas.map((p) => p.actorId)).toContain(npc);
    expect(cast.personas.find((p) => p.actorId === npc)?.username).toBe("面具·昙");
    // Roster kinds mark the teammate as ai and the human as human.
    expect(cast.rosterKinds[npc]).toBe("ai");
    expect(cast.rosterKinds[human]).toBe("human");
  });

  test("no bound teammate → degrades gracefully (flagged, no NPC, no roster ai seat)", () => {
    const { rosterStore, soulStore } = makeStores([], []);

    const cast = assembleAidmCast({ rosterStore, soulStore, campaign: camp, humanId: human });

    expect(cast.degraded).toBe(true);
    expect(cast.teammates).toEqual([]);
    expect(cast.npcPersona).toBeUndefined();
    expect(cast.personas.map((p) => p.actorId)).not.toContain(npc);
    expect(cast.rosterKinds[human]).toBe("human");
  });
});
