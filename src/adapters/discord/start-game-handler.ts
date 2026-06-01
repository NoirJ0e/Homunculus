import type { CampaignId } from "../../domain/ids.js";
import type { RosterEntry } from "../../domain/card-lifecycle.js";
import type { RosterStore } from "../../ports/roster-store.js";
import type { CommandEvent, CommandHandler } from "./command-router.js";

/**
 * start-game-handler.ts — the `/start-game` (`/开场`) handler (ADR-0012 OPEN
 * GATE; #33), wired into #31's router as the owner-scoped `start-game`
 * registration. The router's gate restricts it to the owner; this handler is
 * the ONLY trigger that starts the AIDM (the main `role=aidm` channel no longer
 * auto-starts on a plain message — the original ADR-0012 pain).
 *
 * Guard (human-as-gate, ADR-0003): every roster entry must be `approved`.
 *   - all approved → spawn the AIDM (injected `spawnAidm` — the dispatcher's
 *     `startAidm` in production), exactly once;
 *   - any unapproved / no roster → reply listing who is missing, do NOT spawn.
 *
 * Headless: the roster store, the spawn seam, the campaign resolver, and the
 * reply are all injected.
 */

export interface StartGameDeps {
  readonly rosterStore: RosterStore;
  /** Resolve the campaign the command targets (channel → campaign). */
  readonly resolveCampaign: (event: CommandEvent) => CampaignId;
  /** Start the AIDM for the channel (live: dispatcher.startAidm; tests: stub). */
  readonly spawnAidm: (channelId: string) => void;
  /** Reply to the invoker (live: interaction reply; tests: recording stub). */
  readonly reply: (text: string) => Promise<void>;
}

/** A roster entry's display label for the "still missing" report. */
function label(entry: RosterEntry): string {
  return entry.discordUserId ?? entry.actorId;
}

export function createStartGameHandler(deps: StartGameDeps): CommandHandler {
  return async (event: CommandEvent): Promise<void> => {
    const roster = deps.rosterStore.get(deps.resolveCampaign(event));

    if (roster === undefined || roster.length === 0) {
      await deps.reply("还没有声明名单。先用 `/set-roster` 声明 party，等全员过审再开场。");
      return;
    }

    const missing = roster.filter((e) => !e.approved);
    if (missing.length > 0) {
      await deps.reply(`还差这些席位过审，暂不能开场：${missing.map(label).join("、")}`);
      return;
    }

    deps.spawnAidm(event.channelId);
  };
}
