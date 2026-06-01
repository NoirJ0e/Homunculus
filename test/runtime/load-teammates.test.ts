import { describe, expect, test } from "vitest";
import { actorId, campaignId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import type { Soul } from "../../src/domain/soul.js";
import type { SoulStore } from "../../src/ports/soul-store.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import type { RosterEntry } from "../../src/domain/card-lifecycle.js";
import { loadBoundTeammates } from "../../src/runtime/load-teammates.js";

/**
 * #37 — replace the AIDM-runner bypass. The runner no longer inlines
 * `genesisFullAuto` to fabricate a teammate at spin-up; it loads the campaign's
 * VERIFIED, BOUND AI teammates from the roster + SoulStore. This pins the load
 * seam headless: a roster of approved "ai" seats whose souls are saved in the
 * store is read back; humans/unapproved/missing-soul seats are excluded; an
 * empty result degrades gracefully (the runner flags it).
 */

function makeStores(opts: {
  roster: RosterEntry[];
  souls: Soul[];
}): { rosterStore: RosterStore; soulStore: SoulStore } {
  const soulMap = new Map(opts.souls.map((s) => [s.id, s]));
  return {
    rosterStore: { get: () => opts.roster, set: () => {}, markApproved: () => {} },
    soulStore: { load: (id) => soulMap.get(id), save: () => {} },
  };
}

const camp = campaignId("camp-1");

describe("loadBoundTeammates", () => {
  test("loads the souls of approved AI seats from the store (not genesis)", () => {
    const npc = actorId("npc-teammate");
    const soul = createSoul(npc, { name: "面具·昙", temperament: "擅长伪装" });
    const { rosterStore, soulStore } = makeStores({
      roster: [{ actorId: npc, kind: "ai", approved: true }],
      souls: [soul],
    });

    const teammates = loadBoundTeammates(rosterStore, soulStore, camp);

    expect(teammates).toHaveLength(1);
    expect(teammates[0]?.id).toBe("npc-teammate");
    // It is the SAVED persona read from the store, not a freshly genesis'd one.
    expect(teammates[0]?.personaCore.name).toBe("面具·昙");
  });

  test("excludes human seats, unapproved AI seats, and AI seats with no saved soul", () => {
    const human = actorId("player");
    const unapprovedAi = actorId("npc-pending");
    const approvedNoSoul = actorId("npc-orphan");
    const approvedAi = actorId("npc-good");
    const goodSoul = createSoul(approvedAi, { name: "铁拳·冈", temperament: "勇猛" });

    const { rosterStore, soulStore } = makeStores({
      roster: [
        { actorId: human, kind: "human", approved: true },
        { actorId: unapprovedAi, kind: "ai", approved: false },
        { actorId: approvedNoSoul, kind: "ai", approved: true },
        { actorId: approvedAi, kind: "ai", approved: true },
      ],
      souls: [goodSoul], // only the good seat has a saved soul
    });

    const teammates = loadBoundTeammates(rosterStore, soulStore, camp);

    expect(teammates.map((t) => t.id)).toEqual(["npc-good"]);
  });

  test("degrades gracefully to an empty list when the roster is absent", () => {
    const rosterStore: RosterStore = { get: () => undefined, set: () => {}, markApproved: () => {} };
    const soulStore: SoulStore = { load: () => undefined, save: () => {} };

    expect(loadBoundTeammates(rosterStore, soulStore, camp)).toEqual([]);
  });
});
