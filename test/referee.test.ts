import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import { Referee } from "../src/engine/referee.js";
import { createDmMcpServer, dmTools } from "../src/adapters/agent-sdk/engine-mcp.js";
import { FakeSubstrate } from "../src/adapters/memory/fake-substrate.js";
import { FakeNpc } from "../src/adapters/memory/fake-npc.js";

const tavern = sceneId("scene:tavern");
const aidm = actorId("aidm");
const rogue = actorId("npc-rogue");

describe("#15 referee + in-process MCP tool server (narrate)", () => {
  test("narrate records the post under the DM and emits it to the substrate", async () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate });

    await referee.narrate(tavern, "夜风灌进酒馆。");

    const post = { sceneId: tavern, actorId: aidm, prose: "夜风灌进酒馆。" };
    expect(substrate.transcript).toEqual([post]); // substrate received
    expect(referee.fullLog()).toEqual([post]); // scene recorded
  });

  test("the in-process narrate tool drives the engine: scene recorded + substrate received", async () => {
    const substrate = new FakeSubstrate();
    const referee = new Referee({ aidmId: aidm, substrate });

    // The MCP tool server can be built (Agent SDK createSdkMcpServer + tool).
    const server = createDmMcpServer(referee);
    expect(server.type).toBe("sdk");
    expect(server.name).toBe("engine");

    // Invoking the narrate tool's handler drives the engine state transition.
    const narrate = dmTools(referee).find((t) => t.name === "narrate");
    expect(narrate).toBeDefined();
    const res = await narrate!.handler({ sceneId: "scene:tavern", prose: "门开了。" }, {});

    expect(res.content[0]).toMatchObject({ type: "text" });
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([[aidm, "门开了。"]]);
    expect(referee.fullLog().map((p) => p.prose)).toEqual(["门开了。"]);
  });

  test("the await_actors tool paces a round and pulls up the NPC", async () => {
    const substrate = new FakeSubstrate();
    const npc = new FakeNpc({ "npc-rogue": [{ kind: "speak", prose: "罗格点头。" }] });
    const referee = new Referee({ aidmId: aidm, substrate, npc });

    const tools = dmTools(referee);
    // #18 appended call_check / read_card; narrate + await_actors stay the lead pair.
    expect(tools.map((t) => t.name).slice(0, 2)).toEqual(["narrate", "await_actors"]);

    const awaitActors = tools.find((t) => t.name === "await_actors")!;
    const res = await awaitActors.handler({ sceneId: "scene:tavern", order: ["npc-rogue"] }, {});

    expect(res.content[0]).toMatchObject({ type: "text", text: "released: 1 post(s)" });
    expect(substrate.transcript.map((p) => [p.actorId, p.prose])).toEqual([[rogue, "罗格点头。"]]);
  });
});
