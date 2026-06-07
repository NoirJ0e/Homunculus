/**
 * config.ts — the composition-root config (ADR-0011 Phase 5 rewrite).
 *
 * The old single-session debt (a hardcoded SessionConfig: one NPC persona, one
 * scene/brief, a hand-copied webhook/thread id) is GONE. Channels are now
 * provisioned at runtime by the concierge and routed by topic; nothing about a
 * specific campaign lives here. This module only reads the process-level secrets
 * the composition root needs — fail-fast so a missing var is an obvious error,
 * not a confusing runtime null.
 */
export interface RuntimeConfig {
  /** Bot token (Administrator) — gateway login + provisioning + webhook posts. */
  readonly botToken: string;
  /** The guild the concierge provisions campaigns into. */
  readonly guildId: string;
  /** Campaign id stamped on the concierge lobby (topicless root channels). */
  readonly lobbyCampaign: string;
  /** Archetype the AIDM uses for the v1 one-click teammate (genesisFullAuto). */
  readonly defaultArchetype: string;
  /** #53 一次 NPC 生成尝试的超时上限 (ms) — wraps AgentNpc.generate. */
  readonly npcGenTimeoutMs: number;
  /** #53 NPC 生成的总尝试次数 = 1 次初次 + N 次重试. */
  readonly npcGenMaxAttempts: number;
  /** #53 所有尝试合计的墙钟预算 (ms) — caps total wall time. */
  readonly npcGenTotalBudgetMs: number;
}

const REQUIRED = ["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID"] as const;

function need(env: NodeJS.ProcessEnv, key: (typeof REQUIRED)[number]): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var ${key} (see .env.example).`);
  return v;
}

/** Parse a positive-int env var; fall back to `fallback` on missing/invalid. */
function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  // Number() (not parseInt) so "1.5x" is rejected whole rather than read as 1.
  const n = Number(raw);
  // NaN / non-integer / non-positive → not a usable threshold; use the default.
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function buildRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  return {
    botToken: need(env, "DISCORD_BOT_TOKEN"),
    guildId: need(env, "DISCORD_GUILD_ID"),
    lobbyCampaign: env.HOMUNCULUS_LOBBY_CAMPAIGN ?? "lobby",
    defaultArchetype: env.HOMUNCULUS_DEFAULT_ARCHETYPE ?? "战士",
    npcGenTimeoutMs: intEnv(env, "NPC_GEN_TIMEOUT_MS", 30_000),
    npcGenMaxAttempts: intEnv(env, "NPC_GEN_MAX_ATTEMPTS", 3),
    npcGenTotalBudgetMs: intEnv(env, "NPC_GEN_TOTAL_BUDGET_MS", 90_000),
  };
}
