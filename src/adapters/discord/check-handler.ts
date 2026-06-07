import type { ActorId } from "../../domain/ids.js";
import type { CheckSessionHandle } from "../../runtime/check-session.js";
import type { CommandEvent, CommandHandler } from "./command-router.js";

/**
 * check-handler.ts — the `/check <advantage?>` handler (ADR-0013, #44), wired in
 * as the player-scoped `check` registration.
 *
 * The AIDM declared WHAT to roll via `call_check` (a pending check on the actor);
 * `/check` is the human's TRIGGER — it declares HOW (advantage) and pushes a
 * `{kind:"roll", advantage?}` turn into the channel's live AIDM session inbox,
 * where the engine resolves it via BCDice and the AIDM narrates the result. There
 * is NO AIDM auto-roll: a silent human simply holds the barrier (ADR-0003).
 *
 * Own-check only: the engine's `resolveRoll` already resolves ONLY the calling
 * actor's own pending; this handler additionally short-circuits with a friendly
 * ephemeral reply when the invoker has nothing pending (or no session is live),
 * so the player isn't left waiting on a roll the engine would no-op.
 *
 * Headless: the session lookup, the actor resolver, and the reply are injected.
 */

export interface CheckHandlerDeps {
  /** The channel's live AIDM session (check-capability handle), or undefined. */
  readonly sessionFor: (channelId: string) => CheckSessionHandle | undefined;
  /** Map a Discord invoker id to the actor id the engine keys checks by. */
  readonly resolveActor: (invokerId: string) => ActorId;
  /** Reply to the invoker (live: ephemeral interaction reply; tests: stub). */
  readonly reply: (text: string) => Promise<void>;
}

/**
 * Parse the free STRING `advantage` option. Accepts the Chinese 优势/劣势 (and the
 * ASCII synonyms) → advantage/disadvantage; anything else (incl. empty) → a
 * straight roll. A plain STRING option is registered; we parse it leniently.
 */
function parseAdvantage(raw: string | undefined): "advantage" | "disadvantage" | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "优势" || v === "advantage" || v === "adv") return "advantage";
  if (v === "劣势" || v === "disadvantage" || v === "dis") return "disadvantage";
  return undefined;
}

export function createCheckHandler(deps: CheckHandlerDeps): CommandHandler {
  return async (event: CommandEvent): Promise<void> => {
    const session = deps.sessionFor(event.channelId);
    const actor = deps.resolveActor(event.invokerId);

    if (session === undefined) {
      await deps.reply("你当前没有待掷的检定。");
      return;
    }

    // A pending check (the AIDM already 喊'd it) takes precedence: pull the trigger.
    if (session.hasPending(actor)) {
      const advantage = parseAdvantage(event.options["advantage"]);
      session.deliverTurn({ kind: "roll", ...(advantage !== undefined && { advantage }) });
      return;
    }

    // #54 检定硬请求地板：nothing pending, but the player named a skill → register a
    // hard request the engine forces in front of the DM (DM 定 DC). Without a skill
    // there is nothing to request — keep the friendly nothing-to-roll reply.
    const skill = event.options["skill"]?.trim();
    if (skill) {
      session.requestCheck(actor, skill);
      await deps.reply(`已记下你要的检定「${skill}」，等 DM 定难度后再掷。`);
      return;
    }
    await deps.reply("你当前没有待掷的检定。");
  };
}
