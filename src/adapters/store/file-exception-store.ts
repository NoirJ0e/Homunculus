import { join } from "node:path";
import type { CampaignId } from "../../domain/ids.js";
import type { SanctionedException } from "../../domain/card-lifecycle.js";
import type { ExceptionStore } from "../../ports/exception-store.js";
import { campaignDir, readJsonFile, writeFileEnsuringDir } from "./layout.js";

/**
 * File-backed {@link ExceptionStore}: `exceptions.json` is a JSON array under
 * the campaign dir (ADR-0012). Missing file ⇒ empty list. Inject `dataDir`.
 */
export class FileExceptionStore implements ExceptionStore {
  constructor(private readonly dataDir: string) {}

  list(campaign: CampaignId): readonly SanctionedException[] {
    const json = readJsonFile(this.pathFor(campaign));
    return json === undefined ? [] : (JSON.parse(json) as SanctionedException[]);
  }

  add(campaign: CampaignId, exception: SanctionedException): void {
    const next = [...this.list(campaign), exception];
    writeFileEnsuringDir(this.pathFor(campaign), JSON.stringify(next));
  }

  private pathFor(campaign: CampaignId): string {
    return join(campaignDir(this.dataDir, campaign), "exceptions.json");
  }
}
