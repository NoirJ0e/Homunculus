import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CampaignId } from "../../domain/ids.js";

/**
 * On-disk layout for campaign persistence (ADR-0012):
 *
 * ```
 * <dataDir>/campaigns/<campaignId>/
 *   bible.json
 *   exceptions.json
 *   roster.json
 *   souls/<actorId>.json
 *   sheets/<actorId>.json
 * ```
 *
 * Everything is keyed by campaignId so the directory can later be wrapped by
 * git for ADR-0004 canonicity without rework.
 */
export function campaignDir(dataDir: string, campaign: CampaignId): string {
  return join(dataDir, "campaigns", campaign);
}

/** Read a UTF-8 file, or `undefined` if it does not exist (missing → undefined). */
export function readJsonFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Write a UTF-8 file, creating parent directories as needed. */
export function writeFileEnsuringDir(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}
