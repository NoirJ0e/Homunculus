/**
 * pause-registry.ts — the in-process held-session set behind `/pause` (#55).
 *
 * ADR-0003 already makes an indefinite barrier hold = the pause/save state. This
 * adds an EXPLICIT trigger: any seated player can `/pause` to wind a session down
 * cleanly ("今晚到此为止"), not only by going AFK. The registry is a per-channel
 * held flag the DM driver's `isSessionActive` gate consults — paused → the
 * self-driving loop stops re-launching its `query()`.
 *
 * Scope (#55): this is only the held trigger + in-process state. CROSS-PROCESS
 * serialized resume (persisting the held beat and rehydrating after a restart) is
 * deferred to the memory epic per ADR-0010 — `resume` here just clears the
 * in-process flag.
 */
export class PauseRegistry {
  private readonly held = new Set<string>();

  /** Mark a channel's session as held (paused). Idempotent. */
  pause(channelId: string): void {
    this.held.add(channelId);
  }

  /** Whether a channel's session is currently held. */
  isHeld(channelId: string): boolean {
    return this.held.has(channelId);
  }

  /** Clear the held flag in-process (cross-process resume deferred, ADR-0010). */
  resume(channelId: string): void {
    this.held.delete(channelId);
  }
}
