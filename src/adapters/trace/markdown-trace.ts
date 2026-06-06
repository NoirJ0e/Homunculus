import type { TraceEvent } from "../../ports/trace-sink.js";

/**
 * markdown-trace.ts — PURE rendering of a {@link TraceEvent} to a human-readable
 * markdown fragment (the eyeball view next to the machine-readable JSONL).
 *
 * Kept pure + tested so the trace stays legible regardless of which agent or
 * tool produced it. The file adapter concatenates these fragments per event.
 */

/** Prefix every line of `text` with `> ` so multi-line content stays in one blockquote. */
function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function renderTraceEvent(event: TraceEvent): string {
  switch (event.kind) {
    case "turn-start":
      return `\n### ▶ ${event.agent}\n`;
    case "thinking":
      return `\n> 🧠 **思考**\n${quote(event.text)}\n`;
    case "text":
      return `\n${event.text}\n`;
    case "tool-use":
      return `\n🔧 **${event.tool}**\n\`\`\`json\n${JSON.stringify(event.args ?? null, null, 2)}\n\`\`\`\n`;
    case "tool-result":
      return `\n↩️ ${"`"}${event.result}${"`"}\n`;
    case "turn-end":
      return `\n— turn end —\n`;
    case "error":
      return `\n❌ **error:** ${event.error}\n`;
  }
}
