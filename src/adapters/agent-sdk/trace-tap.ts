import type { TraceEvent } from "../../ports/trace-sink.js";

/**
 * trace-tap.ts — PURE derivation of {@link TraceEvent}s from an Agent-SDK stream
 * message. The DM driver / NPC generator pass each streamed message through here
 * and forward the results to a {@link import("../../ports/trace-sink.js").TraceSink}.
 *
 * It operates on a STRUCTURAL slice of the SDK message (no SDK import) so it
 * stays dependency-free and unit-testable. Unknown message/block types yield no
 * events (forward-compatible: new block kinds are silently ignored, not crashed).
 */

interface SdkContentBlock {
  readonly type?: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly name?: string; // tool_use
  readonly input?: unknown; // tool_use
  readonly content?: unknown; // tool_result payload
}

interface SdkStreamMessage {
  readonly type?: string;
  readonly error?: string;
  readonly message?: { readonly content?: ReadonlyArray<SdkContentBlock> };
}

/** Flatten a tool_result's `content` (string | array of {type:"text",text}) to text. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : ((b as SdkContentBlock)?.text ?? "")))
      .join("");
  }
  return content === undefined ? "" : JSON.stringify(content);
}

export function messageToTraceEvents(
  agent: string,
  runId: string,
  message: unknown,
): TraceEvent[] {
  const msg = message as SdkStreamMessage;
  // Lifecycle messages frame a turn.
  if (msg.type === "system") return [{ kind: "turn-start", runId, agent }];
  if (msg.type === "result") return [{ kind: "turn-end", runId, agent }];

  const events: TraceEvent[] = [];
  if (msg.error) events.push({ kind: "error", runId, agent, error: msg.error });

  for (const block of msg.message?.content ?? []) {
    switch (block.type) {
      case "text":
        if (block.text) events.push({ kind: "text", runId, agent, text: block.text });
        break;
      case "thinking":
        if (block.thinking) events.push({ kind: "thinking", runId, agent, text: block.thinking });
        break;
      case "tool_use":
        events.push({ kind: "tool-use", runId, agent, tool: block.name ?? "<unknown>", args: block.input });
        break;
      case "tool_result":
        events.push({ kind: "tool-result", runId, agent, result: resultText(block.content) });
        break;
      default:
        break; // unknown block type → ignore (forward-compatible)
    }
  }
  return events;
}
