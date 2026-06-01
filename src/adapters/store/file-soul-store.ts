import { join } from "node:path";
import type { ActorId, CampaignId } from "../../domain/ids.js";
import type { Soul } from "../../domain/soul.js";
import type { SoulStore } from "../../ports/soul-store.js";
import { deserializeSoul, serializeSoul } from "../../domain/soul.js";
import { campaignDir, readJsonFile, writeFileEnsuringDir } from "./layout.js";

/**
 * File-backed {@link SoulStore} for one campaign. Souls live at
 * `<dataDir>/campaigns/<campaignId>/souls/<actorId>.json` (ADR-0012); reuse of
 * serialize/deserialize keeps the on-disk shape identical to the in-memory fake.
 * Per-campaign instance ⇒ the same actorId under different campaigns never
 * collides. Inject `dataDir` so tests point at a temp dir.
 */
export class FileSoulStore implements SoulStore {
  constructor(
    private readonly dataDir: string,
    private readonly campaign: CampaignId,
  ) {}

  load(id: ActorId): Soul | undefined {
    const json = readJsonFile(this.pathFor(id));
    return json === undefined ? undefined : deserializeSoul(json);
  }

  save(soul: Soul): void {
    writeFileEnsuringDir(this.pathFor(soul.id), serializeSoul(soul));
  }

  private pathFor(id: ActorId): string {
    return join(campaignDir(this.dataDir, this.campaign), "souls", `${id}.json`);
  }
}
