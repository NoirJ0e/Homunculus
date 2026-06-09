/**
 * multi-bot-substrate.ts — the multi-bot Substrate (#56, 改写 ADR-0010 运行时拓扑).
 *
 * REPLACES the single-webhook-many-usernames topology for live play: each AI
 * teammate posts through ITS OWN pool bot — a real, @-mentionable identity (so
 * `@周慎 …` coordination, #57, becomes possible) showing in-fiction as that NPC's
 * nickname. The AIDM and any overflow NPCs (pool smaller than the cast) still go
 * through the shared webhook persona. A post's `mentions` render as real Discord
 * @-pings — that is how the 点名 cue actually pings the human (cue @真人).
 *
 * Routing depends only on the pure {@link PoolBot} seam + the webhook
 * {@link DiscordClient}, so it is fully unit-tested with fakes; only the login /
 * nickname wiring ({@link createBotPool}) is live HITL glue.
 */
import type { ActorId } from "../../domain/ids.js";
import type { Post } from "../../domain/post.js";
import type { SubstratePort } from "../../ports/substrate.js";
import type { ActorPersona, SceneThreadMap } from "./scene-threads.js";
import { type DiscordClient, DiscordSubstrateError } from "./discord-substrate.js";
import type { PoolBot } from "./bot-pool.js";

export { DiscordSubstrateError };

export interface MultiBotSubstrateDeps {
  /** Shared webhook client — AIDM + overflow NPC personas post through this. */
  readonly webhook: DiscordClient;
  /** Actor personas (username/avatar + the human's discordUserId for @-pings). */
  readonly personas: readonly ActorPersona[];
  /** Scene id → Discord thread/channel id. */
  readonly threadMap: SceneThreadMap;
  /** Resolve an actor's assigned pool bot, or undefined (→ webhook fallback). */
  readonly botFor: (actor: ActorId) => PoolBot | undefined;
  /** Sink for non-fatal substrate errors (e.g. a pool-bot send that fell back). */
  readonly onError?: (where: string, error: unknown) => void;
}

export class MultiBotSubstrate implements SubstratePort {
  private readonly personaIndex: ReadonlyMap<string, ActorPersona>;

  constructor(private readonly deps: MultiBotSubstrateDeps) {
    this.personaIndex = new Map(deps.personas.map((p) => [p.actorId, p]));
  }

  async emit(post: Post): Promise<void> {
    const threadId = this.deps.threadMap[post.sceneId];
    if (threadId === undefined) {
      throw new DiscordSubstrateError(
        `MultiBotSubstrate: no Discord thread mapped for sceneId "${post.sceneId}".`,
      );
    }

    // Resolve mentioned actors → real Discord ids (only those with a persona id).
    const mentionUserIds = (post.mentions ?? [])
      .map((a) => this.personaIndex.get(a)?.discordUserId)
      .filter((id): id is string => id !== undefined);
    const content =
      mentionUserIds.length > 0
        ? `${mentionUserIds.map((id) => `<@${id}>`).join(" ")} ${post.prose}`
        : post.prose;

    // An NPC with its own bot speaks AS that bot (its nickname = the NPC).
    const bot = this.deps.botFor(post.actorId);
    if (bot !== undefined) {
      try {
        await bot.send(threadId, content, mentionUserIds.length > 0 ? mentionUserIds : undefined);
        return;
      } catch (e) {
        // A pool bot that can't post (missing channel perms, not in the channel,
        // rate-limited) must NOT throw up through nominate and stall the whole
        // round — fall back to the shared webhook persona so the beat continues.
        this.deps.onError?.(`pool bot send failed for ${post.actorId}; webhook fallback`, e);
      }
    }

    // Otherwise (AIDM / overflow NPC / pool-send fallback) → the webhook persona.
    const persona = this.personaIndex.get(post.actorId);
    if (persona === undefined) {
      throw new DiscordSubstrateError(
        `MultiBotSubstrate: no ActorPersona registered for actorId "${post.actorId}".`,
      );
    }
    const message = {
      content,
      username: persona.username,
      ...(persona.avatarURL !== undefined && { avatarURL: persona.avatarURL }),
      ...(mentionUserIds.length > 0 && { allowedUserMentions: mentionUserIds }),
    };
    await this.deps.webhook.sendWebhookMessage(threadId, message);
  }
}
