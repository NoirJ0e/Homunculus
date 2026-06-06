/**
 * trace-sink.ts — the observability port (v2 调优基建).
 *
 * Every agent (AIDM / NPC) runs as an Agent-SDK `query()` whose message stream
 * the runtime normally DISCARDS (see dm-driver). A {@link TraceSink} taps that
 * stream so we can SEE, per agent per beat: what context it received (incl. the
 * meagre tool returns), its thinking (methodology / why it did or did NOT call a
 * tool), its prose, and every tool call + result. This is the foundation for
 * both eyeball debugging (no more spinning up a Discord channel per test) and
 * the check-initiation eval harness (which scores the recorded trace).
 *
 * The event model is deliberately I/O-free and timestamp-free so the pure tap
 * ({@link import("../adapters/agent-sdk/trace-tap.js")}) that derives events from
 * SDK messages stays deterministic + unit-testable; the file adapter stamps time
 * on write.
 */

/** One observed moment in an agent's turn. `agent` is a label (e.g. "aidm",
 *  "npc:铁拳·冈"); `runId` groups all events of one session/scenario. */
export type TraceEvent =
  | { readonly kind: "turn-start"; readonly runId: string; readonly agent: string }
  /** The model's extended-thinking block — methodology, step choice, and the
   *  ONLY place a *decision not to call a tool* leaves a trace. */
  | { readonly kind: "thinking"; readonly runId: string; readonly agent: string; readonly text: string }
  /** Assistant prose (narration / reply). */
  | { readonly kind: "text"; readonly runId: string; readonly agent: string; readonly text: string }
  /** The agent invoked a tool — name + raw args. */
  | {
      readonly kind: "tool-use";
      readonly runId: string;
      readonly agent: string;
      readonly tool: string;
      readonly args: unknown;
    }
  /** A tool returned — this is where e.g. `await_actors` exposes that the AIDM
   *  only got "released: N post(s)" and not the players' prose. */
  | { readonly kind: "tool-result"; readonly runId: string; readonly agent: string; readonly result: string }
  | { readonly kind: "turn-end"; readonly runId: string; readonly agent: string }
  | { readonly kind: "error"; readonly runId: string; readonly agent: string; readonly error: string };

/** Where trace events go. The file adapter appends JSONL (machine, for the eval
 *  harness) + a rendered markdown view (human, for eyeballing). */
export interface TraceSink {
  record(event: TraceEvent): void;
}
