import { join } from "node:path";
import type { CampaignId } from "../../domain/ids.js";
import type { CampaignBible } from "../../domain/campaign.js";
import type { CampaignStore } from "../../ports/campaign-store.js";
import { campaignDir, readJsonFile, writeFileEnsuringDir } from "./layout.js";

/**
 * File-backed {@link CampaignStore}: the bible lives at
 * `<dataDir>/campaigns/<campaignId>/bible.json` (ADR-0012). Campaign-keyed per
 * call so one instance serves all campaigns. Inject `dataDir` for tests.
 */
export class FileCampaignStore implements CampaignStore {
  constructor(private readonly dataDir: string) {}

  get(campaign: CampaignId): CampaignBible | undefined {
    const json = readJsonFile(this.pathFor(campaign));
    return json === undefined ? undefined : (JSON.parse(json) as CampaignBible);
  }

  set(campaign: CampaignId, bible: CampaignBible): void {
    writeFileEnsuringDir(this.pathFor(campaign), JSON.stringify(bible));
  }

  private pathFor(campaign: CampaignId): string {
    return join(campaignDir(this.dataDir, campaign), "bible.json");
  }
}
