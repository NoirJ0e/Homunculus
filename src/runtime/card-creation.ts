import type { DiscordClient } from "../adapters/discord/discord-substrate.js";
import type { CharacterSheet, DiceSystem } from "../ports/card-store.js";
import type { PersonaSeed } from "../domain/soul.js";
import { createSoul } from "../domain/soul.js";
import { postAssistantText } from "./runners.js";
import type { CardCreationSession } from "./card-creation-session.js";

/**
 * card-creation.ts — the headless seams of the open-card assistant (ADR-0012
 * Phase 5, #34). The live `query()`/LLM that actually chats with the player is
 * the HITL glue (it lives in runners.ts, like the concierge); these two pieces
 * are the unit-tested seams it composes:
 *
 *   - {@link postCardAssistantText}: post the assistant's replies into the open-
 *     card THREAD as the 开卡向导 persona (reuses {@link postAssistantText} so the
 *     "[ready] 但完全没反应" invisible-agent bug can't recur here either).
 *   - {@link holdInitialDrafts}: turn a settled persona concept into a PENDING
 *     soul + sheet draft held ON THE SESSION (not bound to any store — binding
 *     is verify-pass, #35).
 *
 * STAT GENERATION (#43, ADR-0013):
 *   The mechanical sheet is now a STRUCTURED per-system baseline carrying exactly
 *   what the BCDice judge needs — CoC7 occupation + 八大属性 + skill%; D&D5e
 *   race/class/level + six ability scores + proficiencies. The values are a sane
 *   standard build (CoC7 baseline percentiles; D&D5e standard array); the live
 *   open-card assistant personalises them in-conversation (the HITL layer wired
 *   at the live check loop, #44). Cards stay ours — BCDice judges, never owns.
 */

/** The persona "开卡向导" under which open-card assistant replies are posted. */
export const CARD_ASSISTANT_PERSONA = "开卡向导";

/**
 * Structured CoC7 baseline — a 1920s mortal investigator: occupation + the eight
 * characteristics + occupation-flavoured skill percentages + sanity. NO race/
 * class/level (those are D&D constructs the verifier rejects under coc7).
 */
export const STANDARD_COC7_SHEET: CharacterSheet = {
  system: "coc7",
  occupation: "记者",
  attributes: { 力量: 50, 体质: 55, 体型: 60, 敏捷: 65, 外貌: 55, 智力: 70, 意志: 60, 教育: 75 },
  skills: {
    侦查: 60,
    聆听: 55,
    图书馆使用: 60,
    话术: 50,
    闪避: 35,
    斗殴: 25,
    母语: 75,
  },
  sanity: 60,
};

/**
 * Structured D&D5e baseline — a level-1 build: race + class + the standard array
 * across the six abilities + proficient saves/skills. The BCDice adapter (#42)
 * folds ability modifier + proficiency bonus into the `±mod` it sends BCDice.
 */
export const STANDARD_DND5E_SHEET: CharacterSheet = {
  system: "dnd5e",
  race: "人类",
  characterClass: "战士",
  level: 1,
  attributes: { 力量: 15, 敏捷: 14, 体质: 13, 智力: 12, 感知: 10, 魅力: 8 },
  proficiencies: ["力量豁免", "体质豁免", "运动", "察觉"],
  skills: {},
};

/**
 * The structured baseline sheet matching a campaign's rule SYSTEM — keyed by
 * system so a card in a dnd5e campaign isn't stuck with a CoC7 sheet (which the
 * verifier would rightly reject as system-incompatible). The live assistant
 * personalises it; this is the structurally-complete starting point.
 */
export function defaultSheetFor(system: DiceSystem): CharacterSheet {
  return system === "dnd5e" ? STANDARD_DND5E_SHEET : STANDARD_COC7_SHEET;
}

/**
 * The default genesis ARCHETYPE matching a campaign's rule SYSTEM (#47). Symmetric
 * to {@link defaultSheetFor}: the persona must be題材相符 too, so a CoC7 campaign's
 * empty seat fills with an investigator ("调查员") rather than the D&D fighter
 * "战士" (the bug — a 1920s 克苏鲁 团冒出「AI 战士」). Each value is a key in the
 * genesis `ARCHETYPE_PRESETS`, so it resolves to a real system-appropriate persona.
 */
export function defaultArchetypeFor(system: DiceSystem): string {
  return system === "dnd5e" ? "战士" : "调查员";
}

/**
 * Drain the open-card assistant's streaming reply and post each text block into
 * the thread as 开卡向导. Thin wrapper over {@link postAssistantText} pinning the
 * persona; the live runner passes the real `query()` stream.
 */
export async function postCardAssistantText(
  client: DiscordClient,
  threadId: string,
  stream: AsyncIterable<unknown>,
): Promise<void> {
  await postAssistantText(client, threadId, CARD_ASSISTANT_PERSONA, stream);
}

/**
 * Hold a PENDING soul + sheet draft on the session from a settled persona
 * concept. The soul takes the session's actor id (so verify-bind, #35, can save
 * it under the right actor); the sheet is the structured baseline for the
 * campaign's rule SYSTEM (so a dnd5e card isn't born with a CoC7 sheet). Nothing
 * is persisted here — the drafts live on the session until verify-pass.
 */
export function holdInitialDrafts(
  session: CardCreationSession,
  persona: PersonaSeed,
  system: DiceSystem,
): void {
  session.holdSoulDraft(createSoul(session.actorId, persona));
  session.holdSheetDraft(defaultSheetFor(system));
}
