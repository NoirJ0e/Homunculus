/**
 * 软引力阶梯 (soft-gravity ladder) — how the AIDM nudges play toward the next
 * milestone (ADR-0007). It lives entirely inside the fiction; lower rungs are
 * used by default and the higher ones only as a stall persists.
 *
 * The selection is a playtest knob (ADR-0007 後果); the thresholds here are a
 * starting point, deliberately gentle.
 */
export type GravityRung =
  | "passive-clue" // breadcrumbs (三线索原则)
  | "active-hint" // an NPC/event makes a clue explicit
  | "world-clock" // delay advances the villain's plan
  | "quantum-shift" // move prepared content to where the players are
  | "true-fork"; // abandon the milestone, JIT a new branch

export function selectRung(stallBeats: number): GravityRung {
  if (stallBeats >= 9) return "true-fork";
  if (stallBeats >= 6) return "quantum-shift";
  if (stallBeats >= 4) return "world-clock";
  if (stallBeats >= 2) return "active-hint";
  return "passive-clue";
}

/**
 * The kind of choice the gravity is acting on. Navigation ("which corridor")
 * is fungible; consequential ("ally A or B", "save the city or not") is a real
 * branchPoint with genuine agency.
 */
export type ChoiceKind = "navigation" | "consequential";

/**
 * Quantum shift (moving prepared content to the players) is permitted ONLY for
 * navigation choices — never for consequential ones (ADR-0007: 故事抉择是真的,
 * 路线选择可以是假的).
 */
export function canQuantumShift(choice: ChoiceKind): boolean {
  return choice === "navigation";
}

/** Guard: throws if a consequential choice is about to be quantum-shifted. */
export function assertNavigationOnly(choice: ChoiceKind): void {
  if (!canQuantumShift(choice)) {
    throw new Error(
      "quantum shift is forbidden for consequential choices — only navigation may be shifted (ADR-0007)",
    );
  }
}
