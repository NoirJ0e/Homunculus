import { describe, expect, test } from "vitest";
import { withTimeoutRetry, type Clock } from "../src/adapters/agent-sdk/timeout-npc.js";

/**
 * FakeClock — a deterministic, manually-advanced clock for the timeout/retry/budget
 * unit tests. No real wall clock: `now()` returns a virtual ms counter, `delay(ms)`
 * registers a pending timer that fires only when the test calls `advance(ms)`.
 * `cancel()` (the seam's retry/abandon path) drops a timer so it never resolves.
 */
class FakeClock implements Clock {
  private current = 0;
  private timers: Array<{ at: number; resolve: () => void; live: boolean }> = [];

  now(): number {
    return this.current;
  }

  delay(ms: number): { promise: Promise<void>; cancel: () => void } {
    const timer = { at: this.current + ms, resolve: () => {}, live: true };
    const promise = new Promise<void>((resolve) => {
      timer.resolve = resolve;
    });
    this.timers.push(timer);
    return {
      promise,
      cancel: () => {
        timer.live = false;
      },
    };
  }

  /** Advance virtual time, firing every live timer whose deadline is now due. */
  async advance(ms: number): Promise<void> {
    this.current += ms;
    for (const t of this.timers) {
      if (t.live && t.at <= this.current) {
        t.live = false;
        t.resolve();
      }
    }
    // Let microtasks chained off the fired timers settle.
    await Promise.resolve();
    await Promise.resolve();
  }
}

const opts = { timeoutMs: 30_000, maxAttempts: 3, totalBudgetMs: 90_000 };

describe("#53 withTimeoutRetry — agent-slot timeout + retry decorator", () => {
  test("(a) attempt completes before timeout → returns its prose", async () => {
    const clock = new FakeClock();
    const generate = async () => "the wizard nods";
    const wrapped = withTimeoutRetry(generate, opts, clock);

    await expect(wrapped("prompt")).resolves.toBe("the wizard nods");
  });

  test("(b) attempt times out, then a fresh retry succeeds → returns retry's prose", async () => {
    const clock = new FakeClock();
    let call = 0;
    // Attempt 1 never resolves (stuck); attempt 2 resolves immediately.
    const generate = (_prompt: string): Promise<string> => {
      call += 1;
      if (call === 1) return new Promise<string>(() => {});
      return Promise.resolve("the retry speaks");
    };
    const wrapped = withTimeoutRetry(generate, opts, clock);

    const pending = wrapped("prompt");
    // Trip the first attempt's timeout → decorator abandons it and starts fresh.
    await clock.advance(opts.timeoutMs);

    await expect(pending).resolves.toBe("the retry speaks");
    expect(call).toBe(2);
  });

  test("(c) every attempt times out, attempts exhausted → returns \"\"", async () => {
    const clock = new FakeClock();
    let call = 0;
    const generate = (_prompt: string): Promise<string> => {
      call += 1;
      return new Promise<string>(() => {}); // always stuck
    };
    const wrapped = withTimeoutRetry(generate, opts, clock);

    const pending = wrapped("prompt");
    // Trip the timeout once per attempt; budget is generous so attempts decide.
    for (let i = 0; i < opts.maxAttempts; i += 1) {
      await clock.advance(opts.timeoutMs);
    }

    await expect(pending).resolves.toBe("");
    expect(call).toBe(opts.maxAttempts);
  });

  test("(d) total budget exhausted before maxAttempts → returns \"\"", async () => {
    // Budget (50s) < timeoutMs * maxAttempts (30s * 3): the budget, not the
    // attempt counter, must stop the loop. Attempt 1 burns 30s; the remaining
    // 20s is too little to be worth another full attempt → bail to "".
    const clock = new FakeClock();
    let call = 0;
    const generate = (_prompt: string): Promise<string> => {
      call += 1;
      return new Promise<string>(() => {}); // always stuck
    };
    const wrapped = withTimeoutRetry(
      generate,
      { timeoutMs: 30_000, maxAttempts: 3, totalBudgetMs: 50_000 },
      clock,
    );

    const pending = wrapped("prompt");
    await clock.advance(30_000); // attempt 1 times out; 20s budget left
    await clock.advance(30_000); // would-be attempt 2 trips; budget now gone

    await expect(pending).resolves.toBe("");
    // Budget cut in before the 3rd attempt was ever started.
    expect(call).toBeLessThan(3);
  });

  test("(e) config-driven thresholds are honored (timeoutMs, maxAttempts, totalBudgetMs)", async () => {
    // A bespoke config: small per-attempt window, 5 attempts allowed, but a
    // budget that only affords 4 of them. Each attempt is stuck → exhaustion → "".
    const clock = new FakeClock();
    let call = 0;
    const generate = (_prompt: string): Promise<string> => {
      call += 1;
      return new Promise<string>(() => {});
    };
    const wrapped = withTimeoutRetry(
      generate,
      { timeoutMs: 1_000, maxAttempts: 5, totalBudgetMs: 4_000 },
      clock,
    );

    const pending = wrapped("prompt");
    for (let i = 0; i < 5; i += 1) await clock.advance(1_000);

    await expect(pending).resolves.toBe("");
    // The 4s budget (not the 5-attempt cap) bounds it to 4 attempts.
    expect(call).toBe(4);
  });
});
