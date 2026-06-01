import type { ActorId, CampaignId } from "../../domain/ids.js";
import type { CommandEvent, CommandHandler } from "./command-router.js";
import { CardCreationSession, type CardCreationSessionTable } from "../../runtime/card-creation-session.js";

/**
 * create-character-card-handler.ts — the `/create-character-card` handler
 * (ADR-0012 Phase 5, #34), wired into #31's router as the player-scoped
 * `create-character-card` registration. The router already gates it to roster
 * members; this handler runs only the per-player open-card launch:
 *
 *   1. launch the player's PRIVATE thread (admin port `createThread` — the live
 *      thread create is HITL glue, injected here as a seam);
 *   2. start the open-card assistant for that thread, getting its streaming
 *      `deliver` (the live `query()` is HITL glue, also injected);
 *   3. BIND `threadId → session` in the table so the dispatcher routes the
 *      thread's free text to this session (not topic routing);
 *   4. post the onboarding message ("chat here, then /verify-card").
 *
 * Every collaborator that touches discord.js / the LLM is an injected seam, so
 * the handler is fully unit-tested with recording stubs.
 */

export interface CreateCharacterCardDeps {
  /** Where `threadId → session` is registered for the dispatcher to read. */
  readonly sessionTable: CardCreationSessionTable;
  /** Launch the player's private thread under the command's channel → threadId. */
  readonly createThread: (channelId: string, name: string) => Promise<string>;
  /** Map the invoking Discord user to the actor id this card will bind to. */
  readonly resolveActor: (invokerId: string) => ActorId;
  /** Resolve the campaign the command targets (channel → campaign). */
  readonly resolveCampaign: (event: CommandEvent) => CampaignId;
  /**
   * Start the open-card assistant for the thread, returning its streaming
   * `deliver`. Live impl spins up a `query()`; tests return a recording stub.
   */
  readonly startAssistant: (threadId: string) => (text: string) => void;
  /** Post the onboarding message into the new thread. */
  readonly postOnboarding: (threadId: string, text: string) => Promise<void>;
}

/** The onboarding message every open-card thread opens with (ADR-0012). */
export const ONBOARDING_MESSAGE =
  "在这聊你的角色——把概念、性格、背景说清楚，开卡向导会帮你落成一张卡。写好了用 `/verify-card` 交审。";

export function createCreateCharacterCardHandler(deps: CreateCharacterCardDeps): CommandHandler {
  return async (event: CommandEvent): Promise<void> => {
    const actor = deps.resolveActor(event.invokerId);
    const campaign = deps.resolveCampaign(event);

    const threadName = `开卡-${event.invokerId}`;
    const threadId = await deps.createThread(event.channelId, threadName);

    const deliver = deps.startAssistant(threadId);
    const session = new CardCreationSession({
      threadId,
      actorId: actor,
      campaignId: campaign,
      deliver,
    });
    deps.sessionTable.bind(session);

    await deps.postOnboarding(threadId, ONBOARDING_MESSAGE);
  };
}
