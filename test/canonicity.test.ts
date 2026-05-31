import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { createSoul } from "../src/domain/soul.js";
import { remember } from "../src/engine/memory.js";
import { fork, merge, discard } from "../src/engine/canonicity.js";
import { FakeSoulStore } from "../src/adapters/memory/fake-soul-store.js";
import { FakeCardShim } from "../src/adapters/memory/fake-card-shim.js";

const kael = actorId("soul:kael");
const crypt = sceneId("scene:crypt");

describe("#8 canonicity — fork / merge / discard", () => {
  test("fork copies the soul onto a branch without touching canonical", async () => {
    const store = new FakeSoulStore();
    store.save(createSoul(kael, { name: "凯尔", temperament: "高傲", goals: [] }));

    const branch = await fork({ branchId: "s1", soulIds: [kael], store });
    expect(branch.souls.get(kael)?.personaCore.name).toBe("凯尔");
    // Mutating the branch copy does not change canonical.
    branch.souls.set(kael, remember(branch.souls.get(kael)!, { sceneId: crypt, summary: "支线往事", tags: [] }));
    expect(store.load(kael)?.episodic).toEqual([]);
  });

  test("discard leaves the canonical soul untouched — even an in-fiction death", async () => {
    const store = new FakeSoulStore();
    store.save(createSoul(kael, { name: "凯尔", temperament: "高傲", goals: [] }));
    const cards = new FakeCardShim({ "soul:kael": { hp: 10 } });

    const branch = await fork({ branchId: "s1", soulIds: [kael], store, cards });
    // In the session: gained a memory AND died (sheet torn → hp 0).
    branch.souls.set(kael, remember(branch.souls.get(kael)!, { sceneId: crypt, summary: "惨死地穴", tags: ["死亡"] }));
    cards.set(kael, { hp: 0 });

    await discard(branch, { store, cards });

    expect(store.load(kael)?.episodic).toEqual([]); // memory rolled back
    expect(cards.get(kael)).toEqual({ hp: 10 }); // death undone — sheet restored
  });

  test("merge commits growth + memory (and keeps the branch's card state)", async () => {
    const store = new FakeSoulStore();
    store.save(createSoul(kael, { name: "凯尔", temperament: "高傲", goals: [] }));
    const cards = new FakeCardShim({ "soul:kael": { hp: 10 } });

    const branch = await fork({ branchId: "s1", soulIds: [kael], store, cards });
    branch.souls.set(kael, remember(branch.souls.get(kael)!, { sceneId: crypt, summary: "击败首领", tags: ["胜利"] }));
    cards.set(kael, { hp: 7 }); // took damage but survived

    await merge(branch, { store, cards });

    expect(store.load(kael)?.episodic.map((m) => m.summary)).toEqual(["击败首领"]);
    expect(cards.get(kael)).toEqual({ hp: 7 }); // branch sheet state stands
  });
});
