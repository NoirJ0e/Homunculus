import { describe, expect, test } from "vitest";
import { runDmDriver } from "../src/runtime/dm-driver.js";
import { buildDmSystemPrompt } from "../src/adapters/agent-sdk/dm-prompt.js";

/** A finite async stream that yields a couple of items then ends — stands in
 *  for one Agent-SDK query() turn completing. */
async function* finiteStream(): AsyncIterable<unknown> {
  yield { type: "assistant" };
  yield { type: "result" };
}

describe("#20 runDmDriver — long-lived query() with restart net", () => {
  test("re-invokes query() when it ends while the session is still active", async () => {
    let runs = 0;
    // Active for the first two loop checks, then stop → expect exactly 2 runs.
    const activeVerdicts = [true, true, false];
    let i = 0;

    await runDmDriver({
      runQuery: () => {
        runs += 1;
        return finiteStream();
      },
      isSessionActive: () => activeVerdicts[i++] ?? false,
    });

    expect(runs).toBe(2);
  });

  test("never starts a query() if the session is already inactive", async () => {
    let runs = 0;
    await runDmDriver({
      runQuery: () => {
        runs += 1;
        return finiteStream();
      },
      isSessionActive: () => false,
    });
    expect(runs).toBe(0);
  });

  test("a thrown query() is surfaced via onError and does not crash the loop", async () => {
    let runs = 0;
    const errors: unknown[] = [];
    const active = [true, false];
    let i = 0;

    await runDmDriver({
      runQuery: () => {
        runs += 1;
        // eslint-disable-next-line require-yield
        return (async function* (): AsyncIterable<unknown> {
          throw new Error("query blew up");
        })();
      },
      isSessionActive: () => active[i++] ?? false,
      onError: (e) => errors.push(e),
    });

    expect(runs).toBe(1);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("query blew up");
  });
});

describe("#20 buildDmSystemPrompt — pure prompt assembly", () => {
  test("embeds the campaign brief, the cast, and the load-bearing tool protocol", () => {
    const prompt = buildDmSystemPrompt({
      brief: "玩家们刚踏入暮色酒馆。",
      sceneId: "scene-tavern",
      cast: [
        { actorId: "npc-rogue", role: "npc" },
        { actorId: "human-1", role: "human" },
      ],
    });

    expect(prompt).toContain("玩家们刚踏入暮色酒馆。");
    expect(prompt).toContain("scene-tavern"); // the DM must know which scene to act in
    expect(prompt).toContain("npc-rogue");
    expect(prompt).toContain("human-1");
    // The two tools the DM loop hinges on must be named.
    expect(prompt).toContain("narrate");
    expect(prompt).toContain("await_actors");
  });
});
