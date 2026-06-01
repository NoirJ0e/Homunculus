import { describe, expect, test } from "vitest";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { actorId, campaignId, type CampaignId } from "../../src/domain/ids.js";
import type { RosterEntry } from "../../src/domain/card-lifecycle.js";
import type { RosterStore } from "../../src/ports/roster-store.js";
import type { CampaignMeta, CampaignMetaStore } from "../../src/ports/campaign-meta-store.js";
import { createCampaignAuthority } from "../../src/adapters/discord/campaign-authority.js";

/**
 * #33 — the real {@link CommandAuthority}, backing #31's injected predicates with
 * the stored campaign owner (CampaignMetaStore) and the explicit party
 * (RosterStore). `isOwner` = invoker matches the stored ownerId; `inRoster` =
 * invoker matches a roster entry's discordUserId.
 */

const meta = (ownerId: string): CampaignMetaStore => ({
  get: (_c: CampaignId): CampaignMeta | undefined => ({ ownerId }),
  set: () => {},
});

const rosterWith = (entries: readonly RosterEntry[]): RosterStore => ({
  get: (_c: CampaignId) => entries,
  set: () => {},
  markApproved: () => {},
});

const entry = (discordUserId: string): RosterEntry => ({
  actorId: actorId(`actor-${discordUserId}`),
  discordUserId,
  kind: "human",
  approved: false,
});

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "start-game",
  invokerId: "owner-1",
  channelId: "chan-main",
  options: {},
  ...over,
});

describe("campaign authority", () => {
  test("isOwner is true only for the stored owner", () => {
    const auth = createCampaignAuthority({
      metaStore: meta("owner-1"),
      rosterStore: rosterWith([]),
      resolveCampaign: () => campaignId("mine-01"),
    });
    expect(auth.isOwner(event({ invokerId: "owner-1" }))).toBe(true);
    expect(auth.isOwner(event({ invokerId: "imposter" }))).toBe(false);
  });

  test("isOwner is false when no owner is stored yet", () => {
    const auth = createCampaignAuthority({
      metaStore: { get: () => undefined, set: () => {} },
      rosterStore: rosterWith([]),
      resolveCampaign: () => campaignId("mine-01"),
    });
    expect(auth.isOwner(event({ invokerId: "owner-1" }))).toBe(false);
  });

  test("inRoster is true only for a declared player", () => {
    const auth = createCampaignAuthority({
      metaStore: meta("owner-1"),
      rosterStore: rosterWith([entry("user-alice"), entry("user-bob")]),
      resolveCampaign: () => campaignId("mine-01"),
    });
    expect(auth.inRoster(event({ invokerId: "user-alice" }))).toBe(true);
    expect(auth.inRoster(event({ invokerId: "outsider" }))).toBe(false);
  });

  test("inRoster is false when no roster is declared yet", () => {
    const auth = createCampaignAuthority({
      metaStore: meta("owner-1"),
      rosterStore: { get: () => undefined, set: () => {}, markApproved: () => {} },
      resolveCampaign: () => campaignId("mine-01"),
    });
    expect(auth.inRoster(event({ invokerId: "user-alice" }))).toBe(false);
  });
});
