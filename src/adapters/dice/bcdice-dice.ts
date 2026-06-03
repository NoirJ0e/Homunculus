import type { DicePort, RollRequest, RollResult } from "../../ports/dice.js";
import type { CardStore, CharacterSheet } from "../../ports/card-store.js";

/**
 * BcdiceDice — the BCDice-backed {@link DicePort} (ADR-0013), production
 * mechanical-judge for CoC7 (#40) and D&D5e (#42). It reads mechanical values
 * from a {@link CardStore} (cards stay ours — BCDice only judges), builds the
 * system's dice command, and maps BCDice's structured verdict back into a
 * {@link RollResult}.
 *
 * BCDice's command syntax (`CC<=`, `AR`, `AT`, system-specific) and its
 * Opal-internal RNG are sealed behind the injected {@link BcdiceEvaluator} seam,
 * so the engine/AIDM only ever see the port and unit tests stay deterministic.
 * `NativeDice` remains the offline/test fallback on the same port.
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

/** Our {@link RuleSystem} → BCDice game-system id. Exported so the `/roll` free-
 *  expression handler can resolve the campaign's system id without re-hardcoding. */
export const SYSTEM_ID: Readonly<Record<string, string>> = {
  coc7: "Cthulhu7th",
  dnd5e: "DungeonsAndDragons5",
};

/**
 * D&D5e skill → backing ability (in Chinese ability names matching CharacterSheet
 * `attributes`). Covers the standard 18 skills + 6 saving throws.
 * If a skill is absent the adapter falls back to ability mod 0.
 */
const DND5E_SKILL_ABILITY: Readonly<Record<string, string>> = {
  // ── 力量 (Strength) ─────────────────────────────────────────────────────
  运动: "力量",
  力量豁免: "力量",
  /** Generic melee attack — uses Strength (caller may override by passing a
   *  more specific skill name, e.g. "潜行攻击" won't be in the table). */
  攻击: "力量",
  // ── 敏捷 (Dexterity) ────────────────────────────────────────────────────
  特技: "敏捷",
  潜行: "敏捷",
  手法: "敏捷",
  敏捷豁免: "敏捷",
  // ── 体质 (Constitution) ─────────────────────────────────────────────────
  体质豁免: "体质",
  // ── 智力 (Intelligence) ─────────────────────────────────────────────────
  奥秘: "智力",
  历史: "智力",
  调查: "智力",
  自然: "智力",
  宗教: "智力",
  智力豁免: "智力",
  // ── 感知 (Wisdom) ────────────────────────────────────────────────────────
  驯兽: "感知",
  洞悉: "感知",
  医疗: "感知",
  察觉: "感知",
  求生: "感知",
  感知豁免: "感知",
  // ── 魅力 (Charisma) ─────────────────────────────────────────────────────
  欺骗: "魅力",
  恐吓: "魅力",
  表演: "魅力",
  说服: "魅力",
  魅力豁免: "魅力",
};

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

    if (sheet.system === "coc7") return this.rollCoc7(req, sheet);
    if (sheet.system === "dnd5e") return this.rollDnd5e(req, sheet);

    throw new Error(`BcdiceDice: system "${sheet.system}" not supported`);
  }

  // ── CoC7 path ─────────────────────────────────────────────────────────────

  private async rollCoc7(req: RollRequest, sheet: CharacterSheet): Promise<RollResult> {
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

  // ── D&D5e path (#42) ──────────────────────────────────────────────────────

  private async rollDnd5e(req: RollRequest, sheet: CharacterSheet): Promise<RollResult> {
    const mod = dnd5eMod(req.skill, sheet);
    const dc = parseDc(req.difficulty);
    const adv = req.advantage;
    const isAttack = req.mode === "attack";

    // Build BCDice command: AR±mod>=DC[A|D] for checks, AT±mod>=AC[A|D] for attacks
    const prefix = isAttack ? "AT" : "AR";
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    const advSuffix = adv === "advantage" ? "A" : adv === "disadvantage" ? "D" : "";
    const command = `${prefix}${modStr}>=${dc}${advSuffix}`;

    const systemId = SYSTEM_ID.dnd5e as string;
    const ev = await this.evaluator.eval(systemId, command);
    if (!ev) {
      throw new Error(`BcdiceDice: "${command}" not recognized by ${systemId}`);
    }

    // Extract chosen d20: advantage = max of two d20 rands; disadvantage = min; else first
    const d20Rands = ev.detailedRands.filter((d) => d.kind === "normal" && d.sides === 20);
    const chosenD20 = dnd5eChosenD20(d20Rands, adv);
    const total = chosenD20 + mod;

    // Tier naming: attack crits/fumbles use 暴击/大失败; checks use 大成功/失败
    const tier = ev.critical
      ? isAttack
        ? "大成功(暴击)"
        : "大成功"
      : ev.fumble
        ? "大失败"
        : ev.success
          ? "成功"
          : "失败";
    const detail = `${command} → ${total} → ${tier}（${req.skill}）`;

    return { actorId: req.actorId, skill: req.skill, total, success: ev.success, detail };
  }
}

// ── CoC7 helpers ─────────────────────────────────────────────────────────────

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

// ── D&D5e helpers ─────────────────────────────────────────────────────────────

/**
 * Compose the total D&D5e modifier from the sheet:
 *   ability_mod = floor((abilityScore − 10) / 2)
 *   proficiency_bonus = 2 + floor((level − 1) / 4)  (standard 5e progression)
 *   total_mod = ability_mod + (proficient ? proficiency_bonus : 0)
 *
 * The skill→ability mapping uses {@link DND5E_SKILL_ABILITY}; unknown skills
 * fall back to ability mod 0.
 */
function dnd5eMod(skill: string, sheet: CharacterSheet): number {
  const abilityName = DND5E_SKILL_ABILITY[skill];
  const abilityScore = abilityName !== undefined ? (sheet.attributes?.[abilityName] ?? 10) : 10;
  const abilityMod = Math.floor((abilityScore - 10) / 2);

  const level = sheet.level ?? 1;
  const pb = 2 + Math.floor((level - 1) / 4);
  const proficient = sheet.proficiencies?.includes(skill) ?? false;

  return abilityMod + (proficient ? pb : 0);
}

/** Pull the DC/AC number out of a difficulty string like `"dc15"`, `"15"`. Default 10. */
function parseDc(difficulty: string | undefined): number {
  if (difficulty === undefined) return 10;
  const match = difficulty.match(/\d+/);
  return match ? Number(match[0]) : 10;
}

/**
 * Pick the chosen d20 value from the detailedRands based on advantage mode:
 * - advantage    → max of the two d20s
 * - disadvantage → min of the two d20s
 * - straight     → the single d20 (first found)
 */
function dnd5eChosenD20(
  d20Rands: ReadonlyArray<BcdiceRand>,
  adv: "advantage" | "disadvantage" | undefined,
): number {
  if (d20Rands.length === 0) return 0;
  if (adv === "advantage") {
    return d20Rands.reduce((max, d) => (d.value > max ? d.value : max), d20Rands[0]?.value ?? 0);
  }
  if (adv === "disadvantage") {
    return d20Rands.reduce((min, d) => (d.value < min ? d.value : min), d20Rands[0]?.value ?? 0);
  }
  return d20Rands[0]?.value ?? 0;
}
