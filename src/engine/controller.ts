import type { ActorId } from "../domain/ids.js";

/**
 * 操控者 (controller) — who holds the wheel of a soul (ADR-0006). A soul is a
 * persistent entity; the controller is a MUTABLE binding, swapped only by
 * explicit handoff (never by AFK auto-takeover).
 *   - human: a real user drives it (silence → hold, ADR-0003).
 *   - ai:    an NPC agent drives it.
 *   - inert: "今晚别管我" — a long-lived pass; the table skips it.
 */
export type Controller =
  | { readonly kind: "human"; readonly userId: string }
  | { readonly kind: "ai" }
  | { readonly kind: "inert" };

/**
 * The soul→controller bindings. Continuity (growth/memory) is automatic because
 * the soul lives in the SoulStore independent of who controls it — handoff never
 * touches the soul.
 */
export class ControllerRegistry {
  private readonly bindings = new Map<string, Controller>();

  constructor(initial: Record<string, Controller> = {}) {
    for (const [soul, c] of Object.entries(initial)) this.bindings.set(soul, c);
  }

  /** Unbound souls default to AI (the empty-seat assumption). */
  controllerOf(soul: ActorId): Controller {
    return this.bindings.get(soul) ?? { kind: "ai" };
  }

  /** Explicit hot-swap. The ONLY way a binding changes. */
  handoff(soul: ActorId, to: Controller): void {
    this.bindings.set(soul, to);
  }

  /** "Don't mind me tonight" — a long-lived pass. */
  setInert(soul: ActorId): void {
    this.bindings.set(soul, { kind: "inert" });
  }
}
