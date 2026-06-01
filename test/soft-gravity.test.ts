import { describe, expect, test } from "vitest";
import { selectRung, canQuantumShift, assertNavigationOnly } from "../src/engine/soft-gravity.js";

describe("#11 soft gravity ladder", () => {
  test("gravity escalates with how long the party has stalled (low rungs first)", () => {
    expect(selectRung(0)).toBe("passive-clue");
    expect(selectRung(1)).toBe("passive-clue");
    expect(selectRung(2)).toBe("active-hint");
    expect(selectRung(4)).toBe("world-clock");
    expect(selectRung(6)).toBe("quantum-shift");
    expect(selectRung(9)).toBe("true-fork");
  });

  test("quantum shift is allowed for navigation choices only", () => {
    expect(canQuantumShift("navigation")).toBe(true);
    expect(canQuantumShift("consequential")).toBe(false);
  });

  test("quantum-shifting a consequential (branchPoint) choice is forbidden", () => {
    expect(() => assertNavigationOnly("navigation")).not.toThrow();
    expect(() => assertNavigationOnly("consequential")).toThrow(/consequential|navigation/i);
  });
});
