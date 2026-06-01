import type { ActorId, CampaignId } from "../../domain/ids.js";
import type { RosterEntry } from "../../domain/card-lifecycle.js";
import type { RosterStore } from "../../ports/roster-store.js";
import type { CampaignMetaStore } from "../../ports/campaign-meta-store.js";
import type { CommandEvent, CommandHandler } from "./command-router.js";

/**
 * set-roster-handler.ts — the `/set-roster` handler (ADR-0012; #33), wired into
 * #31's router as the owner-scoped `set-roster` registration. The router's gate
 * already restricts it to the campaign owner; this handler does the declared
 * party write:
 *
 *   1. resolve the campaign the command targets (channel → campaign);
 *   2. write ONE unapproved `human` roster entry per @'d player (RosterStore);
 *   3. persist the invoking OWNER (CampaignMetaStore) so the real `isOwner`
 *      authority predicate has a stored owner to check — owner-capture at
 *      provisioning is the proper home and is a flagged follow-up.
 *
 * Headless: stores + reply + the id resolvers are injected seams.
 */

export interface SetRosterDeps {
  readonly rosterStore: RosterStore;
  readonly metaStore: CampaignMetaStore;
  /** Resolve the campaign the command targets (channel → campaign). */
  readonly resolveCampaign: (event: CommandEvent) => CampaignId;
  /** Map an @'d Discord user snowflake to the actor id its seat will bind to. */
  readonly resolveActor: (discordUserId: string) => ActorId;
  /** Reply to the invoker (live: interaction reply; tests: recording stub). */
  readonly reply: (text: string) => Promise<void>;
}

/**
 * Parse the `players` option into Discord user snowflakes. The live interaction
 * supplies @-mentions; we accept a whitespace/comma-separated list (raw ids or
 * `<@id>` mention tokens), tolerant of either form.
 */
function parsePlayers(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(/[\s,]+/)
    .map((tok) => tok.replace(/^<@!?/, "").replace(/>$/, "").trim())
    .filter((tok) => tok.length > 0);
}

export function createSetRosterHandler(deps: SetRosterDeps): CommandHandler {
  return async (event: CommandEvent): Promise<void> => {
    const campaign = deps.resolveCampaign(event);
    const players = parsePlayers(event.options["players"]);

    const entries: RosterEntry[] = players.map((discordUserId) => ({
      actorId: deps.resolveActor(discordUserId),
      discordUserId,
      kind: "human",
      approved: false,
    }));

    deps.rosterStore.set(campaign, entries);
    deps.metaStore.set(campaign, { ownerId: event.invokerId });

    await deps.reply(
      `名单已登记：${players.length} 名玩家（待开卡过审）。全员过审后用 \`/start-game\` 开场。`,
    );
  };
}
