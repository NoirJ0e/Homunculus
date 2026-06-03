import type { ActorId } from "../domain/ids.js";
import type { HumanTurn } from "../ports/human-inbox.js";

/**
 * check-session.ts — the per-channel registry the `/check` slash handler reaches
 * through to resolve a player's pending check (ADR-0013, #44).
 *
 * The `/check` control surface is the HUMAN trigger: the AIDM declared the WHAT
 * via `call_check` (a pending check on the actor); `/check` injects the HOW
 * (advantage) and pulls the trigger by pushing a `{kind:"roll"}` HumanTurn into
 * the channel's live AIDM session inbox, where the engine resolves it via BCDice.
 *
 * The session inbox (a `PushInbox`) lives inside the AIDM runner (live HITL glue).
 * To keep the handler headless-testable and the engine pure, the runner registers
 * a tiny CAPABILITY handle here — `hasPending(actor)` (read-only, backed by the
 * Referee's `pendingCheckFor`) + `deliverTurn(turn)` (backed by `PushInbox.
 * deliverTurn`). The handler never imports the Referee or the SDK; it only sees
 * this seam. The runner binds the handle when it spins the AIDM up and unbinds it
 * on session teardown.
 */

/** A live AIDM session, as the `/check` handler sees it. */
export interface CheckSessionHandle {
  /** True iff this actor has a check the AIDM 喊'd but no one has rolled yet. */
  hasPending(actor: ActorId): boolean;
  /** Inject a pre-formed turn (the roll) into the session's human inbox. */
  deliverTurn(turn: HumanTurn): void;
}

/**
 * The channelId → live-AIDM-session table. The AIDM runner binds a handle when it
 * starts a session; the `/check` handler reads it. Single-queue per channel (one
 * channel = one AIDM = one human seat in v1, mirroring `PushInbox`).
 */
export class CheckSessionTable {
  private readonly byChannel = new Map<string, CheckSessionHandle>();

  /** Register a session's check-capability handle under its channel id. */
  bind(channelId: string, handle: CheckSessionHandle): void {
    this.byChannel.set(channelId, handle);
  }

  /** The session bound to a channel, or undefined when none is live. */
  get(channelId: string): CheckSessionHandle | undefined {
    return this.byChannel.get(channelId);
  }

  /** Remove a session (teardown on thread-archive / session end). */
  delete(channelId: string): void {
    this.byChannel.delete(channelId);
  }
}
