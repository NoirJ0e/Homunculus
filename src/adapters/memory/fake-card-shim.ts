import { actorId as brand, type ActorId } from "../../domain/ids.js";
import type { CardShimPort, CardSnapshot } from "../../ports/card-shim.js";

/**
 * In-memory stand-in for SealDice's card store + snapshot shim. Holds each
 * actor's sheet as a plain object; snapshot/restore deep-copy through JSON so a
 * restored sheet is fully independent of later mutations.
 */
export class FakeCardShim implements CardShimPort {
  private readonly cards = new Map<string, Record<string, unknown>>();

  constructor(initial: Record<string, Record<string, unknown>> = {}) {
    for (const [id, state] of Object.entries(initial)) {
      this.cards.set(id, { ...state });
    }
  }

  get(actor: ActorId): Record<string, unknown> | undefined {
    return this.cards.get(actor);
  }

  set(actor: ActorId, state: Record<string, unknown>): void {
    this.cards.set(actor, { ...state });
  }

  async snapshot(actor: ActorId): Promise<CardSnapshot> {
    const state = this.cards.get(actor) ?? {};
    return { actorId: actor, state: JSON.parse(JSON.stringify(state)) as Record<string, unknown> };
  }

  async restore(snap: CardSnapshot): Promise<void> {
    this.cards.set(brand(snap.actorId), JSON.parse(JSON.stringify(snap.state)) as Record<string, unknown>);
  }
}
