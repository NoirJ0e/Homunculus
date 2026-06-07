import { describe, expect, test } from "vitest";
import { PauseRegistry } from "../../src/runtime/pause-registry.js";
import { runDmDriver } from "../../src/runtime/dm-driver.js";

/**
 * #55 — `/pause` → held. Any seated player can stop the table: the session goes
 * held and the DM's self-driving loop winds down. Cross-process serialized resume
 * is deferred (ADR-0010); this is only the held trigger + in-process state flip.
 */

describe("PauseRegistry", () => {
  test("a channel is not held until paused; pause flips it; resume clears it (in-process)", () => {
    const reg = new PauseRegistry();
    expect(reg.isHeld("chan-main")).toBe(false);

    reg.pause("chan-main");
    expect(reg.isHeld("chan-main")).toBe(true);
    expect(reg.isHeld("chan-other")).toBe(false); // per-channel, not global

    reg.resume("chan-main");
    expect(reg.isHeld("chan-main")).toBe(false);
  });
});

describe("/pause stops the DM driver loop", () => {
  test("pausing a channel makes its composed isSessionActive false → the loop ends", async () => {
    const reg = new PauseRegistry();
    const chan = "chan-main";
    let runs = 0;

    // The session is globally active; the gate is the pause registry.
    const isSessionActive = () => true && !reg.isHeld(chan);

    await runDmDriver({
      runQuery: () => {
        runs += 1;
        reg.pause(chan); // a player hit /pause during this turn
        return (async function* () {})();
      },
      isSessionActive,
    });

    // The driver ran once, then saw the channel held and did NOT restart.
    expect(runs).toBe(1);
    expect(reg.isHeld(chan)).toBe(true);
  });
});
