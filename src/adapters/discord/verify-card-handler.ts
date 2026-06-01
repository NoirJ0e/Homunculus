import type { ActorId, CampaignId } from "../../domain/ids.js";
import type { CommandEvent, CommandHandler } from "./command-router.js";
import type { SoulStore } from "../../ports/soul-store.js";
import type { CardWriter } from "../../ports/card-writer.js";
import type { RosterStore } from "../../ports/roster-store.js";
import type { CampaignLegality, CardVerifierLlm, VerifiableCard } from "../../runtime/card-verifier.js";
import { CardVerifySession, type CardVerifySessionTable } from "../../runtime/card-verify-session.js";

/**
 * verify-card-handler.ts — the `/verify-card` handler (ADR-0012 Phase 6, #35),
 * wired into #31's router as the player-scoped `verify-card` registration (the
 * router already gates it to roster members).
 *
 * It runs/continues the STATEFUL per-thread 审卡反馈环: on the first invoke in a
 * thread it starts a {@link CardVerifySession} and binds it to the thread; every
 * subsequent invoke continues that SAME session (re-verify after the player
 * revises in-thread). Each round it adjudicates via the provenance-agnostic core
 * (authoritative legality only — no prose-approval channel, no secretTruth) and
 * posts the verdict feedback back into the thread. On a `passed` verdict the
 * session BINDS the card (soul saved, sheet written, roster marked approved).
 *
 * Every discord.js / LLM collaborator is an injected seam → fully unit-tested.
 */

export interface VerifyCardDeps {
  /** Where `threadId → verify session` lives (per-player isolation + state). */
  readonly sessionTable: CardVerifySessionTable;
  /** Map the invoking Discord user to the actor id being verified. */
  readonly resolveActor: (invokerId: string) => ActorId;
  /** Resolve the campaign the command targets (channel → campaign). */
  readonly resolveCampaign: (event: CommandEvent) => CampaignId;
  /** Start the verifier adjudicator for the thread (live: a `query()`; stub in tests). */
  readonly startVerifierLlm: (threadId: string) => CardVerifierLlm;
  /** Read the card under review NOW (live: the open-card session's drafts). */
  readonly readCard: (event: CommandEvent) => VerifiableCard;
  /** Read the campaign's authoritative legality NOW (bible knobs + exceptions). */
  readonly readLegality: (event: CommandEvent) => CampaignLegality;
  readonly soulStore: SoulStore;
  readonly cardWriter: CardWriter;
  readonly rosterStore: RosterStore;
  /** Post the verdict feedback back into the thread. */
  readonly postFeedback: (threadId: string, text: string) => Promise<void>;
}

export function createVerifyCardHandler(deps: VerifyCardDeps): CommandHandler {
  return async (event: CommandEvent): Promise<void> => {
    const threadId = event.threadId;
    if (threadId === undefined) {
      // /verify-card is meaningful only inside the player's card thread.
      return;
    }

    let session = deps.sessionTable.get(threadId);
    if (session === undefined) {
      session = new CardVerifySession({
        threadId,
        actorId: deps.resolveActor(event.invokerId),
        campaignId: deps.resolveCampaign(event),
        llm: deps.startVerifierLlm(threadId),
        readCard: () => deps.readCard(event),
        readLegality: () => deps.readLegality(event),
        soulStore: deps.soulStore,
        cardWriter: deps.cardWriter,
        rosterStore: deps.rosterStore,
      });
      deps.sessionTable.bind(session);
    }

    const verdict = await session.verify();
    await deps.postFeedback(threadId, verdict.feedback);
  };
}
