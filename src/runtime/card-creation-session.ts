import type { ActorId, CampaignId } from "../domain/ids.js";
import type { Soul } from "../domain/soul.js";
import type { CharacterSheet } from "../ports/card-store.js";

/**
 * card-creation-session.ts — the command-driven open-card session, keyed by
 * threadId (ADR-0012 Phase 5, #34).
 *
 * Open-card threads have NO topic, so they cannot be routed by the dispatcher's
 * topic resolver (ADR-0011). Instead `/create-character-card` (the slash-command
 * control surface, #31) deterministically BINDS `threadId → session` here; the
 * dispatcher then short-circuits any message in a bound thread straight to that
 * session's assistant — never to topic routing, never to another player's
 * session (per-player thread = natural isolation).
 *
 * The session holds the open-card assistant's `deliver` seam (streaming input to
 * the live `query()`; the live wiring is the HITL glue) and the PENDING drafts
 * the assistant produces. Drafts are held here, NOT bound to any store — binding
 * happens at verify-pass (#35); this slice only produces + holds them. Pure +
 * fully unit-tested with a recording `deliver` stub.
 */

/** The PENDING drafts an open-card session accumulates before verify-bind. */
export interface CardDrafts {
  /** Always "pending" in this slice — verify-bind (#35) is what promotes them. */
  readonly status: "pending";
  /** The narrative persona draft (held, not yet saved to a SoulStore). */
  readonly soul?: Soul;
  /** The mechanical-values draft (held, not yet written via CardWriter). */
  readonly sheet?: CharacterSheet;
}

export interface CardCreationSessionInit {
  readonly threadId: string;
  /** The actor id this card will bind to at verify-pass. */
  readonly actorId: ActorId;
  /** The campaign the card belongs to. */
  readonly campaignId: CampaignId;
  /** Hand a thread message to the open-card assistant (streaming input). */
  readonly deliver: (text: string) => void;
}

export class CardCreationSession {
  readonly threadId: string;
  readonly actorId: ActorId;
  readonly campaignId: CampaignId;
  private readonly assistantDeliver: (text: string) => void;
  private soulDraft: Soul | undefined;
  private sheetDraft: CharacterSheet | undefined;

  constructor(init: CardCreationSessionInit) {
    this.threadId = init.threadId;
    this.actorId = init.actorId;
    this.campaignId = init.campaignId;
    this.assistantDeliver = init.deliver;
  }

  /** Stream a thread message to the open-card assistant. */
  deliver(text: string): void {
    this.assistantDeliver(text);
  }

  /** Hold the narrative persona draft PENDING (bound at verify-pass, #35). */
  holdSoulDraft(soul: Soul): void {
    this.soulDraft = soul;
  }

  /** Hold the mechanical-values draft PENDING (bound at verify-pass, #35). */
  holdSheetDraft(sheet: CharacterSheet): void {
    this.sheetDraft = sheet;
  }

  /** The drafts held so far. `status` is always "pending" in this slice. */
  get drafts(): CardDrafts {
    return {
      status: "pending",
      ...(this.soulDraft !== undefined ? { soul: this.soulDraft } : {}),
      ...(this.sheetDraft !== undefined ? { sheet: this.sheetDraft } : {}),
    };
  }
}

/**
 * The session table the command handler writes and the dispatcher reads. Keyed
 * by threadId so a message in a bound thread routes to exactly its session.
 */
export class CardCreationSessionTable {
  private readonly byThread = new Map<string, CardCreationSession>();

  /** Register a session under its threadId. */
  bind(session: CardCreationSession): void {
    this.byThread.set(session.threadId, session);
  }

  /** The session bound to a thread, or undefined for an unbound thread. */
  get(threadId: string): CardCreationSession | undefined {
    return this.byThread.get(threadId);
  }

  /** Remove a session (teardown on thread-archive). */
  delete(threadId: string): void {
    this.byThread.delete(threadId);
  }
}
