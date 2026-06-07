import { describe, expect, test } from "vitest";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { createCommandRouter } from "../../src/adapters/discord/command-router.js";
import { createCommandSet } from "../../src/adapters/discord/command-set.js";
import { actorId, campaignId, type CampaignId } from "../../src/domain/ids.js";
import type { RosterEntry } from "../../src/domain/card-lifecycle.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import type { CampaignMeta, CampaignMetaStore } from "../../src/ports/campaign-meta-store.js";
import { createCampaignAuthority } from "../../src/adapters/discord/campaign-authority.js";
import { createSetRosterHandler } from "../../src/adapters/discord/set-roster-handler.js";
import { createStartGameHandler } from "../../src/adapters/discord/start-game-handler.js";

/**
 * #33 — the open-gate slice end-to-end through #31's router with the REAL
 * authority (stored owner + roster). Proves the owner-only permission gate:
 * a non-owner `/set-roster` or `/start-game` is denied and the handler's
 * side-effect never runs; and the owner can declare a roster then start once
 * everyone is approved.
 */

class InMemoryRosterStore implements RosterStore {
  readonly rosters = new Map<string, readonly RosterEntry[]>();
  get(c: CampaignId) {
    return this.rosters.get(c);
  }
  set(c: CampaignId, roster: readonly RosterEntry[]) {
    this.rosters.set(c, roster);
  }
  markApproved(c: CampaignId, actor: ReturnType<typeof actorId>) {
    const r = this.rosters.get(c);
    if (r === undefined) return;
    this.rosters.set(
      c,
      r.map((e) => (e.actorId === actor ? { ...e, approved: true } : e)),
    );
  }
}

class InMemoryMetaStore implements CampaignMetaStore {
  readonly metas = new Map<string, CampaignMeta>();
  get(c: CampaignId) {
    return this.metas.get(c);
  }
  set(c: CampaignId, meta: CampaignMeta) {
    this.metas.set(c, meta);
  }
}

const event = (over: Partial<CommandEvent>): CommandEvent => ({
  name: "set-roster",
  invokerId: "owner-1",
  channelId: "chan-main",
  options: {},
  ...over,
});

function makeRouter() {
  const rosterStore = new InMemoryRosterStore();
  const metaStore = new InMemoryMetaStore();
  // Seed an owner so the gate has someone to recognise (in production the first
  // /set-roster records it; here we seed to test the gate independently).
  metaStore.set(campaignId("mine-01"), { ownerId: "owner-1" });
  const spawns: string[] = [];
  const replies: string[] = [];

  const resolveCampaign = () => campaignId("mine-01");
  const authority = createCampaignAuthority({ metaStore, rosterStore, resolveCampaign });

  const set = createCommandSet({
    createCharacterCard: async () => {},
    verifyCard: async () => {},
    approve: async () => {},
    setRoster: createSetRosterHandler({
      rosterStore,
      metaStore,
      resolveCampaign,
      resolveActor: (id) => actorId(`actor-${id}`),
      reply: async (t) => void replies.push(t),
    }),
    startGame: createStartGameHandler({
      rosterStore,
      resolveCampaign,
      spawnAidm: (c) => void spawns.push(c),
      reply: async (t) => void replies.push(t),
    }),
    addAiSeat: async () => {},
    check: async () => {},
    roll: async () => {},
    pause: async () => {},
  });

  const router = createCommandRouter(set, authority);
  return { router, rosterStore, metaStore, spawns, replies };
}

describe("#33 open-gate end-to-end (router + real authority)", () => {
  test("once an owner is claimed, a non-owner /set-roster writes no roster (handler self-guards)", async () => {
    const h = makeRouter(); // seeds ownerId = "owner-1"
    const result = await h.router.dispatch(
      event({ name: "set-roster", invokerId: "imposter", options: { player1: "user-a", player2: "user-b" } }),
    );

    // set-roster is scope "any" (bootstrap), so the router dispatches it; the
    // handler then self-guards — owner already claimed and ≠ invoker → no roster
    // written, imposter told off. Same security invariant, enforced one layer in.
    expect(result.kind).toBe("dispatched");
    expect(h.rosterStore.get(campaignId("mine-01"))).toBeUndefined();
    expect(h.replies.at(-1)).toContain("owner");
  });

  test("non-owner /start-game is denied and spawns nothing", async () => {
    const h = makeRouter();
    h.rosterStore.set(campaignId("mine-01"), [
      { actorId: actorId("a"), discordUserId: "user-a", kind: "human", approved: true },
    ]);

    const result = await h.router.dispatch(event({ name: "start-game", invokerId: "imposter" }));

    expect(result).toEqual({ kind: "denied", name: "start-game", scope: "owner" });
    expect(h.spawns).toHaveLength(0);
  });

  test("owner declares roster, then /start-game spawns once all approved", async () => {
    const h = makeRouter();

    await h.router.dispatch(
      event({ name: "set-roster", invokerId: "owner-1", options: { player1: "user-a", player2: "user-b" } }),
    );
    const declared = h.rosterStore.get(campaignId("mine-01"));
    // owner-1 is auto-included alongside the two @'d players.
    expect(declared).toHaveLength(3);
    expect(declared?.every((e) => !e.approved)).toBe(true);

    // Not all approved yet → start-game denied? No: owner IS permitted; the
    // handler guard rejects with a reply and does not spawn.
    const blocked = await h.router.dispatch(event({ name: "start-game", invokerId: "owner-1" }));
    expect(blocked.kind).toBe("dispatched");
    expect(h.spawns).toHaveLength(0);

    // Approve ALL three (incl. the auto-included owner), then start succeeds.
    h.rosterStore.markApproved(campaignId("mine-01"), actorId("actor-owner-1"));
    h.rosterStore.markApproved(campaignId("mine-01"), actorId("actor-user-a"));
    h.rosterStore.markApproved(campaignId("mine-01"), actorId("actor-user-b"));
    await h.router.dispatch(event({ name: "start-game", invokerId: "owner-1", channelId: "chan-main" }));
    expect(h.spawns).toEqual(["chan-main"]);
  });
});
