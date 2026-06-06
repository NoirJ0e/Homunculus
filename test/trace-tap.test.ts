import { describe, expect, test } from "vitest";
import { messageToTraceEvents } from "../src/adapters/agent-sdk/trace-tap.js";
import { renderTraceEvent } from "../src/adapters/trace/markdown-trace.js";

describe("messageToTraceEvents — derives trace events from SDK stream messages", () => {
  test("a system init message frames a turn start", () => {
    expect(messageToTraceEvents("aidm", "run1", { type: "system", subtype: "init" })).toEqual([
      { kind: "turn-start", runId: "run1", agent: "aidm" },
    ]);
  });

  test("a result message frames a turn end", () => {
    expect(messageToTraceEvents("aidm", "run1", { type: "result" })).toEqual([
      { kind: "turn-end", runId: "run1", agent: "aidm" },
    ]);
  });

  test("captures assistant prose, thinking, and tool calls in order", () => {
    const msg = {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "玩家在攻击——需要命中检定" },
          { type: "text", text: "你举起斧子。" },
          { type: "tool_use", name: "call_check", input: { actor: "player", skill: "格斗" } },
        ],
      },
    };
    expect(messageToTraceEvents("aidm", "run1", msg)).toEqual([
      { kind: "thinking", runId: "run1", agent: "aidm", text: "玩家在攻击——需要命中检定" },
      { kind: "text", runId: "run1", agent: "aidm", text: "你举起斧子。" },
      {
        kind: "tool-use",
        runId: "run1",
        agent: "aidm",
        tool: "call_check",
        args: { actor: "player", skill: "格斗" },
      },
    ]);
  });

  test("flattens a tool_result's content array to text (exposes await_actors's meagre return)", () => {
    const msg = {
      type: "user",
      message: { content: [{ type: "tool_result", content: [{ type: "text", text: "released: 1 post(s)" }] }] },
    };
    expect(messageToTraceEvents("aidm", "run1", msg)).toEqual([
      { kind: "tool-result", runId: "run1", agent: "aidm", result: "released: 1 post(s)" },
    ]);
  });

  test("surfaces an error and ignores unknown block types", () => {
    const msg = {
      type: "assistant",
      error: "boom",
      message: { content: [{ type: "image" }, { type: "text", text: "ok" }] },
    };
    expect(messageToTraceEvents("npc:k", "run1", msg)).toEqual([
      { kind: "error", runId: "run1", agent: "npc:k", error: "boom" },
      { kind: "text", runId: "run1", agent: "npc:k", text: "ok" },
    ]);
  });
});

describe("renderTraceEvent — human-readable markdown", () => {
  test("renders a tool call with its args as a json block", () => {
    const md = renderTraceEvent({
      kind: "tool-use",
      runId: "r",
      agent: "aidm",
      tool: "call_check",
      args: { actor: "player", skill: "格斗" },
    });
    expect(md).toContain("🔧 **call_check**");
    expect(md).toContain('"skill": "格斗"');
  });

  test("renders multi-line thinking as a single blockquote", () => {
    const md = renderTraceEvent({ kind: "thinking", runId: "r", agent: "aidm", text: "line1\nline2" });
    expect(md).toContain("> 🧠 **思考**");
    expect(md).toContain("> line1");
    expect(md).toContain("> line2");
  });
});
