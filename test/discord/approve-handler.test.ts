import { describe, expect, test } from "vitest";
import { campaignId } from "../../src/domain/ids.js";
import type { CampaignId } from "../../src/domain/ids.js";
import type { SanctionedException } from "../../src/domain/card-lifecycle.js";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { createCommandRouter } from "../../src/adapters/discord/command-router.js";
import { createCommandSet } from "../../src/adapters/discord/command-set.js";
import { createApproveHandler } from "../../src/adapters/discord/approve-handler.js";
import type { ExceptionStore } from "../../src/ports/exception-store.js";

/**
 * #35 — the owner-only `/批准` (approve) handler. It writes a SanctionedException
 * via ExceptionStore.add(campaign, exception); the verifier later READS this as
 * the sole exception authority, so a previously-rejected item passes ONLY after
 * the owner approved it. Owner-only is enforced STRUCTURALLY by #31's router
 * scope gate (Discord verifies the invoker id; players cannot forge it).
 */

function makeExceptionStore(): { store: ExceptionStore; added: Array<{ campaign: string; ex: SanctionedException }> } {
  const data = new Map<string, SanctionedException[]>();
  const added: Array<{ campaign: string; ex: SanctionedException }> = [];
  const store: ExceptionStore = {
    list: (c: CampaignId) => data.get(c) ?? [],
    add: (c: CampaignId, ex: SanctionedException) => {
      const arr = data.get(c) ?? [];
      arr.push(ex);
      data.set(c, arr);
      added.push({ campaign: c, ex });
    },
  };
  return { store, added };
}

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "approve",
  invokerId: "user-owner",
  channelId: "chan-x",
  options: { item: "现代手枪", note: "时代错置但 owner 允许" },
  ...over,
});

describe("approve handler (/批准)", () => {
  test("writes a SanctionedException from the command option", async () => {
    const { store, added } = makeExceptionStore();
    const handler = createApproveHandler({
      exceptionStore: store,
      resolveCampaign: () => campaignId("camp-1"),
    });

    await handler(event());

    expect(added).toHaveLength(1);
    expect(added[0]?.campaign).toBe("camp-1");
    expect(added[0]?.ex.item).toBe("现代手枪");
    expect(added[0]?.ex.note).toBe("时代错置但 owner 允许");
    expect(store.list(campaignId("camp-1")).map((e) => e.item)).toContain("现代手枪");
  });

  test("non-owner /批准 is DENIED by the router scope gate (handler never runs)", async () => {
    const { store, added } = makeExceptionStore();
    const approve = createApproveHandler({ exceptionStore: store, resolveCampaign: () => campaignId("camp-1") });

    // Authority stub: invoker is NOT the owner.
    const router = createCommandRouter(
      createCommandSet({
        createCharacterCard: async () => {},
        verifyCard: async () => {},
        startGame: async () => {},
        approve,
        setRoster: async () => {},
        addAiSeat: async () => {},
        check: async () => {},
        roll: async () => {},
        pause: async () => {},
      }),
      { isOwner: () => false, inRoster: () => true },
    );

    const result = await router.dispatch(event({ invokerId: "user-player" }));
    expect(result).toEqual({ kind: "denied", name: "approve", scope: "owner" });
    expect(added).toEqual([]); // exception NOT written
  });

  test("owner /批准 dispatched through the router writes the exception", async () => {
    const { store, added } = makeExceptionStore();
    const approve = createApproveHandler({ exceptionStore: store, resolveCampaign: () => campaignId("camp-1") });
    const router = createCommandRouter(
      createCommandSet({
        createCharacterCard: async () => {},
        verifyCard: async () => {},
        startGame: async () => {},
        approve,
        setRoster: async () => {},
        addAiSeat: async () => {},
        check: async () => {},
        roll: async () => {},
        pause: async () => {},
      }),
      { isOwner: () => true, inRoster: () => true },
    );

    const result = await router.dispatch(event({ invokerId: "user-owner" }));
    expect(result).toEqual({ kind: "dispatched", name: "approve" });
    expect(added).toHaveLength(1);
    expect(added[0]?.ex.item).toBe("现代手枪");
  });
});
