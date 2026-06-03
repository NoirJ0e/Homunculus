/**
 * #41 轻量 pause/resume — pure engine seam tests.
 *
 * Covers: "serialize → reload → state equivalent" via the pure
 * `referee.snapshot()` / `referee.restore(snapshot)` seam (no real Discord,
 * no fs). The key invariant: after a barrier hold the engine's playable state
 * (scene membership, full log, pending checks, cursor, clocks) is captured in
 * a plain serializable object and can be restored into a fresh Referee to
 * continue from the same beat.
 */
import { describe, expect, test } from "vitest";
import { actorId, sceneId, campaignId } from "../src/domain/ids.js";
import { Referee } from "../src/engine/referee.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import type { HumanInboxPort } from "../src/ports/human-inbox.js";
import type { CampaignBible } from "../src/domain/campaign.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const tavern = sceneId("scene:tavern");
const aidm = actorId("aidm");
const alice = actorId("human-alice");
const bob = actorId("human-bob");

/** A human inbox that always returns silent (undefined) — triggers the hold. */
const silentInbox: HumanInboxPort = {
  poll: async () => undefined,
};

/** A human inbox scripted with a fixed response queue per actor. */
function scriptedInbox(
  responses: Record<string, Array<{ kind: "prose"; prose: string } | { kind: "pass" } | undefined>>,
): HumanInboxPort {
  const queues = new Map(
    Object.entries(responses).map(([id, turns]) => [id, [...turns]]),
  );
  return {
    poll: async (actor) => {
      const queue = queues.get(actor);
      if (!queue || queue.length === 0) return undefined;
      return queue.shift();
    },
  };
}

// ---------------------------------------------------------------------------
// A minimal campaign bible used in cursor/clock tests
// ---------------------------------------------------------------------------

const bible: CampaignBible = {
  secretTruth: "the butler did it",
  system: "coc7",
  tone: "horror",
  levelBand: [1, 5],
  milestones: [
    {
      id: "m1",
      goal: "discover the body",
      enterCue: "A scream...",
      scenes: [],
      triggers: [],
      branchPoints: [],
    },
    {
      id: "m2",
      goal: "confront the butler",
      enterCue: "The truth...",
      scenes: [],
      triggers: [],
      branchPoints: [],
    },
  ],
  npcs: [],
  worldClocks: [
    { id: "clock:doom", name: "Doom Clock", segments: ["calm", "tense", "imminent", "fired"] },
  ],
  bespokeRules: {},
};

// ---------------------------------------------------------------------------
// Tests — RED first, then green once snapshot()/restore() exist
// ---------------------------------------------------------------------------

describe("#41 pause/resume — pure engine snapshot seam", () => {
  test("a fresh referee with no pauses produces a snapshot with empty scene log", () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate });

    const snap = referee.snapshot();

    expect(snap.sceneLog).toEqual([]);
    expect(snap.sceneMembership).toEqual({});
    expect(snap.pendingChecks).toEqual([]);
  });

  test("scene membership is captured in the snapshot", () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      scenes: { [tavern]: [alice, bob] },
    });

    const snap = referee.snapshot();

    expect(snap.sceneMembership).toEqual({ [tavern]: [alice, bob] });
  });

  test("narrate adds a post to the scene log captured by snapshot", async () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      scenes: { [tavern]: [alice] },
    });

    await referee.narrate(tavern, "夜风灌进酒馆。");

    const snap = referee.snapshot();
    expect(snap.sceneLog).toHaveLength(1);
    expect(snap.sceneLog[0]).toMatchObject({
      sceneId: tavern,
      actorId: aidm,
      prose: "夜风灌进酒馆。",
    });
  });

  test("pending checks are captured in the snapshot", async () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate });

    await referee.callCheck(alice, "侦查", "困难");
    await referee.callCheck(bob, "聆听");

    const snap = referee.snapshot();
    expect(snap.pendingChecks).toHaveLength(2);
    expect(snap.pendingChecks).toContainEqual({ actor: alice, skill: "侦查", difficulty: "困难" });
    expect(snap.pendingChecks).toContainEqual({ actor: bob, skill: "聆听" });
  });

  test("milestone cursor state is captured in the snapshot", () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate, campaign: bible });

    referee.advanceMilestone(); // m1 → m2

    const snap = referee.snapshot();
    expect(snap.cursor).toMatchObject({
      currentMilestone: "m2",
      completed: ["m1"],
    });
  });

  test("world clock positions are captured in the snapshot", () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate, campaign: bible });

    referee.advanceClock("clock:doom"); // position 0 → 1

    const snap = referee.snapshot();
    expect(snap.clocks).toContainEqual(
      expect.objectContaining({ id: "clock:doom", position: 1 }),
    );
  });

  test("pause barrier state is captured in the snapshot after a held await", async () => {
    const substrate = new FakeSubstrate();
    const roster = { kindOf: (_actor: string) => "human" as const };
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      humanInbox: silentInbox,
      roster,
      scenes: { [tavern]: [alice] },
    });

    await referee.narrate(tavern, "什么人？");
    const outcome = await referee.awaitActors(tavern, [alice]);

    expect(outcome.status).toBe("held");

    const snap = referee.snapshot();
    expect(snap.pauseState).toBeDefined();
    expect(snap.pauseState?.waitingOn).toContain(alice);
    expect(snap.pauseState?.sceneId).toBe(tavern);
  });

  test("snapshot → restore → restored referee has the same scene log", async () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      scenes: { [tavern]: [alice] },
    });

    await referee.narrate(tavern, "故事开始了。");
    const snap = referee.snapshot();

    // Restore into a fresh Referee (simulating process restart).
    const substrate2 = new FakeSubstrate();
    const referee2 = Referee.restore({ aidmId: aidm, substrate: substrate2 }, snap);

    expect(referee2.fullLog()).toEqual(referee.fullLog());
  });

  test("snapshot → restore → restored referee has the same scene membership", async () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      scenes: { [tavern]: [alice, bob] },
    });

    await referee.narrate(tavern, "酒馆里有两人。");
    const snap = referee.snapshot();

    const substrate2 = new FakeSubstrate();
    const referee2 = Referee.restore({ aidmId: aidm, substrate: substrate2 }, snap);

    expect(referee2.membersOf(tavern)).toEqual(expect.arrayContaining([alice, bob]));
    expect(referee2.membersOf(tavern)).toHaveLength(2);
  });

  test("snapshot → restore → restored referee preserves pending checks", async () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate });
    await referee.callCheck(alice, "侦查", "困难");

    const snap = referee.snapshot();
    const substrate2 = new FakeSubstrate();
    const referee2 = Referee.restore({ aidmId: aidm, substrate: substrate2 }, snap);

    // The pending check should survive: restoring and then snapshotting again
    // must carry the same pending entries.
    const snap2 = referee2.snapshot();
    expect(snap2.pendingChecks).toEqual(snap.pendingChecks);
  });

  test("snapshot → restore → restored referee preserves milestone cursor", () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate, campaign: bible });
    referee.advanceMilestone();

    const snap = referee.snapshot();
    const substrate2 = new FakeSubstrate();
    const referee2 = Referee.restore({ aidmId: aidm, substrate: substrate2, campaign: bible }, snap);

    expect(referee2.cursorState()).toEqual(referee.cursorState());
  });

  test("snapshot → restore → restored referee preserves world clock positions", () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate, campaign: bible });
    referee.advanceClock("clock:doom");
    referee.advanceClock("clock:doom");

    const snap = referee.snapshot();
    const substrate2 = new FakeSubstrate();
    const referee2 = Referee.restore({ aidmId: aidm, substrate: substrate2, campaign: bible }, snap);

    expect(referee2.clockDmView("clock:doom")).toEqual(referee.clockDmView("clock:doom"));
  });

  test("snapshot is JSON-round-trippable (all fields survive JSON.stringify/parse)", async () => {
    const substrate = new FakeSubstrate();
    const roster = { kindOf: (_actor: string) => "human" as const };
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      humanInbox: silentInbox,
      roster,
      scenes: { [tavern]: [alice] },
      campaign: bible,
    });

    await referee.narrate(tavern, "测试序列化。");
    await referee.callCheck(alice, "侦查");
    await referee.awaitActors(tavern, [alice]); // triggers hold

    const snap = referee.snapshot();
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json) as typeof snap;

    // Restore from a JSON-round-tripped snapshot — should be equivalent.
    const substrate2 = new FakeSubstrate();
    const referee2 = Referee.restore({ aidmId: aidm, substrate: substrate2, campaign: bible }, parsed);

    expect(referee2.fullLog()).toEqual(referee.fullLog());
    expect(referee2.membersOf(tavern)).toEqual(expect.arrayContaining([alice]));
  });

  test("the AIDM id in the snapshot matches the configured aidmId", () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate });
    const snap = referee.snapshot();
    expect(snap.aidmId).toBe(aidm);
  });

  test("snapshot → restore → the resumed referee can continue with a new beat", async () => {
    // This is the core end-to-end scenario:
    // 1. Pause (human goes silent).
    // 2. Snapshot + reload (simulated restart).
    // 3. Resume: the reload provides an inbox that now answers.
    const substrate = new FakeSubstrate();
    const roster = { kindOf: (_actor: string) => "human" as const };
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      humanInbox: silentInbox,
      roster,
      scenes: { [tavern]: [alice] },
    });

    await referee.narrate(tavern, "轮到你了，Alice。");
    const held = await referee.awaitActors(tavern, [alice]);
    expect(held.status).toBe("held");

    const snap = referee.snapshot();
    const json = JSON.stringify(snap);

    // --- Process restarts ---
    const snap2 = JSON.parse(json) as typeof snap;
    const substrate2 = new FakeSubstrate();
    // Now Alice answers on resume.
    const answeringInbox = scriptedInbox({
      [alice]: [{ kind: "prose", prose: "我查看房间四周。" }],
    });
    const referee2 = Referee.restore(
      { aidmId: aidm, substrate: substrate2, humanInbox: answeringInbox, roster },
      snap2,
    );

    // The scene log from before the pause survives.
    expect(referee2.fullLog()).toHaveLength(1); // the narrate post
    expect(referee2.fullLog()[0]?.prose).toBe("轮到你了，Alice。");

    // The resumed referee can drive a new beat from the same scene.
    const released = await referee2.awaitActors(tavern, [alice]);
    expect(released.status).toBe("released");
    expect(substrate2.transcript[0]?.prose).toBe("我查看房间四周。");
  });
});
