import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  CampaignLegality,
  CardVerifierLlm,
  VerifiableCard,
  Verdict,
} from "../../runtime/card-verifier.js";
import type { AiReviser } from "../../runtime/ai-seat.js";
import {
  buildReviserPrompt,
  buildVerifierPrompt,
  parseRevisedCard,
  parseVerdict,
} from "./card-verifier-prompt.js";

/**
 * card-llm-seams.ts — the LIVE LLM glue for the card lifecycle's verifier and
 * AI-seat reviser (ADR-0012; #36). Mirrors `sdk-runner.ts`: real one-shot
 * `query()` calls, NOT unit-tested (the irreducible HITL boundary). The
 * deterministic prompt builders + verdict/draft parsers it composes live in
 * `card-verifier-prompt.ts` and ARE unit-tested.
 *
 *   - {@link createCardVerifierLlm}: a {@link CardVerifierLlm} whose `adjudicate`
 *     runs one query() over the authoritative legality context and parses the
 *     model's PASS/FAIL verdict. Provenance-agnostic — used by BOTH the human
 *     `/verify-card` loop (#35) and the AI-seat loop (#37), so there is exactly
 *     one verifier seam in the composition.
 *   - {@link createAiReviser}: an {@link AiReviser} that runs one query() to
 *     revise a rejected draft from the verifier feedback (the AI-seat path only;
 *     a human revises in-thread instead).
 */

/** Collect the assistant text from a finished one-shot query stream. */
async function collectText(stream: AsyncIterable<unknown>): Promise<string> {
  let out = "";
  for await (const msg of stream as AsyncIterable<{
    type: string;
    error?: string;
    message?: { content?: Array<{ type: string; text?: string }> };
  }>) {
    if (msg.type === "assistant") {
      if (msg.error) throw new Error(`card-llm query error: ${msg.error}`);
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text" && block.text) out += block.text;
      }
    }
  }
  return out;
}

/** One self-contained query turn → its prose (no tools; bypasses permissions). */
function oneShot(prompt: string): AsyncIterable<unknown> {
  return query({ prompt, options: { permissionMode: "bypassPermissions", maxTurns: 1 } });
}

/**
 * The live provenance-agnostic verifier seam. Adjudicates a card against ONLY the
 * authoritative legality context (no prose-approval channel, no secretTruth — see
 * card-verifier.ts) via one query(), parsing the model's verdict. Fail-closed: a
 * malformed reply with no verdict marker parses to a FAIL.
 */
export function createCardVerifierLlm(): CardVerifierLlm {
  return {
    async adjudicate(card: VerifiableCard, legality: CampaignLegality): Promise<Verdict> {
      const text = await collectText(oneShot(buildVerifierPrompt(card, legality)));
      return parseVerdict(text);
    },
  };
}

/**
 * The live AI-seat reviser seam. Given a rejected draft + the verifier feedback,
 * runs one query() to produce a revised draft (persona fields only; the v1
 * mechanical sheet is carried over — ADR-0012/ADR-0001留白). Used solely by the
 * AI-seat auto-revise loop; humans revise in-thread instead.
 */
export function createAiReviser(): AiReviser {
  return async (card: VerifiableCard, feedback: string): Promise<VerifiableCard> => {
    const text = await collectText(oneShot(buildReviserPrompt(card, feedback)));
    return parseRevisedCard(text, card);
  };
}
