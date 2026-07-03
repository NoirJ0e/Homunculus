/**
 * scene-threads.ts — Thread ↔ scene and actor ↔ persona mapping types.
 *
 * These are plain injected data structures (not classes). The caller
 * constructs them and passes them to the substrate (DiscordSubstrate /
 * MultiBotSubstrate).
 *
 * 风味级映射:
 *   - Discord thread = 场景 (scene)
 *   - Discord webhook with actor name + avatar = 人格分身 (persona)
 */

import type { ActorId, SceneId } from "../../domain/ids.js";

/**
 * Maps SceneId → Discord thread (or channel) ID.
 *
 * One Discord thread = one scene. Public channel = main scene;
 * private threads = sub-scenes (e.g. DM whispers, party splits).
 *
 * Example:
 *   {
 *     "scene-tavern":   "1234567890123456789",  // #tavern thread ID
 *     "scene-dungeon":  "9876543210987654321",  // #dungeon thread ID
 *   }
 */
export type SceneThreadMap = Record<string, string>;

/**
 * Actor → Discord webhook persona.
 *
 * Each actor in the engine maps to a Discord webhook identity: a name and
 * optional avatar URL. When the engine emits a post, the substrate sends it
 * via webhook with these values so the character appears in Discord with
 * its own name and portrait (人格分身).
 *
 * `discordUserId` is used by the inbox adapter: it identifies which Discord
 * user corresponds to this actor so inbound messages can be filtered by actor.
 * Human players need this field; AI agents typically do not send messages
 * via Discord directly, so it is optional.
 */
export interface ActorPersona {
  /** The engine-side actor identity. */
  readonly actorId: ActorId;
  /** Webhook display name (e.g. "Lyra the Bard", "The Dungeon Master"). */
  readonly username: string;
  /**
   * Optional avatar image URL for the webhook.
   * Omit to use the webhook's default avatar.
   */
  readonly avatarURL?: string;
  /**
   * Optional Discord user (snowflake) ID for the human player. The substrate
   * renders it as a real `<@id>` mention in nominate cues (#56 cue @真人).
   * AI agents that speak via webhook/pool bots may omit this.
   */
  readonly discordUserId?: string;
}
