import { describe, expect, test } from "vitest";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { actorId, campaignId, type CampaignId } from "../../src/domain/ids.js";
import type { RosterEntry } from "../../src/domain/card-lifecycle.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import { createStartGameHandler } from "../../src/adapters/discord/start-game-handler.js";

/**
 * #33 OPEN GATE — the `/start-game` handler (owner-scoped; the router gates it
 * to the owner). It is the ONLY thing that starts the AIDM (the main channel no
 * longer auto-starts). Guard: every roster entry must be approved; otherwise it
 * reports who is missing and does NOT spawn. All approved → spawns the AIDM
 * exactly once (the injected `spawnAidm` seam — the dispatcher's startAidm in
 * production; here a recording stub).
 */

const rosterWith = (entries: readonly RosterEntry[] | undefined): RosterStore => ({
  get: (_c: CampaignId) => entries,
  set: () => {},
  markApproved: () => {},
});

const entry = (name: string, approved: boolean): RosterEntry => ({
  actorId: actorId(name),
  discordUserId: `discord-${name}`,
  kind: "human",
  approved,
});

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "start-game",
  invokerId: "owner-1",
  channelId: "chan-main",
  options: {},
  ...over,
});

function makeHandler(rosterStore: RosterStore) {
  const spawns: string[] = [];
  const replies: string[] = [];
  const handler = createStartGameHandler({
    rosterStore,
    resolveCampaign: () => campaignId("mine-01"),
    spawnAidm: (channelId) => {
      spawns.push(channelId);
    },
    reply: async (text) => {
      replies.push(text);
    },
  });
  return { spawns, replies, handler };
}

describe("startGame handler (open gate)", () => {
  test("all roster entries approved → spawns the AIDM exactly once", async () => {
    const h = makeHandler(rosterWith([entry("alice", true), entry("bob", true)]));
    await h.handler(event({ channelId: "chan-main" }));

    expect(h.spawns).toEqual(["chan-main"]);
  });

  test("an unapproved entry → does NOT spawn and reports who is missing", async () => {
    const h = makeHandler(rosterWith([entry("alice", true), entry("bob", false)]));
    await h.handler(event());

    expect(h.spawns).toHaveLength(0);
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0]).toContain("bob");
    expect(h.replies[0]).not.toContain("alice");
  });

  test("no roster declared → does NOT spawn and reports", async () => {
    const h = makeHandler(rosterWith(undefined));
    await h.handler(event());

    expect(h.spawns).toHaveLength(0);
    expect(h.replies).toHaveLength(1);
  });
});
