import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actorId, campaignId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import type { CharacterSheet } from "../../src/ports/card-store.js";
import type { CampaignBible } from "../../src/domain/campaign.js";
import { FileSoulStore } from "../../src/adapters/store/file-soul-store.js";
import { FileCardStore, FileCardWriter } from "../../src/adapters/store/file-card-store.js";
import { FileCampaignStore } from "../../src/adapters/store/file-campaign-store.js";
import { FileExceptionStore } from "../../src/adapters/store/file-exception-store.js";
import { FileRosterStore } from "../../src/adapters/store/file-roster-store.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "homunculus-store-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("#30 FileSoulStore", () => {
  test("save→load round-trips a soul across reload (fresh instance)", () => {
    const camp = campaignId("camp:alpha");
    const id = actorId("soul:kael");
    const soul = createSoul(id, { name: "凯尔", temperament: "高傲", goals: ["证道"] });

    new FileSoulStore(dataDir, camp).save(soul);
    // A fresh instance reads from disk — proves persistence, not memory.
    const reloaded = new FileSoulStore(dataDir, camp).load(id);

    expect(reloaded).toEqual(soul);
  });

  test("load returns undefined when the soul has never been saved", () => {
    const store = new FileSoulStore(dataDir, campaignId("camp:alpha"));
    expect(store.load(actorId("soul:nobody"))).toBeUndefined();
  });

  test("the same actorId under different campaigns does not collide", () => {
    const id = actorId("soul:kael");
    const inAlpha = createSoul(id, { name: "阿尔法凯尔", temperament: "a", goals: [] });
    const inBeta = createSoul(id, { name: "贝塔凯尔", temperament: "b", goals: [] });

    new FileSoulStore(dataDir, campaignId("camp:alpha")).save(inAlpha);
    new FileSoulStore(dataDir, campaignId("camp:beta")).save(inBeta);

    expect(new FileSoulStore(dataDir, campaignId("camp:alpha")).load(id)).toEqual(inAlpha);
    expect(new FileSoulStore(dataDir, campaignId("camp:beta")).load(id)).toEqual(inBeta);
  });
});

describe("#30 FileCardStore (read-only port + separate non-AIDM write seam)", () => {
  const sheet: CharacterSheet = { system: "coc7", skills: { 侦查: 60 } };

  test("a sheet written via the CardWriter seam is readable via the read-only CardStore", () => {
    const camp = campaignId("camp:alpha");
    const id = actorId("actor:rin");

    // The non-AIDM write path (card-creation / bind flow) writes the sheet…
    new FileCardWriter(dataDir).write(camp, id, sheet);
    // …and the AIDM-facing read-only port reads it back.
    expect(new FileCardStore(dataDir, camp).read(id)).toEqual(sheet);
  });

  test("read returns undefined when no sheet is on record", () => {
    const store = new FileCardStore(dataDir, campaignId("camp:alpha"));
    expect(store.read(actorId("actor:nobody"))).toBeUndefined();
  });

  test("the same actorId under different campaigns does not collide", () => {
    const id = actorId("actor:rin");
    const a: CharacterSheet = { system: "coc7", skills: { 侦查: 10 } };
    const b: CharacterSheet = { system: "dnd5e", skills: { 调查: 99 } };
    const writer = new FileCardWriter(dataDir);

    writer.write(campaignId("camp:alpha"), id, a);
    writer.write(campaignId("camp:beta"), id, b);

    expect(new FileCardStore(dataDir, campaignId("camp:alpha")).read(id)).toEqual(a);
    expect(new FileCardStore(dataDir, campaignId("camp:beta")).read(id)).toEqual(b);
  });
});

describe("#30 FileCampaignStore (bible)", () => {
  const bible: CampaignBible = {
    secretTruth: "市长是凶手",
    milestones: [],
    npcs: [],
    worldClocks: [],
    bespokeRules: {},
  };

  test("set→get round-trips a CampaignBible across reload", () => {
    const camp = campaignId("camp:alpha");
    new FileCampaignStore(dataDir).set(camp, bible);
    expect(new FileCampaignStore(dataDir).get(camp)).toEqual(bible);
  });

  test("get returns undefined for a campaign with no bible on record", () => {
    expect(new FileCampaignStore(dataDir).get(campaignId("camp:void"))).toBeUndefined();
  });
});

describe("#30 FileExceptionStore (owner-sanctioned verify exceptions)", () => {
  test("an empty campaign lists no exceptions", () => {
    expect(new FileExceptionStore(dataDir).list(campaignId("camp:alpha"))).toEqual([]);
  });

  test("add→list round-trips sanctioned exceptions, in insertion order, across reload", () => {
    const camp = campaignId("camp:alpha");
    new FileExceptionStore(dataDir).add(camp, { item: "霰弹枪", note: "owner 已批准" });
    new FileExceptionStore(dataDir).add(camp, { item: "异界血统" });

    expect(new FileExceptionStore(dataDir).list(camp)).toEqual([
      { item: "霰弹枪", note: "owner 已批准" },
      { item: "异界血统" },
    ]);
  });

  test("exceptions are isolated per campaign", () => {
    const store = new FileExceptionStore(dataDir);
    store.add(campaignId("camp:alpha"), { item: "霰弹枪" });
    expect(store.list(campaignId("camp:beta"))).toEqual([]);
  });
});

describe("#30 FileRosterStore (explicit party list + per-seat approval)", () => {
  test("an unset roster reads as undefined", () => {
    expect(new FileRosterStore(dataDir).get(campaignId("camp:alpha"))).toBeUndefined();
  });

  test("set→get round-trips a roster across reload", () => {
    const camp = campaignId("camp:alpha");
    const roster = [
      { actorId: actorId("actor:rin"), discordUserId: "u1", kind: "human" as const, approved: false },
      { actorId: actorId("npc:guide"), kind: "ai" as const, approved: false },
    ];
    new FileRosterStore(dataDir).set(camp, roster);
    expect(new FileRosterStore(dataDir).get(camp)).toEqual(roster);
  });

  test("marking a seat approved persists (the open-gate guard reads this)", () => {
    const camp = campaignId("camp:alpha");
    const rin = actorId("actor:rin");
    const store = new FileRosterStore(dataDir);
    store.set(camp, [{ actorId: rin, discordUserId: "u1", kind: "human", approved: false }]);

    store.markApproved(camp, rin);

    const seat = new FileRosterStore(dataDir).get(camp)?.find((e) => e.actorId === rin);
    expect(seat?.approved).toBe(true);
  });
});
