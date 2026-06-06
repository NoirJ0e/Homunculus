import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TraceEvent, TraceSink } from "../../ports/trace-sink.js";
import { renderTraceEvent } from "./markdown-trace.js";

/**
 * FileTraceSink — appends each {@link TraceEvent} to two files under
 * `<dataDir>/traces/<campaign>/<runId>.{jsonl,md}` (the `data/` tree is
 * gitignored runtime state). JSONL is the machine view the eval harness scores;
 * the markdown is the eyeball view. Time is stamped HERE (the pure tap/renderer
 * stay timestamp-free). Thin I/O shell — the logic worth testing lives in the
 * pure tap + renderer.
 */
export class FileTraceSink implements TraceSink {
  private readonly jsonlPath: string;
  private readonly mdPath: string;

  constructor(dataDir: string, campaign: string, runId: string) {
    const safe = runId.replace(/[^A-Za-z0-9._-]/g, "_");
    const dir = join(dataDir, "traces", campaign);
    mkdirSync(dir, { recursive: true });
    this.jsonlPath = join(dir, `${safe}.jsonl`);
    this.mdPath = join(dir, `${safe}.md`);
  }

  record(event: TraceEvent): void {
    const ts = new Date().toISOString();
    appendFileSync(this.jsonlPath, `${JSON.stringify({ ts, ...event })}\n`, "utf8");
    appendFileSync(this.mdPath, renderTraceEvent(event), "utf8");
  }
}

/** A {@link TraceSink} that drops everything — used when tracing is off. */
export class NullTraceSink implements TraceSink {
  record(): void {
    /* no-op */
  }
}
