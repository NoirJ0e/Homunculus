/**
 * channel-routing.ts — Topic ↔ routing-pointer codec (pure).
 *
 * The routing truth lives in a Discord channel's `topic` field as a compact
 * pointer string, e.g. `homunculus:campaign=mine-01;scene=tavern;role=aidm`.
 * The dispatcher reads the topic each time to infer the channel's role.
 *
 * 纪律(discipline): a topic stores ONLY stable pointers — an id + role. It
 * never holds anything that grows or changes (persona text, memory, state).
 * The evolving soul itself lives in the soul-store; the `campaign` id here is
 * merely the address that points at it. This rule is enforced structurally by
 * the `ChannelRouting` type, which has no field for any mutable text.
 */

/** The role a routed Discord channel plays in the system. */
export type ChannelRole = "aidm" | "concierge" | "cardcreation";

/**
 * A stable routing pointer encoded into / decoded from a channel topic.
 *
 * Only stable foreign keys live here. There is deliberately no field for
 * persona, memory, or state text.
 */
export interface ChannelRouting {
  /** Stable campaign id — the address of the soul in the soul-store. */
  readonly campaign: string;
  /** The channel's role; drives dispatcher routing. */
  readonly role: ChannelRole;
  /** Optional scene pointer (e.g. "tavern"). */
  readonly scene?: string;
}

const PREFIX = "homunculus:";

const ROLES: readonly ChannelRole[] = ["aidm", "concierge", "cardcreation"];

function isChannelRole(value: string): value is ChannelRole {
  return (ROLES as readonly string[]).includes(value);
}

export function encodeTopic(routing: ChannelRouting): string {
  const parts = [`campaign=${routing.campaign}`];
  if (routing.scene !== undefined) parts.push(`scene=${routing.scene}`);
  parts.push(`role=${routing.role}`);
  return PREFIX + parts.join(";");
}

export function parseTopic(topic: string | null): ChannelRouting | null {
  if (topic === null || !topic.startsWith(PREFIX)) return null;

  const fields = new Map<string, string>();
  for (const segment of topic.slice(PREFIX.length).split(";")) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    fields.set(segment.slice(0, eq), segment.slice(eq + 1));
  }

  const campaign = fields.get("campaign");
  const role = fields.get("role");
  if (campaign === undefined || campaign === "") return null;
  if (role === undefined || !isChannelRole(role)) return null;

  const scene = fields.get("scene");
  return scene === undefined || scene === ""
    ? { campaign, role }
    : { campaign, role, scene };
}
