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
