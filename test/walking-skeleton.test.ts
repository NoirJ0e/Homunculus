import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { Referee } from "../src/engine/referee.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeNpc } from "../src/adapters/memory/fake-npc.js";
import { FakeHumanInbox } from "../src/adapters/memory/fake-human-inbox.js";
import { mapRoster } from "../src/engine/roster.js";
import { runDmToolFlow } from "../src/adapters/memory/fake-tool-flow.js";

/**
 * #17 walking skeleton — the tracer bullet for the ADR-0009 pivot.
 *
 * A fake TOOL-CALL flow drives the DM (narrate → await_actors → narrate); the
 * engine paces a simplified combat round, pulling up NPCs (wake-gate → speak/
 * pass). Headless, deterministic, no network — the new FakeNpc + tool-flow
 * harness replace the old FakeAgent.
 */
const tavern = sceneId("scene:tavern");
const aidm = actorId("aidm");
const rogue = actorId("npc-rogue");
const cleric = actorId("npc-cleric");

describe("#17 DM tool-flow drives one round, engine paces the NPCs", () => {
  test("narrate → await_actors → NPC speak/pass → release → narrate", async () => {
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc({
      "npc-rogue": [{ kind: "speak", prose: "罗格悄悄把手探向腰间的匕首。" }],
      "npc-cleric": [{ kind: "pass" }],
    });
    const referee = new Referee({ aidmId: aidm, substrate, npcFor: () => npc });

    const flow = await runDmToolFlow(referee, [
      { tool: "narrate", sceneId: tavern, prose: "夜风灌进酒馆。门口的陌生人盯着你们。" },
      { tool: "await_actors", sceneId: tavern, order: [rogue, cleric] },
      { tool: "narrate", sceneId: tavern, prose: "陌生人见无人妄动，松开了按在剑柄上的手。" },
    ]);

    expect(flow.suspended).toBe(false); // released, so the DM ran its closing narrate

    // The transcript: the passing NPC produces nothing; order is preserved.
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([
      [aidm, "夜风灌进酒馆。门口的陌生人盯着你们。"],
      [rogue, "罗格悄悄把手探向腰间的匕首。"],
      [aidm, "陌生人见无人妄动，松开了按在剑柄上的手。"],
    ]);

    // Authoritative pacing transitions of the awaited round.
    expect(flow.awaits[0]!.events).toEqual([
      { kind: "barrier-opened", waiting: [rogue, cleric] },
      { kind: "actor-acted", actorId: rogue },
      { kind: "actor-passed", actorId: cleric },
      { kind: "barrier-released" },
    ]);
  });

  test("a wake-gated NPC produces no post but does not block the barrier", async () => {
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc(
      {
        "npc-rogue": [{ kind: "speak", prose: "我才不该说话。" }], // scripted, but gated out
        "npc-cleric": [{ kind: "speak", prose: "牧师抬头看向钟楼。" }],
      },
      { "npc-rogue": false, "npc-cleric": true }, // wake-gate verdict
    );
    const referee = new Referee({ aidmId: aidm, substrate, npcFor: () => npc });

    const flow = await runDmToolFlow(referee, [
      { tool: "narrate", sceneId: tavern, prose: "钟楼传来钟声。" },
      { tool: "await_actors", sceneId: tavern, order: [rogue, cleric] },
    ]);

    expect(flow.suspended).toBe(false);
    // The gated NPC's scripted line is never consumed → no post.
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([
      [aidm, "钟楼传来钟声。"],
      [cleric, "牧师抬头看向钟楼。"],
    ]);
    expect(flow.awaits[0]!.events).toContainEqual({ kind: "actor-gated", actorId: rogue });
    expect(flow.awaits[0]!.events).toContainEqual({ kind: "barrier-released" });
  });

  test("后手看前手: a later NPC's context contains an earlier NPC's just-made post", async () => {
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc({
      "npc-rogue": [{ kind: "speak", prose: "罗格踢翻了酒桌。" }],
      "npc-cleric": [{ kind: "speak", prose: "牧师皱眉。" }],
    });
    const referee = new Referee({ aidmId: aidm, substrate, npcFor: () => npc });

    await runDmToolFlow(referee, [
      { tool: "narrate", sceneId: tavern, prose: "酒馆陷入寂静。" },
      { tool: "await_actors", sceneId: tavern, order: [rogue, cleric] },
    ]);

    // The cleric (later) saw the rogue's (earlier) post made THIS round.
    const clericCtx = npc.seen.find((c) => c.actorId === cleric)!;
    expect(clericCtx.transcript.map((p) => p.prose)).toContain("罗格踢翻了酒桌。");
    // The rogue (earlier) did NOT see the cleric's not-yet-made post.
    const rogueCtx = npc.seen.find((c) => c.actorId === rogue)!;
    expect(rogueCtx.transcript.map((p) => p.prose)).not.toContain("牧师皱眉。");
  });

  test("a silent human overflows the round then holds → serializable pause, DM blocked", async () => {
    const human = actorId("human-1");
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc({ "npc-rogue": [{ kind: "speak", prose: "罗格拔刀戒备。" }] });
    const referee = new Referee({
      aidmId: aidm,
      substrate,
      npcFor: () => npc,
      roster: mapRoster({ "human-1": "human", "npc-rogue": "ai" }),
      humanInbox: new FakeHumanInbox({ "human-1": undefined }), // silent
    });

    const flow = await runDmToolFlow(referee, [
      { tool: "narrate", sceneId: tavern, prose: "门被撞开。" },
      { tool: "await_actors", sceneId: tavern, order: [rogue, human] },
      { tool: "narrate", sceneId: tavern, prose: "（这一句不该发生——DM 被挂起。）" },
    ]);

    expect(flow.suspended).toBe(true);
    expect(flow.executed).toBe(2); // the closing narrate never ran

    const held = flow.awaits[0];
    if (!held || held.status !== "held") throw new Error("expected a held outcome");
    // The rogue's effect is retained even though the human went silent (溢出一轮).
    expect(substrate.transcript.map((p) => p.prose)).toEqual(["门被撞开。", "罗格拔刀戒备。"]);
    expect(held.pause.waitingOn).toEqual([human]);
    // The pause must survive a JSON round-trip (save/restore).
    expect(JSON.parse(JSON.stringify(held.pause))).toEqual(held.pause);
  });
});
