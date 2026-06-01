import { join } from "node:path";
import type { ActorId, CampaignId } from "../../domain/ids.js";
import type { CardStore, CharacterSheet } from "../../ports/card-store.js";
import type { CardWriter } from "../../ports/card-writer.js";
import { campaignDir, readJsonFile, writeFileEnsuringDir } from "./layout.js";

/** `<dataDir>/campaigns/<campaignId>/sheets/<actorId>.json` (ADR-0012). */
function sheetPath(dataDir: string, campaign: CampaignId, actor: ActorId): string {
  return join(campaignDir(dataDir, campaign), "sheets", `${actor}.json`);
}

/**
 * File-backed, READ-ONLY {@link CardStore} for one campaign — the view the AIDM
 * receives. There is no write method here on purpose (ADR-0002 red line: the
 * AIDM only reads sheets). Writes go through the separate {@link FileCardWriter}.
 */
export class FileCardStore implements CardStore {
  constructor(
    private readonly dataDir: string,
    private readonly campaign: CampaignId,
  ) {}

  read(actor: ActorId): CharacterSheet | undefined {
    const json = readJsonFile(sheetPath(this.dataDir, this.campaign, actor));
    return json === undefined ? undefined : (JSON.parse(json) as CharacterSheet);
  }
}

/**
 * The non-AIDM write seam ({@link CardWriter}), backed by the same files the
 * read-only {@link FileCardStore} reads. Used by the card-creation / verify-bind
 * flow only; never handed to the AIDM. Campaign-keyed per call so the broader
 * lifecycle code can write across campaigns from one instance.
 */
export class FileCardWriter implements CardWriter {
  constructor(private readonly dataDir: string) {}

  write(campaign: CampaignId, actor: ActorId, sheet: CharacterSheet): void {
    writeFileEnsuringDir(sheetPath(this.dataDir, campaign, actor), JSON.stringify(sheet));
  }
}
