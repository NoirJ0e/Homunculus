import type { RuleSystem } from "../../domain/campaign.js";
import type { BcdiceEvaluator } from "../dice/bcdice-dice.js";
import { SYSTEM_ID } from "../dice/bcdice-dice.js";
import type { CommandEvent, CommandHandler } from "./command-router.js";

/**
 * roll-handler.ts — the `/roll <expr>` handler (ADR-0013, #44), wired in as the
 * player-scoped `roll` registration.
 *
 * A FREE BCDice roll, tied to NO pending check: it evaluates the raw expression
 * (e.g. "2d6") against the campaign's rule system and posts the result text to the
 * channel. The system id comes from the campaign system via the shared SYSTEM_ID
 * map (coc7 → Cthulhu7th, dnd5e → DungeonsAndDragons5) — the same one BcdiceDice
 * uses, so the free-roll surface and the check surface agree on the system.
 *
 * Unlike `/check`, this never touches the engine: it is a pure player convenience
 * (rolling some dice openly) and writes nothing to mechanical state.
 *
 * Headless: the BCDice evaluator, the campaign-system resolver, and the post /
 * reply sinks are all injected.
 */

export interface RollHandlerDeps {
  /** The BCDice evaluation seam (live: LibBcdiceEvaluator; tests: stub). */
  readonly evaluator: BcdiceEvaluator;
  /** The campaign's rule system for the command's channel. */
  readonly systemFor: (event: CommandEvent) => RuleSystem;
  /** Post the roll result to the channel (live: webhook send; tests: stub). */
  readonly post: (channelId: string, text: string) => Promise<void>;
  /** Ephemeral reply for the error paths (live: interaction reply; tests: stub). */
  readonly reply: (text: string) => Promise<void>;
}

export function createRollHandler(deps: RollHandlerDeps): CommandHandler {
  return async (event: CommandEvent): Promise<void> => {
    const expr = event.options["expr"]?.trim();
    if (expr === undefined || expr === "") {
      await deps.reply("用法：`/roll <表达式>`，例如 `/roll 2d6`。");
      return;
    }

    const systemId = SYSTEM_ID[deps.systemFor(event)];
    if (systemId === undefined) {
      await deps.reply("这个战役的规则系统暂不支持自由掷骰。");
      return;
    }

    const result = await deps.evaluator.eval(systemId, expr);
    if (result === null) {
      await deps.reply(`无法识别的掷骰表达式：\`${expr}\`。`);
      return;
    }

    await deps.post(event.channelId, result.text);
  };
}
