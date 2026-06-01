import type { HumanTurn } from "../../ports/human-inbox.js";

/**
 * Maps a raw Discord message content string to a HumanTurn. Shared by the
 * REST-poll DiscordInbox and the gateway-push GatewayInbox so the inbound
 * convention is identical regardless of transport.
 *
 * Convention (ADR-0003 / #4):
 *   ".ra" prefix (case-insensitive)            → roll
 *   "pass" / "pass你们继续" (trimmed, lowercased) → pass (explicit yield ≠ silence)
 *   anything else (non-empty)                  → prose
 */
const PASS_EXACT = new Set(["pass", "pass你们继续"]);

export function mapContentToTurn(raw: string): HumanTurn {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith(".ra")) {
    return { kind: "roll" };
  }
  if (PASS_EXACT.has(lower)) {
    return { kind: "pass" };
  }
  return { kind: "prose", prose: trimmed };
}
