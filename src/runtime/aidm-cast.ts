import type { ActorId, CampaignId } from "../domain/ids.js";
import type { Soul } from "../domain/soul.js";
import type { SoulStore } from "../ports/soul-store.js";
import type { RosterStore } from "../ports/roster-store.js";
import type { ActorKind } from "../engine/roster.js";
import type { ActorPersona } from "../adapters/discord/scene-threads.js";
import { loadBoundTeammates } from "./load-teammates.js";

/**
 * aidm-cast.ts — assemble the AIDM's cast from BOUND teammates (ADR-0012 修正, #37).
 *
 * REPLACES the ADR-0011 bypass: `runAidmQuery` no longer inlines
 * `genesisFullAuto` to conjure a teammate at spin-up (that dodged 审卡). The cast's
 * AI teammates are the campaign's VERIFIED, BOUND seats — their persisted souls
 * read back via {@link loadBoundTeammates}. The NPC persona is built from the
 * SAVED soul's persona core (not freshly genesis'd). If no bound teammate
 * exists, the cast degrades gracefully (`degraded: true`, no NPC) so the AIDM can
 * still open solo.
 *
 * Pure read-only composition over the two stores → fully unit-tested headless.
 * (The runner glue that consumes it makes the real `query()` call and stays
 * untested, per runners.ts's HITL-boundary convention.)
 */

export interface AidmCastInput {
  readonly rosterStore: RosterStore;
  readonly soulStore: SoulStore;
  readonly campaign: CampaignId;
  /** The human seat at this table (always present in the cast). */
  readonly humanId: ActorId;
  /** Username for the human in the cast (defaults to "玩家"). */
  readonly humanUsername?: string;
}

export interface AidmCast {
  /** The bound AI teammate souls, read from the store (empty when none). */
  readonly teammates: readonly Soul[];
  /** Persona block for the first teammate NPC; undefined when degraded. */
  readonly npcPersona?: string;
  /** Webhook personas for the human + teammate seats (the runner prepends aidm). */
  readonly personas: readonly ActorPersona[];
  /** actorId → kind for the engine roster (human + teammates). */
  readonly rosterKinds: Record<string, ActorKind>;
  /** True when no bound teammate exists — the AIDM opens solo (flagged). */
  readonly degraded: boolean;
}

/** Build the resident persona block for an NPC teammate from its saved soul. */
export function buildNpcPersona(soul: Soul): string {
  return [
    `你是 ${soul.personaCore.name}。`,
    `性格：${soul.personaCore.temperament}`,
    soul.personaCore.goals.length > 0 ? `目标：${soul.personaCore.goals.join("；")}` : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}

export function assembleAidmCast(input: AidmCastInput): AidmCast {
  const teammates = loadBoundTeammates(input.rosterStore, input.soulStore, input.campaign);
  const humanUsername = input.humanUsername ?? "玩家";

  const personas: ActorPersona[] = [{ actorId: input.humanId, username: humanUsername }];
  const rosterKinds: Record<string, ActorKind> = { [input.humanId]: "human" };
  for (const soul of teammates) {
    personas.push({ actorId: soul.id, username: soul.personaCore.name });
    rosterKinds[soul.id] = "ai";
  }

  const first = teammates[0];
  return {
    teammates,
    ...(first !== undefined ? { npcPersona: buildNpcPersona(first) } : {}),
    personas,
    rosterKinds,
    degraded: teammates.length === 0,
  };
}
