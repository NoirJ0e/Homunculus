import type { SealDicePort, RollRequest, RollResult } from "../../ports/sealdice.js";
import type { CardStore } from "../../ports/card-store.js";

/**
 * NativeDice — the v1 TS-native dice/judge (ADR-0001 修订). It implements the
 * {@link SealDicePort} abstraction (the boundary is kept) but resolves checks
 * itself in TypeScript instead of delegating to a SealDice sidecar.
 *
 * Purely deterministic: all randomness flows through an injected `rng: () =>
 * number` returning [0,1). No `Math.random`, no clock, no network — tests pass
 * a scripted rng to make every roll reproducible. It reads mechanical values
 * from a {@link CardStore}; it is, in v1, the sole authority over those values.
 *
 * This lives in an adapter ring (not the engine) precisely because concrete
 * mechanics live here; the engine only depends on the port.
 */
export class NativeDice implements SealDicePort {
  constructor(
    private readonly cards: CardStore,
    private readonly rng: () => number,
  ) {}

  async roll(req: RollRequest): Promise<RollResult> {
    const sheet = this.cards.read(req.actorId);
    if (!sheet) {
      throw new Error(`NativeDice: no character sheet for "${req.actorId}"`);
    }
    if (sheet.system === "coc7") return this.rollCoc7(req, sheet.skills[req.skill] ?? 0);
    return this.rollDnd5e(req, sheet.skills[req.skill] ?? 0, sheet.modifiers?.[req.skill] ?? 0);
  }

  /** d100 ≤ threshold; hard = ⌊skill/2⌋, extreme = ⌊skill/5⌋ (ADR-0001). */
  private rollCoc7(req: RollRequest, skill: number): RollResult {
    const roll = this.die(100);
    const threshold =
      req.difficulty === "hard"
        ? Math.floor(skill / 2)
        : req.difficulty === "extreme"
          ? Math.floor(skill / 5)
          : skill;
    const success = roll <= threshold;
    const detail = `d100=${roll} ${success ? "≤" : ">"} ${threshold} ${req.skill} → ${
      success ? "成功" : "失败"
    }`;
    return { actorId: req.actorId, skill: req.skill, total: roll, success, detail };
  }

  /** d20 + modifier ≥ DC. Difficulty carries the DC as `"dc15"` or `"15"`. */
  private rollDnd5e(req: RollRequest, _skill: number, modifier: number): RollResult {
    const roll = this.die(20);
    const total = roll + modifier;
    const dc = parseDc(req.difficulty);
    const success = total >= dc;
    const mod = modifier >= 0 ? `+${modifier}` : `${modifier}`;
    const detail = `d20=${roll}${mod}=${total} ${success ? "≥" : "<"} ${dc} ${req.skill} → ${
      success ? "成功" : "失败"
    }`;
    return { actorId: req.actorId, skill: req.skill, total, success, detail };
  }

  /** A fair die in [1, sides] from the injected rng. */
  private die(sides: number): number {
    return Math.floor(this.rng() * sides) + 1;
  }
}

/** Pull the DC number out of a difficulty band like `"dc15"` or `"15"`; default 10. */
function parseDc(difficulty: string | undefined): number {
  if (difficulty === undefined) return 10;
  const match = difficulty.match(/\d+/);
  return match ? Number(match[0]) : 10;
}
