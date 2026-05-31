import type { ActorId } from "../../domain/ids.js";
import type { CardStore, CharacterSheet } from "../../ports/card-store.js";

/**
 * In-memory card store: a fixed map of actor id → sheet, read-only by contract.
 * Tests seed it with known mechanical values so NativeDice resolves checks
 * deterministically against them.
 */
export class FakeCardStore implements CardStore {
  private readonly sheets: Map<string, CharacterSheet>;

  constructor(sheets: Record<string, CharacterSheet>) {
    this.sheets = new Map(Object.entries(sheets));
  }

  read(actor: ActorId): CharacterSheet | undefined {
    return this.sheets.get(actor);
  }
}
