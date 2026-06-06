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
 * class/level (those are D&D constructs the verifier rejects under coc7). This is
 * the generic 调查员 — the system default AND the `调查员` entry in
 * {@link COC7_ARCHETYPE_SHEETS}.
 */
export const STANDARD_COC7_SHEET: CharacterSheet = {
  system: "coc7",
  occupation: "调查员",
  attributes: { 力量: 50, 体质: 55, 体型: 60, 敏捷: 65, 外貌: 55, 智力: 70, 意志: 60, 教育: 75 },
  skills: {
    侦查: 60,
    聆听: 55,
    图书馆使用: 60,
    话术: 50,
    心理学: 50,
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
 * CoC7 archetype → structured sheet (#47). CoC7 checks read `skills`
 * (see bcdice-dice rollCoc7), so each occupation carries its own check-driving
 * skill spread + attribute emphasis — a 医生 rolls 医学, a 私家侦探 rolls 侦查.
 * `调查员` IS {@link STANDARD_COC7_SHEET} (the system default, same reference).
 */
export const COC7_ARCHETYPE_SHEETS: Readonly<Record<string, CharacterSheet>> = {
  调查员: STANDARD_COC7_SHEET,
  记者: {
    system: "coc7",
    occupation: "记者",
    attributes: { 力量: 45, 体质: 50, 体型: 55, 敏捷: 60, 外貌: 65, 智力: 70, 意志: 55, 教育: 70 },
    skills: { 话术: 65, 图书馆使用: 60, 侦查: 55, 聆听: 50, 摄影: 45, 心理学: 45, 闪避: 30, 母语: 75 },
    sanity: 55,
  },
  私家侦探: {
    system: "coc7",
    occupation: "私家侦探",
    attributes: { 力量: 60, 体质: 60, 体型: 60, 敏捷: 65, 外貌: 50, 智力: 65, 意志: 60, 教育: 55 },
    skills: { 侦查: 70, 聆听: 60, 跟踪: 55, 斗殴: 50, 手枪: 50, 话术: 45, 心理学: 50, 母语: 60 },
    sanity: 60,
  },
  医生: {
    system: "coc7",
    occupation: "医生",
    attributes: { 力量: 45, 体质: 55, 体型: 55, 敏捷: 55, 外貌: 55, 智力: 75, 意志: 60, 教育: 80 },
    skills: { 医学: 70, 急救: 60, 生物学: 55, 心理学: 50, 图书馆使用: 55, 母语: 75, 闪避: 30, 侦查: 40 },
    sanity: 60,
  },
  教授: {
    system: "coc7",
    occupation: "教授",
    attributes: { 力量: 40, 体质: 50, 体型: 55, 敏捷: 50, 外貌: 50, 智力: 80, 意志: 65, 教育: 85 },
    skills: { 图书馆使用: 75, 母语: 80, 历史: 65, 神秘学: 50, 心理学: 50, 侦查: 45, 闪避: 25, 外语: 50 },
    sanity: 65,
  },
  古董商: {
    system: "coc7",
    occupation: "古董商",
    attributes: { 力量: 50, 体质: 55, 体型: 55, 敏捷: 55, 外貌: 60, 智力: 70, 意志: 55, 教育: 70 },
    skills: { 鉴定: 70, 历史: 60, 话术: 55, 估价: 55, 图书馆使用: 50, 母语: 70, 侦查: 45, 闪避: 30 },
    sanity: 60,
  },
};

/**
 * D&D5e archetype → structured sheet (#47). D&D5e checks fold `attributes`
 * (ability mod) + `proficiencies` (proficiency bonus) into the d20 (see
 * bcdice-dice rollDnd5e/dnd5eMod), so each class gets the standard array placed on
 * its priority abilities + class-appropriate proficient saves/skills (skill names
 * match the DND5E_SKILL_ABILITY table). `战士` IS {@link STANDARD_DND5E_SHEET}.
 */
export const DND5E_ARCHETYPE_SHEETS: Readonly<Record<string, CharacterSheet>> = {
  战士: STANDARD_DND5E_SHEET,
  法师: {
    system: "dnd5e",
    race: "人类",
    characterClass: "法师",
    level: 1,
    attributes: { 力量: 8, 敏捷: 14, 体质: 13, 智力: 15, 感知: 12, 魅力: 10 },
    proficiencies: ["智力豁免", "感知豁免", "奥秘", "历史"],
    skills: {},
  },
  游侠: {
    system: "dnd5e",
    race: "人类",
    characterClass: "游侠",
    level: 1,
    attributes: { 力量: 12, 敏捷: 15, 体质: 14, 智力: 8, 感知: 13, 魅力: 10 },
    proficiencies: ["力量豁免", "敏捷豁免", "求生", "察觉"],
    skills: {},
  },
  盗贼: {
    system: "dnd5e",
    race: "人类",
    characterClass: "盗贼",
    level: 1,
    attributes: { 力量: 8, 敏捷: 15, 体质: 13, 智力: 14, 感知: 12, 魅力: 10 },
    proficiencies: ["敏捷豁免", "智力豁免", "手法", "潜行"],
    skills: {},
  },
  牧师: {
    system: "dnd5e",
    race: "人类",
    characterClass: "牧师",
    level: 1,
    attributes: { 力量: 13, 敏捷: 10, 体质: 14, 智力: 8, 感知: 15, 魅力: 12 },
    proficiencies: ["感知豁免", "魅力豁免", "医疗", "宗教"],
    skills: {},
  },
  骑士: {
    system: "dnd5e",
    race: "人类",
    characterClass: "圣武士",
    level: 1,
    attributes: { 力量: 15, 敏捷: 10, 体质: 13, 智力: 8, 感知: 12, 魅力: 14 },
    proficiencies: ["感知豁免", "魅力豁免", "运动", "恐吓"],
    skills: {},
  },
  德鲁伊: {
    system: "dnd5e",
    race: "人类",
    characterClass: "德鲁伊",
    level: 1,
    attributes: { 力量: 10, 敏捷: 13, 体质: 14, 智力: 12, 感知: 15, 魅力: 8 },
    proficiencies: ["智力豁免", "感知豁免", "自然", "驯兽"],
    skills: {},
  },
  骗术师: {
    system: "dnd5e",
    race: "人类",
    characterClass: "吟游诗人",
    level: 1,
    attributes: { 力量: 8, 敏捷: 14, 体质: 13, 智力: 10, 感知: 12, 魅力: 15 },
    proficiencies: ["敏捷豁免", "魅力豁免", "欺骗", "表演"],
    skills: {},
  },
};

/**
 * The structured baseline sheet matching a campaign's rule SYSTEM — keyed by
 * system so a card in a dnd5e campaign isn't stuck with a CoC7 sheet (which the
 * verifier would rightly reject as system-incompatible). The live assistant
 * personalises it; this is the structurally-complete starting point. Equivalently
 * the sheet of the system's default archetype (see {@link sheetForArchetype}).
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
 * The structured sheet for a specific ARCHETYPE within a system (#47). This is the
 * fix to "archetype 只装饰人设、机械卡恒为系统基线": an AI seat (or a card draft)
 * gets a sheet whose check-driving fields (CoC7 `skills`; D&D5e `attributes` +
 * `proficiencies`) actually match the declared archetype. An unrecognised
 * archetype falls back to {@link defaultSheetFor} — always a system-valid sheet
 * the verifier accepts. The values are a sane standard build; the live open-card
 * assistant personalises them.
 */
export function sheetForArchetype(system: DiceSystem, archetype: string): CharacterSheet {
  const table = system === "dnd5e" ? DND5E_ARCHETYPE_SHEETS : COC7_ARCHETYPE_SHEETS;
  return table[archetype] ?? defaultSheetFor(system);
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
