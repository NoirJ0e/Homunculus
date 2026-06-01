import type { ActorId } from "../domain/ids.js";
import type { Soul } from "../domain/soul.js";

/**
 * Soul store — persistence for souls across sessions (ADR-0004). A real store
 * (file / DB) lands later; tests use an in-memory fake. Branch-aware snapshotting
 * for canonicity is layered on in #8.
 */
export interface SoulStore {
  load(id: ActorId): Soul | undefined;
  save(soul: Soul): void;
}
