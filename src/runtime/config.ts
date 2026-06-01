import { actorId, sceneId, type ActorId, type SceneId } from "../domain/ids.js";
import type { ActorPersona, SceneThreadMap } from "../adapters/discord/scene-threads.js";

/**
 * config.ts — the first playable session's config (ADR-0010 first slice).
 *
 * Campaign content (brief, the one NPC's persona, the cast's webhook identities)
 * is hardcoded here for v1; genesis-driven setup is deferred. Discord-specific,
 * secret-bearing values come from the environment. Kept assembly-pure + tested
 * so missing env fails fast and the human is routed by the right snowflake.
 */
export interface SessionConfig {
  readonly aidmId: ActorId;
  readonly humanActorId: ActorId;
  readonly sceneId: SceneId;
  readonly brief: string;
  readonly npc: { readonly actorId: ActorId; readonly persona: string };
  /** Webhook identities + (for the human) the discord user id, for substrate/inbox. */
  readonly personas: readonly ActorPersona[];
  readonly threadMap: SceneThreadMap;
  readonly discord: { readonly botToken: string; readonly webhookUrl: string };
}

const REQUIRED = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_WEBHOOK_URL",
  "DISCORD_SCENE_THREAD_ID",
  "DISCORD_PLAYER_USER_ID",
] as const;

function need(env: NodeJS.ProcessEnv, key: (typeof REQUIRED)[number]): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var ${key} (see .env.example).`);
  return v;
}

export function buildSessionConfig(env: NodeJS.ProcessEnv): SessionConfig {
  const botToken = need(env, "DISCORD_BOT_TOKEN");
  const webhookUrl = need(env, "DISCORD_WEBHOOK_URL");
  const threadId = need(env, "DISCORD_SCENE_THREAD_ID");
  const playerUserId = need(env, "DISCORD_PLAYER_USER_ID");

  const aidmId = actorId("aidm");
  const humanActorId = actorId("player");
  const npcId = actorId("npc-merc");
  const scene = sceneId("scene-tavern");

  const npcPersona =
    "你是雇佣兵 Garrok：久经沙场、话少、戒心重，刀比嘴快。重视报酬与同伴的可靠，讨厌废话和鲁莽。";

  const personas: ActorPersona[] = [
    { actorId: aidmId, username: "地下城主" },
    { actorId: npcId, username: "Garrok（佣兵）" },
    { actorId: humanActorId, username: "玩家", discordUserId: playerUserId },
  ];

  return {
    aidmId,
    humanActorId,
    sceneId: scene,
    brief: "暮色酒馆「断锚」。炉火噼啪，外头风雪渐紧。你与佣兵 Garrok 同坐一桌，等一个迟到的雇主。",
    npc: { actorId: npcId, persona: npcPersona },
    personas,
    threadMap: { [scene]: threadId },
    discord: { botToken, webhookUrl },
  };
}
