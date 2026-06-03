/**
 * #41 轻量 pause/resume — FilePauseStore adapter tests.
 *
 * Tests the file-backed persistence of RefereeSnapshot to disk under
 * `<dataDir>/campaigns/<id>/pause.json`. Follows the same pattern as the
 * other file-store tests (mkdtempSync → test → rmSync).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actorId, sceneId, campaignId } from "../../src/domain/ids.js";
import type { RefereeSnapshot } from "../../src/engine/referee.js";
import { FilePauseStore } from "../../src/adapters/store/file-pause-store.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "homunculus-pause-store-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const camp = campaignId("camp:alpha");
const tavern = sceneId("scene:tavern");
const aidm = actorId("aidm");
const alice = actorId("human-alice");

const minimalSnapshot: RefereeSnapshot = {
  aidmId: aidm,
  sceneMembership: {},
  sceneLog: [],
  pendingChecks: [],
  cursor: null,
  clocks: [],
  pauseState: null,
};

const richSnapshot: RefereeSnapshot = {
  aidmId: aidm,
  sceneMembership: { [tavern]: [alice] },
  sceneLog: [{ sceneId: tavern, actorId: aidm, prose: "夜风灌进酒馆。" }],
  pendingChecks: [{ actor: alice, skill: "侦查", difficulty: "困难" }],
  cursor: { currentMilestone: "m2", completed: ["m1"], discoveredLeads: ["line:key"] },
  clocks: [{ id: "clock:doom", name: "Doom Clock", segments: ["calm", "tense", "fired"], position: 1, hidden: true }],
  pauseState: {
    sceneId: tavern,
    aidmId: aidm,
    awaiting: [alice],
    acted: [],
    waitingOn: [alice],
  },
};

describe("#41 FilePauseStore", () => {
  test("load returns undefined when no snapshot has been saved", () => {
    expect(new FilePauseStore(dataDir).load(camp)).toBeUndefined();
  });

  test("save→load round-trips a minimal snapshot across reload (fresh instance)", () => {
    new FilePauseStore(dataDir).save(camp, minimalSnapshot);
    const loaded = new FilePauseStore(dataDir).load(camp);
    expect(loaded).toEqual(minimalSnapshot);
  });

  test("save→load round-trips a rich snapshot (membership, log, checks, cursor, clocks, pause)", () => {
    new FilePauseStore(dataDir).save(camp, richSnapshot);
    const loaded = new FilePauseStore(dataDir).load(camp);
    expect(loaded).toEqual(richSnapshot);
  });

  test("the snapshot is isolated per campaign", () => {
    const campBeta = campaignId("camp:beta");
    new FilePauseStore(dataDir).save(camp, richSnapshot);
    expect(new FilePauseStore(dataDir).load(campBeta)).toBeUndefined();
  });

  test("a later save overwrites the prior snapshot (idempotent, last-write-wins)", () => {
    const store = new FilePauseStore(dataDir);
    store.save(camp, minimalSnapshot);
    store.save(camp, richSnapshot);
    expect(new FilePauseStore(dataDir).load(camp)).toEqual(richSnapshot);
  });

  test("clear removes the snapshot (load returns undefined after clear)", () => {
    const store = new FilePauseStore(dataDir);
    store.save(camp, richSnapshot);
    store.clear(camp);
    expect(new FilePauseStore(dataDir).load(camp)).toBeUndefined();
  });

  test("the saved file path follows ADR-0012 campaign directory layout", () => {
    // Confirms the file lands inside the expected campaign directory.
    const store = new FilePauseStore(dataDir);
    store.save(camp, minimalSnapshot);
    const expectedPath = join(dataDir, "campaigns", camp, "pause.json");
    expect(existsSync(expectedPath)).toBe(true);
  });
});
