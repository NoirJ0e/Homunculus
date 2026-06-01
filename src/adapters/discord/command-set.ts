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
}

/** Human-facing descriptions used when registering the commands as guild application commands. */
export const COMMAND_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "create-character-card": "Start building your character — opens your private card thread.",
  "verify-card": "Submit your character card for review (or resubmit after edits).",
  "start-game": "Owner only: start the game once every roster card is verified.",
  "approve": "Owner only: approve a verifier exception for the campaign.",
  "set-roster": "Owner only: declare the campaign roster (who may create cards).",
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
    { name: "set-roster", scope: "owner", handler: handlers.setRoster },
  ];
}
