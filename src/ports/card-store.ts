import type { ActorId } from "../domain/ids.js";

/**
 * Mechanical-values store (ADR-0001 修订, ADR-0013). The cards stay ours — we
 * hold our own sheets and the dice authority (BCDice via DicePort, ADR-0013;
 * NativeDice as fallback) reads them to resolve checks. BCDice judges, it does
 * not own the card.
 *
 * This is deliberately READ-ONLY: there is no write port and no `write_card`
 * tool. The dice authority is the sole sheet authority; the AIDM only reads
 * (ADR-0001/0002). Writes go through the separate `CardWriter` seam.
 */
export type DiceSystem = "coc7" | "dnd5e";

export interface CharacterSheet {
  readonly system: DiceSystem;
  /** Skill values — CoC7 skill percentages `{ 侦查: 60 }`; the dice authority
   *  reads these to resolve CoC7 checks. (DND5e checks derive from `attributes`
   *  + `proficiencies` instead; see below.) */
  readonly skills: Record<string, number>;
  /** DND5e per-skill ability modifiers (added to the d20) — legacy/simple path. */
  readonly modifiers?: Record<string, number>;

  // ── Structured fields (#43, ADR-0013). Optional so legacy `{system,skills}`
  //    sheets stay valid; the BCDice judge (CoC7 #40, DND5e #42) reads them. ──

  /** CoC7: the investigator's occupation (e.g. "记者"). DND5e leaves this unset. */
  readonly occupation?: string;
  /** Core characteristics — CoC7 八大属性 `{力量,体质,体型,敏捷,外貌,智力,意志,教育}`
   *  or DND5e six ability scores `{力量,敏捷,体质,智力,感知,魅力}`. */
  readonly attributes?: Record<string, number>;
  /** CoC7: current sanity (理智). */
  readonly sanity?: number;
  /** DND5e: race (e.g. "半精灵"). A CoC7 sheet must NOT carry this. */
  readonly race?: string;
  /** DND5e: class (e.g. "游侠"). A CoC7 sheet must NOT carry this. */
  readonly characterClass?: string;
  /** DND5e: character level — drives the proficiency bonus. */
  readonly level?: number;
  /** DND5e: proficient skills/saves — they get the proficiency bonus added
   *  (the BCDice adapter folds ability mod + proficiency into the `±mod`). */
  readonly proficiencies?: readonly string[];
}

export interface CardStore {
  /** The actor's sheet, or `undefined` if it has none on record. */
  read(actor: ActorId): CharacterSheet | undefined;
}
