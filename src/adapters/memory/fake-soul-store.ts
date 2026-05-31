import type { ActorId } from "../../domain/ids.js";
import type { Soul } from "../../domain/soul.js";
import type { SoulStore } from "../../ports/soul-store.js";
import { serializeSoul, deserializeSoul } from "../../domain/soul.js";

/**
 * In-memory soul store. Round-trips through serialization on save/load so it
 * faithfully mimics a real persistent store (and proves souls survive reload).
 */
export class FakeSoulStore implements SoulStore {
  private readonly byId = new Map<string, string>();

  load(id: ActorId): Soul | undefined {
    const json = this.byId.get(id);
    return json ? deserializeSoul(json) : undefined;
  }

  save(soul: Soul): void {
    this.byId.set(soul.id, serializeSoul(soul));
  }
}
