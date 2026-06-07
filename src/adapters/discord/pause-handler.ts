import type { CommandEvent, CommandHandler } from "./command-router.js";

/**
 * pause-handler.ts — the `/pause` handler (#55). Any seated player may stop the
 * table cleanly: it marks the invoking channel's session held (via the injected
 * pause seam, backed by {@link PauseRegistry}) and confirms. The DM's driving
 * loop consults that held flag and winds down — "今晚到此为止" as a clean explicit
 * operation, complementing ADR-0003's implicit「真人沉默=无限 hold」.
 *
 * Player scope is enforced by the router (only a rostered player reaches here).
 * Headless: the pause seam + reply are injected, so the handler is unit-tested
 * without the registry or Discord.
 */
export interface PauseHandlerDeps {
  /** Mark this channel's session held (backed by PauseRegistry.pause). */
  readonly pause: (channelId: string) => void;
  /** Confirm to the invoker (live: ephemeral interaction reply; tests: stub). */
  readonly reply: (text: string) => Promise<void>;
}

export function createPauseHandler(deps: PauseHandlerDeps): CommandHandler {
  return async (event: CommandEvent): Promise<void> => {
    deps.pause(event.channelId);
    await deps.reply("⏸ 本场已暂停——今晚到此为止，随时回来继续。");
  };
}
