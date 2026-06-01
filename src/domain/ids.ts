/**
 * Branded identifiers for the domain's first-class entities.
 *
 * They are plain strings at runtime; the brands exist only to stop the engine
 * from silently mixing, say, a SceneId where an ActorId is expected.
 */

export type ActorId = string & { readonly __brand: "ActorId" };
export type SceneId = string & { readonly __brand: "SceneId" };
export type CampaignId = string & { readonly __brand: "CampaignId" };

export const actorId = (s: string): ActorId => s as ActorId;
export const sceneId = (s: string): SceneId => s as SceneId;
export const campaignId = (s: string): CampaignId => s as CampaignId;
