import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../src/domain/ids.js";
import type { Post } from "../src/domain/post.js";
import type { TurnContext } from "../src/domain/agent.js";
import { AgentNpc } from "../src/adapters/agent-sdk/agent-npc.js";
import { buildNpcPrompt } from "../src/adapters/agent-sdk/npc-prompt.js";

const scene = sceneId("scene-tavern");
const npc = actorId("npc-merc");
const transcript: Post[] = [
  { sceneId: scene, actorId: actorId("aidm"), prose: "酒馆的门被一脚踹开。" },
];
const ctx = (over: Partial<TurnContext> = {}): TurnContext => ({
  sceneId: scene,
  actorId: npc,
  transcript,
  ...over,
});

describe("#21 AgentNpc — single-turn NPC backed by a generate() seam", () => {
  test("takeTurn returns the generated prose as a speak", async () => {
    const seen: string[] = [];
    const sut = new AgentNpc({
      persona: "你是一名老练佣兵，话少、刀快。",
      generate: async (prompt) => {
        seen.push(prompt);
        return "  哼，下次踹门我就拔刀。  ";
      },
    });

    const turn = await sut.takeTurn(ctx());
    expect(turn).toEqual({ kind: "speak", prose: "哼，下次踹门我就拔刀。" }); // trimmed

    // The prompt it was handed carries persona + the scene transcript.
    expect(seen[0]).toContain("老练佣兵");
    expect(seen[0]).toContain("酒馆的门被一脚踹开。");
  });

  test("empty / whitespace generation maps to an explicit pass (nothing to add)", async () => {
    const sut = new AgentNpc({ persona: "沉默的守卫。", generate: async () => "   " });
    expect(await sut.takeTurn(ctx())).toEqual({ kind: "pass" });
  });

  test("shouldSpeak is always true in v1 (wake-gate deferred, ADR-0010)", async () => {
    const sut = new AgentNpc({ persona: "x", generate: async () => "y" });
    expect(await sut.shouldSpeak!(ctx())).toBe(true);
  });
});

describe("#21 buildNpcPrompt — pure assembly", () => {
  test("embeds the persona and the visible transcript", () => {
    const prompt = buildNpcPrompt({
      persona: "你是吟游诗人 Lyra，爱用比喻。",
      transcript,
    });
    expect(prompt).toContain("吟游诗人 Lyra");
    expect(prompt).toContain("酒馆的门被一脚踹开。");
  });
});
