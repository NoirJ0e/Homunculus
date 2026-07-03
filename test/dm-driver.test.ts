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
    // The two tools the DM loop hinges on must be named (#52: 串行 nominate, 退役 await_actors).
    expect(prompt).toContain("narrate");
    expect(prompt).toContain("nominate");
    expect(prompt).not.toContain("await_actors");
  });

  test("teaches 串行点名纪律: 逐个点名、看得见结果、据此喊检定 (#52)", () => {
    const prompt = buildDmSystemPrompt({ brief: "x", sceneId: "s", cast: [] });
    // Serial discipline: nominate ONE at a time, see the result, then point next.
    expect(prompt).toContain("逐个点名");
    expect(prompt).toContain("一次只点一个");
    // The DM is told it SEES each nominee's result (修 Bug2 失明) and the remaining list.
    expect(prompt).toContain("remaining");
    // It must call a check off what it actually saw, not narrate over it.
    expect(prompt).toContain("call_check");
  });

  test("instructs the AIDM to steer the plot spine toward milestones (#45)", () => {
    const prompt = buildDmSystemPrompt({ brief: "x", sceneId: "s", cast: [] });
    // The three spine tools must be named so the AIDM advances toward a climax…
    expect(prompt).toContain("advance_milestone");
    expect(prompt).toContain("discover_lead");
    expect(prompt).toContain("advance_clock");
    // …and the world clock must be hidden from players (soft gravity, ADR-0007).
    expect(prompt).toContain("软引力");
    expect(prompt).toContain("玩家永远看不到刻度");
  });

  test("#58: cast 显示名进 roster，并明令点名用真名、不从 actorId 猜名字", () => {
    const prompt = buildDmSystemPrompt({
      brief: "x",
      sceneId: "s",
      cast: [
        { actorId: "npc-linxuan", role: "npc", name: "林萱" },
        { actorId: "player-1", role: "human" },
      ],
    });
    // The display name appears alongside the actorId (live bug: DM 把「林萱」猜成「林轩」).
    expect(prompt).toContain("林萱");
    expect(prompt).toContain("npc-linxuan");
    // A nameless member still renders by actorId (backwards compatible).
    expect(prompt).toContain("player-1");
    // The rule itself: use the real name, never guess from the actorId's pinyin.
    expect(prompt).toContain("真名");
    expect(prompt).toContain("不要从 actorId");
  });

  test("#58: CoC7 难度语义——roll-under 无 DC，只有 hard/extreme 两档收紧", () => {
    const prompt = buildDmSystemPrompt({ brief: "x", sceneId: "s", cast: [], system: "coc7" });
    expect(prompt).toContain("hard");
    expect(prompt).toContain("extreme");
    expect(prompt).toContain("没有 DC");
    // The D&D5e difficulty guidance must NOT leak into a CoC7 table.
    expect(prompt).not.toContain("mode 传 \"attack\"");
  });

  test("#58: D&D5e 难度语义——DC/AC 数字目标 + 攻击走 mode attack", () => {
    const prompt = buildDmSystemPrompt({ brief: "x", sceneId: "s", cast: [], system: "dnd5e" });
    expect(prompt).toContain("DC");
    expect(prompt).toContain("AC");
    expect(prompt).toContain("mode 传 \"attack\"");
    expect(prompt).not.toContain("没有 DC");
  });

  test("#58: call_check 时序预告——同轮已行动者不可再点，下一轮开头收骰", () => {
    const prompt = buildDmSystemPrompt({ brief: "x", sceneId: "s", cast: [] });
    expect(prompt).toContain("下一轮开头");
    expect(prompt).toContain("这不是错误");
  });
});
