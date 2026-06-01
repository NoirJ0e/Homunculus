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
}

const REQUIRED = ["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID"] as const;

function need(env: NodeJS.ProcessEnv, key: (typeof REQUIRED)[number]): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var ${key} (see .env.example).`);
  return v;
}

export function buildRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  return {
    botToken: need(env, "DISCORD_BOT_TOKEN"),
    guildId: need(env, "DISCORD_GUILD_ID"),
    lobbyCampaign: env.HOMUNCULUS_LOBBY_CAMPAIGN ?? "lobby",
    defaultArchetype: env.HOMUNCULUS_DEFAULT_ARCHETYPE ?? "战士",
  };
}
