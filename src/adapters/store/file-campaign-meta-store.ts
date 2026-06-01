import { join } from "node:path";
import type { CampaignId } from "../../domain/ids.js";
import type { CampaignMeta, CampaignMetaStore } from "../../ports/campaign-meta-store.js";
import { campaignDir, readJsonFile, writeFileEnsuringDir } from "./layout.js";

/**
 * File-backed {@link CampaignMetaStore}: `meta.json` is a JSON object under the
 * campaign dir (ADR-0012). Holds the campaign owner id. Inject `dataDir`.
 */
export class FileCampaignMetaStore implements CampaignMetaStore {
  constructor(private readonly dataDir: string) {}

  get(campaign: CampaignId): CampaignMeta | undefined {
    const json = readJsonFile(this.pathFor(campaign));
    return json === undefined ? undefined : (JSON.parse(json) as CampaignMeta);
  }

  set(campaign: CampaignId, meta: CampaignMeta): void {
    writeFileEnsuringDir(this.pathFor(campaign), JSON.stringify(meta));
  }

  private pathFor(campaign: CampaignId): string {
    return join(campaignDir(this.dataDir, campaign), "meta.json");
  }
}
