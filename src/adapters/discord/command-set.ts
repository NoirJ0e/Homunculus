import type { CommandHandler, CommandRegistration } from "./command-router.js";

/**
 * command-set.ts — the initial slash-command SET per ADR-0012 (#31).
 *
 * ASCII-safe names map to ADR-0012's surfaces:
 *   - create-character-card (player) — 起开卡: launch the player's card-creation thread.
 *   - verify-card           (player) — 交审/复审: kick the verifier feedback loop.
 *   - start-game            (owner)  — /开场: owner-gated AIDM start (roster all-verified guard).
 *   - approve               (owner)  — /批准 <项>: write a verifier exception.
 *   - set-roster            (owner)  — declare the explicit party (who may /create-character-card).
 *   - add-ai-seat           (owner)  — add an AI teammate seat: genesis → SAME verifier → bind (#37).
 *
 * The HANDLERS here are STUBS injected by the caller — real handlers land in the
 * downstream slices (#33–#37). This module only declares the names↔scope wiring
 * and binds the injected handlers into router-ready {@link CommandRegistration}s.
 */

/** The injected stub/real handlers for each command in the set. */
export interface CommandSetHandlers {
  readonly createCharacterCard: CommandHandler;
  readonly verifyCard: CommandHandler;
  readonly startGame: CommandHandler;
  readonly approve: CommandHandler;
  readonly setRoster: CommandHandler;
  /** Owner adds an AI teammate seat — same create→verify→bind path (#37). */
  readonly addAiSeat: CommandHandler;
}

/** Human-facing descriptions used when registering the commands as guild application commands. */
export const COMMAND_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "create-character-card": "Start building your character — opens your private card thread.",
  "verify-card": "Submit your character card for review (or resubmit after edits).",
  "start-game": "Owner only: start the game once every roster card is verified.",
  "approve": "Owner only: approve a verifier exception for the campaign.",
  "set-roster": "Declare the campaign roster (first caller becomes owner; @ yourself to play too).",
  "add-ai-seat": "Owner only: add an AI teammate seat (auto-generated, then reviewed like any card).",
};

/**
 * A slash-command option declaration (the slice of Discord's application-command
 * option object we register). `type` is Discord's ApplicationCommandOptionType:
 * 3 = STRING, 6 = USER (gives the native @-member picker + autocomplete).
 * Option NAMES must be lowercase ASCII (`[a-z0-9_-]`, 1–32) — Discord rejects
 * others — and REQUIRED options must be declared before optional ones.
 */
export interface CommandOption {
  readonly type: 3 | 6;
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
}

/**
 * Per-command option schemas registered with Discord. Without these the slash
 * commands take no arguments — e.g. `/set-roster` showed no `@player` picker.
 * USER options give the native member autocomplete; the handlers read the option
 * values out of {@link CommandEvent.options} by these (ASCII) names.
 */
export const COMMAND_OPTIONS: Readonly<Record<string, readonly CommandOption[]>> = {
  // Up to 5 OTHER players via the native @-picker — all optional, because the
  // invoker (owner) is auto-added to the roster (blindbox: owner is a player,
  // ADR-0007), so you never have to pick yourself (the picker may not surface
  // self in a fresh server). @ here only to add OTHER players.
  "set-roster": [
    { type: 6, name: "player1", description: "另一位玩家（@ 选择；你自己会自动加入，无需 @ 自己）" },
    { type: 6, name: "player2", description: "另一位玩家（可选）" },
    { type: 6, name: "player3", description: "另一位玩家（可选）" },
    { type: 6, name: "player4", description: "另一位玩家（可选）" },
    { type: 6, name: "player5", description: "另一位玩家（可选）" },
  ],
  approve: [
    { type: 3, name: "item", description: "要批准放行的物品/设定", required: true },
    { type: 3, name: "note", description: "备注（可选）" },
  ],
  "add-ai-seat": [
    { type: 3, name: "archetype", description: "AI 队友职业原型，如 战士 / 游侠（可选）" },
    { type: 3, name: "name", description: "AI 队友名字（可选）" },
  ],
};

/**
 * Build the router-ready command set from the injected handlers. Names and
 * scopes are fixed by ADR-0012; handlers are supplied by the caller (stubs in
 * #31, real ones in #33–#37).
 */
export function createCommandSet(handlers: CommandSetHandlers): CommandRegistration[] {
  return [
    { name: "create-character-card", scope: "player", handler: handlers.createCharacterCard },
    { name: "verify-card", scope: "player", handler: handlers.verifyCard },
    { name: "start-game", scope: "owner", handler: handlers.startGame },
    { name: "approve", scope: "owner", handler: handlers.approve },
    // "any" (not "owner") so it can BOOTSTRAP ownership: owner-scoped commands
    // need a stored owner, but the owner is only recorded BY set-roster — a
    // deadlock if it were owner-gated. The handler self-guards: first caller
    // claims the campaign owner; afterward only that owner may change the roster.
    { name: "set-roster", scope: "any", handler: handlers.setRoster },
    { name: "add-ai-seat", scope: "owner", handler: handlers.addAiSeat },
  ];
}
