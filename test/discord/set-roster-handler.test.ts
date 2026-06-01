import { describe, expect, test } from "vitest";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { actorId, campaignId, type CampaignId } from "../../src/domain/ids.js";
import type { RosterEntry } from "../../src/domain/card-lifecycle.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import type { CampaignMeta, CampaignMetaStore } from "../../src/ports/campaign-meta-store.js";
import { createSetRosterHandler } from "../../src/adapters/discord/set-roster-handler.js";

/**
 * #33 — the `/set-roster` handler (owner-scoped; the router's permission gate
 * enforces owner). The owner declares the explicit party (@'d players) → the
 * handler writes a roster entry per player (kind "human", approved:false) via
 * the RosterStore, and persists the campaign OWNER (the invoker) so the real
 * `isOwner` authority predicate has a stored owner to check.
 */

class InMemoryRosterStore implements RosterStore {
  readonly rosters = new Map<string, readonly RosterEntry[]>();
  get(c: CampaignId): readonly RosterEntry[] | undefined {
    return this.rosters.get(c);
  }
  set(c: CampaignId, roster: readonly RosterEntry[]): void {
    this.rosters.set(c, roster);
  }
  markApproved(c: CampaignId, actor: ReturnType<typeof actorId>): void {
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
  get(c: CampaignId): CampaignMeta | undefined {
    return this.metas.get(c);
  }
  set(c: CampaignId, meta: CampaignMeta): void {
    this.metas.set(c, meta);
  }
}

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "set-roster",
  invokerId: "owner-1",
  channelId: "chan-main",
  options: { players: "user-alice user-bob" },
  ...over,
});

function makeHandler() {
  const roster = new InMemoryRosterStore();
  const meta = new InMemoryMetaStore();
  const replies: string[] = [];
  const handler = createSetRosterHandler({
    rosterStore: roster,
    metaStore: meta,
    resolveCampaign: () => campaignId("mine-01"),
    resolveActor: (discordUserId) => actorId(`actor-${discordUserId}`),
    reply: async (text) => {
      replies.push(text);
    },
  });
  return { roster, meta, replies, handler };
}

describe("setRoster handler", () => {
  test("writes one unapproved human entry per @'d player", async () => {
    const h = makeHandler();
    await h.handler(event());

    const entries = h.roster.get(campaignId("mine-01"));
    expect(entries).toBeDefined();
    expect(entries).toHaveLength(2);
    expect(entries?.map((e) => e.discordUserId)).toEqual(["user-alice", "user-bob"]);
    expect(entries?.map((e) => e.actorId)).toEqual([
      actorId("actor-user-alice"),
      actorId("actor-user-bob"),
    ]);
    expect(entries?.every((e) => e.kind === "human")).toBe(true);
    expect(entries?.every((e) => e.approved === false)).toBe(true);
  });

  test("persists the invoking owner so isOwner has a stored owner to check", async () => {
    const h = makeHandler();
    await h.handler(event({ invokerId: "owner-1" }));

    expect(h.meta.get(campaignId("mine-01"))?.ownerId).toBe("owner-1");
  });

  test("bootstrap: first caller of an unclaimed campaign becomes owner", async () => {
    const h = makeHandler();
    await h.handler(event({ invokerId: "first-mover" }));

    expect(h.meta.get(campaignId("mine-01"))?.ownerId).toBe("first-mover");
    expect(h.roster.get(campaignId("mine-01"))).toHaveLength(2);
    expect(h.replies[0]).toContain("owner");
  });

  test("once claimed, a non-owner cannot change the roster (denied, unchanged)", async () => {
    const h = makeHandler();
    await h.handler(event({ invokerId: "owner-1", options: { players: "user-alice" } }));
    const after1 = h.roster.get(campaignId("mine-01"));

    await h.handler(event({ invokerId: "intruder", options: { players: "user-evil" } }));

    // Owner unchanged; roster unchanged; intruder told off.
    expect(h.meta.get(campaignId("mine-01"))?.ownerId).toBe("owner-1");
    expect(h.roster.get(campaignId("mine-01"))).toEqual(after1);
    expect(h.replies.at(-1)).toContain("owner");
  });

  test("the owner may change the roster again after claiming", async () => {
    const h = makeHandler();
    await h.handler(event({ invokerId: "owner-1", options: { players: "user-alice" } }));
    await h.handler(event({ invokerId: "owner-1", options: { players: "user-alice user-bob" } }));

    expect(h.roster.get(campaignId("mine-01"))).toHaveLength(2);
    expect(h.meta.get(campaignId("mine-01"))?.ownerId).toBe("owner-1");
  });
});
