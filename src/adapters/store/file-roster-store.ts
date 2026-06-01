import { join } from "node:path";
import type { ActorId, CampaignId } from "../../domain/ids.js";
import type { RosterEntry } from "../../domain/card-lifecycle.js";
import type { RosterStore } from "../../ports/roster-store.js";
import { campaignDir, readJsonFile, writeFileEnsuringDir } from "./layout.js";

/**
 * File-backed {@link RosterStore}: `roster.json` is a JSON array under the
 * campaign dir (ADR-0012). Inject `dataDir`.
 */
export class FileRosterStore implements RosterStore {
  constructor(private readonly dataDir: string) {}

  get(campaign: CampaignId): readonly RosterEntry[] | undefined {
    const json = readJsonFile(this.pathFor(campaign));
    return json === undefined ? undefined : (JSON.parse(json) as RosterEntry[]);
  }

  set(campaign: CampaignId, roster: readonly RosterEntry[]): void {
    writeFileEnsuringDir(this.pathFor(campaign), JSON.stringify(roster));
  }

  markApproved(campaign: CampaignId, actor: ActorId): void {
    const roster = this.get(campaign);
    if (roster === undefined) return;
    const next = roster.map((e) => (e.actorId === actor ? { ...e, approved: true } : e));
    writeFileEnsuringDir(this.pathFor(campaign), JSON.stringify(next));
  }

  private pathFor(campaign: CampaignId): string {
    return join(campaignDir(this.dataDir, campaign), "roster.json");
  }
}
