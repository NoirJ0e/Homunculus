import type { HumanTurn } from "../../ports/human-inbox.js";

/**
 * Out-of-character marker (ADR-0011, 前缀表). NOT a HumanTurn: OOC chatter is
 * never an in-character action. A message whose FIRST character is a left paren
 * (`(` ASCII or `（` fullwidth) is classified OOC. The inbox recognises this
 * marker and SKIPS it — it does not resolve the `await_actors` wait and the
 * content never reaches the DM context (saves tokens; can't be mistaken for an
 * action). Strip is the point.
 */
export interface OocMarker {
  readonly kind: "ooc";
}

/** The result of dispatching a raw message: a real turn, or a "not a turn" OOC marker. */
export type MappedMessage = HumanTurn | OocMarker;

/**
 * Maps a raw Discord message content string to a MappedMessage. Shared by the
 * REST-poll DiscordInbox and the gateway-push GatewayInbox so the inbound
 * convention is identical regardless of transport.
 *
 * Dispatch table by leading symbol (ADR-0011 前缀表):
 *   first char "(" or "（"                       → OOC (skipped by the inbox)
 *   ".ra" prefix (case-insensitive)            → roll
 *   "pass" / "pass你们继续" (trimmed, lowercased) → pass (explicit yield ≠ silence)
 *   anything else (non-empty)                  → prose
 *
 * `?` (questions) and other leading symbols are reserved for future slices; this
 * slice does not implement their semantics (they fall through to prose for now).
 */
const PASS_EXACT = new Set(["pass", "pass你们继续"]);
const OOC_PREFIXES = ["(", "（"] as const;

export function mapContentToTurn(raw: string): MappedMessage {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (OOC_PREFIXES.some((p) => trimmed.startsWith(p))) {
    return { kind: "ooc" };
  }
  if (lower.startsWith(".ra")) {
    return { kind: "roll" };
  }
  if (PASS_EXACT.has(lower)) {
    return { kind: "pass" };
  }
  return { kind: "prose", prose: trimmed };
}
