import type { DicePort, RollRequest, RollResult } from "../../ports/dice.js";
import type { CardStore } from "../../ports/card-store.js";

/**
 * BcdiceDice — the BCDice-backed {@link DicePort} (ADR-0013), production
 * mechanical-judge for the CoC7 path (#40). It reads mechanical values from a
 * {@link CardStore} (cards stay ours — BCDice only judges), builds the system's
 * dice command, and maps BCDice's structured verdict back into a {@link RollResult}.
 *
 * BCDice's command syntax (`CC<=`, system-specific) and its Opal-internal RNG are
 * sealed behind the injected {@link BcdiceEvaluator} seam, so the engine/AIDM only
 * ever see the port and unit tests stay deterministic. `NativeDice` remains the
 * offline/test fallback on the same port. The D&D5e path lands in #42.
 */

/** One die BCDice rolled, from its `detailedRands` (e.g. `tens_d10` value 30). */
export interface BcdiceRand {
  readonly kind: string;
  readonly sides: number;
  readonly value: number;
}

/** BCDice's structured verdict for one evaluated command. */
export interface BcdiceEval {
  readonly text: string;
  readonly success: boolean;
  readonly failure: boolean;
  readonly critical: boolean;
  readonly fumble: boolean;
  readonly detailedRands: ReadonlyArray<BcdiceRand>;
}

/**
 * The BCDice evaluation seam: load a game system and evaluate one command,
 * returning the structured verdict (or `null` if the system doesn't recognize
 * the command). The real implementation wraps npm `bcdice`; tests stub it.
 */
export interface BcdiceEvaluator {
  eval(systemId: string, command: string): Promise<BcdiceEval | null>;
}

/** Our {@link DiceSystem} → BCDice game-system id. D&D5e arrives with #42. */
const SYSTEM_ID: Readonly<Record<string, string>> = { coc7: "Cthulhu7th" };

export class BcdiceDice implements DicePort {
  constructor(
    private readonly cards: CardStore,
    private readonly evaluator: BcdiceEvaluator,
  ) {}

  async roll(req: RollRequest): Promise<RollResult> {
    const sheet = this.cards.read(req.actorId);
    if (!sheet) {
      throw new Error(`BcdiceDice: no character sheet for "${req.actorId}"`);
    }
    if (sheet.system !== "coc7") {
      throw new Error(`BcdiceDice: system "${sheet.system}" not supported yet (D&D5e: #42)`);
    }

    const skill = sheet.skills[req.skill] ?? 0;
    const threshold = coc7Threshold(skill, req.difficulty);
    const systemId = SYSTEM_ID.coc7 as string;
    const command = `CC<=${threshold}`;

    const ev = await this.evaluator.eval(systemId, command);
    if (!ev) {
      throw new Error(`BcdiceDice: "${command}" not recognized by ${systemId}`);
    }

    const total = coc7D100(ev.detailedRands);
    const tier = ev.critical ? "大成功" : ev.fumble ? "大失败" : ev.success ? "成功" : "失败";
    const detail = `${command} → ${total} → ${tier}（${req.skill}）`;

    return { actorId: req.actorId, skill: req.skill, total, success: ev.success, detail };
  }
}

/** CoC7 difficulty bands collapse the success threshold (ADR-0001 semantics). */
function coc7Threshold(skill: number, difficulty: string | undefined): number {
  if (difficulty === "hard") return Math.floor(skill / 2);
  if (difficulty === "extreme") return Math.floor(skill / 5);
  return skill;
}

/**
 * Compose the d100 from BCDice's detailed dice: a `tens_d10` (already 0,10,…,90)
 * plus a `normal` d10 whose 10 reads as 0; an all-zeros roll is 100, not 0.
 */
function coc7D100(rands: ReadonlyArray<BcdiceRand>): number {
  const tens = rands.find((d) => d.kind === "tens_d10")?.value ?? 0;
  const units = (rands.find((d) => d.kind === "normal")?.value ?? 0) % 10;
  const roll = tens + units;
  return roll === 0 ? 100 : roll;
}
