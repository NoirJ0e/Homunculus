/**
 * timeout-npc.ts — an agent-slot timeout + retry decorator at the ADAPTER layer
 * (#53, PRD #50 slice 3). A slow/stuck NPC agent must never freeze the table:
 * this wraps the `generate` seam of {@link AgentNpc} so a single attempt is
 * bounded, a stuck attempt is abandoned for a FRESH one, and a total wall-time
 * budget caps the whole thing. When everything is exhausted with no result it
 * returns `""` — which the engine already treats as a pass (AgentNpc.takeTurn),
 * so the engine never sees a clock and ADR-0003 purity is preserved.
 *
 * The wall clock is injected via the {@link Clock} seam so timeout/retry/budget
 * behaviour is unit-tested deterministically with a fake clock; production wires
 * {@link realClock} (Date.now/setTimeout).
 */

/** The shape of the seam this decorator wraps — same as {@link AgentNpc}'s `generate`. */
export type Generate = (prompt: string) => Promise<string>;

/**
 * Clock — the injectable wall-clock seam. `now()` reads virtual/real time in ms;
 * `delay(ms)` arms a CANCELABLE timer (cancel = abandon a stuck attempt's timeout
 * so it never resolves and cannot leak a late win). No real time leaks into units.
 */
export interface Clock {
  now(): number;
  delay(ms: number): { promise: Promise<void>; cancel: () => void };
}

/**
 * realClock — the production {@link Clock}: real wall time via Date.now, and a
 * setTimeout-backed cancelable delay. `cancel()` clears the timer so an abandoned
 * attempt's timeout neither fires nor keeps the event loop alive (`unref`). Never
 * used in unit tests — those inject a fake clock.
 */
export const realClock: Clock = {
  now: () => Date.now(),
  delay(ms: number) {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<void>((resolve) => {
      handle = setTimeout(resolve, ms);
      handle.unref?.();
    });
    return { promise, cancel: () => clearTimeout(handle) };
  },
};

/** Knobs for the decorator; wired from RuntimeConfig in the composition root. */
export interface TimeoutRetryOptions {
  /** Wall-time budget for a SINGLE attempt before it's abandoned (default 30s). */
  readonly timeoutMs: number;
  /** Total attempts = 1 initial + retries (default 3). */
  readonly maxAttempts: number;
  /** Wall-time budget across ALL attempts (default 90s). */
  readonly totalBudgetMs: number;
}

/**
 * Wrap a `generate` seam so each attempt is bounded by `timeoutMs`, retried up to
 * `maxAttempts` times, and capped by `totalBudgetMs`. Exhaustion → `""` (a pass).
 */
export function withTimeoutRetry(
  generate: Generate,
  opts: TimeoutRetryOptions,
  clock: Clock,
): Generate {
  /** Sentinel resolved by a tripped per-attempt timeout (distinct from any prose). */
  const TIMED_OUT = Symbol("timed-out");

  return async (prompt: string): Promise<string> => {
    const startedAt = clock.now();

    for (let attempt = 0; attempt < opts.maxAttempts; attempt += 1) {
      const remaining = opts.totalBudgetMs - (clock.now() - startedAt);
      // Budget gone (or too thin to give a fresh attempt a fair single window)
      // → stop spending and pass. This is what caps total wall time below
      // timeoutMs * maxAttempts when the budget is the tighter constraint.
      if (remaining < opts.timeoutMs && attempt > 0) break;
      if (remaining <= 0) break;

      const window = Math.min(opts.timeoutMs, remaining);
      const timer = clock.delay(window);
      const timedOut = timer.promise.then(() => TIMED_OUT as typeof TIMED_OUT);

      // Race a FRESH generate against this attempt's timeout. On timeout we
      // abandon the (possibly dead) stream — we never await it — and loop.
      const outcome = await Promise.race([generate(prompt), timedOut]);
      timer.cancel();

      if (typeof outcome === "string") return outcome;
    }
    return "";
  };
}
