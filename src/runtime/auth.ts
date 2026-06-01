/**
 * auth.ts — resolve which credential the Agent SDK authenticates with (ADR-0010).
 *
 * Prefer the Claude subscription token (Pro/Max Agent-SDK allotment, the 省钱
 * goal of ADR-0009); fall back to a pay-per-token API key. Pure + tested so the
 * precedence is unambiguous; the live "does the SDK actually honor the token"
 * check is the Phase-0 spike, not unit-testable here.
 */
export type Auth =
  | { readonly kind: "subscription"; readonly token: string }
  | { readonly kind: "api-key"; readonly apiKey: string };

export function resolveAuth(env: NodeJS.ProcessEnv): Auth {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN;
  if (token) return { kind: "subscription", token };

  const apiKey = env.ANTHROPIC_API_KEY;
  if (apiKey) return { kind: "api-key", apiKey };

  throw new Error(
    "No Claude credential found: set CLAUDE_CODE_OAUTH_TOKEN (subscription, preferred) " +
      "or ANTHROPIC_API_KEY in the environment.",
  );
}
