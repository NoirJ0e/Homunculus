import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { CampaignId } from "../../domain/ids.js";
import type { RefereeSnapshot } from "../../engine/referee.js";
import { campaignDir, readJsonFile, writeFileEnsuringDir } from "./layout.js";

/**
 * File-backed pause/resume store for {@link RefereeSnapshot} (issue #41,
 * ADR-0003 + ADR-0012).
 *
 * A held barrier IS the pause/save state (ADR-0003); this adapter persists it
 * to `<dataDir>/campaigns/<campaignId>/pause.json` so a process restart can
 * reload the exact playable state and continue from the same beat.
 *
 * API mirrors the other file stores in this directory:
 * - `save`  — write (or overwrite) the snapshot to disk.
 * - `load`  — read and parse; returns `undefined` if absent.
 * - `clear` — delete the file (on campaign end / successful resume).
 */
export class FilePauseStore {
  constructor(private readonly dataDir: string) {}

  save(campaign: CampaignId, snapshot: RefereeSnapshot): void {
    writeFileEnsuringDir(this.pathFor(campaign), JSON.stringify(snapshot));
  }

  load(campaign: CampaignId): RefereeSnapshot | undefined {
    const json = readJsonFile(this.pathFor(campaign));
    return json === undefined ? undefined : (JSON.parse(json) as RefereeSnapshot);
  }

  clear(campaign: CampaignId): void {
    const path = this.pathFor(campaign);
    if (existsSync(path)) {
      rmSync(path);
    }
  }

  private pathFor(campaign: CampaignId): string {
    return join(campaignDir(this.dataDir, campaign), "pause.json");
  }
}
