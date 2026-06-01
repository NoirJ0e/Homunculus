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
 * v1 STAT GENERATION — FLAGGED SIMPLIFICATION:
 *   The mechanical sheet draft is a single fixed COC7 baseline template
 *   ({@link DEFAULT_COC7_SHEET}) rather than rolled / assistant-proposed / point-
 *   buy values. ADR-0012's plan explicitly leaves the open-card stat-generation
 *   detail (模板 vs 系统掷骰 vs 手填) undecided for this slice, and ADR-0001 has the
 *   whole mechanical-values domain eventually carved out to SealDice. So we hold
 *   the simplest defensible default and flag it; tightening (roll/point-buy) and
 *   the verify-bind promotion are downstream (#35).
 */

/** The persona "开卡向导" under which open-card assistant replies are posted. */
export const CARD_ASSISTANT_PERSONA = "开卡向导";

/**
 * v1 flagged baseline sheet — a flat COC7 skill template. Placeholder until the
 * stat-generation decision lands (see module doc / ADR-0012 plan留白; ADR-0001).
 */
export const DEFAULT_COC7_SHEET: CharacterSheet = {
  system: "coc7",
  skills: {
    侦查: 25,
    聆听: 20,
    图书馆使用: 20,
    话术: 5,
    闪避: 30,
    斗殴: 25,
  },
};

/**
 * v1 flagged baseline sheet for D&D 5e — a standard-array ability spread.
 * Placeholder like {@link DEFAULT_COC7_SHEET} (SealDice owns the real sheet,
 * ADR-0001); its job here is only to make the card's `system` MATCH the
 * campaign's so the verifier's system-fit check doesn't falsely reject.
 */
export const DEFAULT_DND5E_SHEET: CharacterSheet = {
  system: "dnd5e",
  skills: { 力量: 15, 敏捷: 13, 体质: 14, 智力: 10, 感知: 12, 魅力: 8 },
  modifiers: { 力量: 2, 敏捷: 1, 体质: 2, 智力: 0, 感知: 1, 魅力: -1 },
};

/**
 * The v1 placeholder baseline sheet matching a campaign's rule SYSTEM. The
 * open-card assistant doesn't yet emit a structured sheet, so this is the
 * fallback — keyed by system so a card in a dnd5e campaign isn't stuck with a
 * CoC7 sheet (which the verifier would rightly reject as system-incompatible).
 */
export function defaultSheetFor(system: DiceSystem): CharacterSheet {
  return system === "dnd5e" ? DEFAULT_DND5E_SHEET : DEFAULT_COC7_SHEET;
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
 * it under the right actor); the sheet is the v1 flagged baseline. Nothing is
 * persisted here — the drafts live on the session until verify-pass.
 */
export function holdInitialDrafts(session: CardCreationSession, persona: PersonaSeed): void {
  session.holdSoulDraft(createSoul(session.actorId, persona));
  session.holdSheetDraft(DEFAULT_COC7_SHEET);
}
