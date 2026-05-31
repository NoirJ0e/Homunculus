import type { ActorId } from "../domain/ids.js";

/**
 * v1 mechanical-values store (ADR-0001 修订). In v1 we hold our own sheets
 * instead of delegating to SealDice; NativeDice reads them to resolve checks.
 *
 * This is deliberately READ-ONLY: there is no write port and no `write_card`
 * tool. The dice authority (NativeDice in v1) is the sole sheet authority; the
 * AIDM only reads (ADR-0001/0002).
 */
export type DiceSystem = "coc7" | "dnd5e";

export interface CharacterSheet {
  readonly system: DiceSystem;
  /** Skill/attribute values, e.g. COC7 `{ 侦查: 60 }` or DND5e `{ 调查: 0 }`. */
  readonly skills: Record<string, number>;
  /** DND5e per-skill ability modifiers (added to the d20). */
  readonly modifiers?: Record<string, number>;
}

export interface CardStore {
  /** The actor's sheet, or `undefined` if it has none on record. */
  read(actor: ActorId): CharacterSheet | undefined;
}
