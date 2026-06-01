import { describe, expect, test } from "vitest";
import { resolveAuth } from "../../src/runtime/auth.js";

describe("#20 resolveAuth — subscription token first, fall back to API key (ADR-0010)", () => {
  test("prefers the Claude subscription token when present (省钱)", () => {
    expect(
      resolveAuth({ CLAUDE_CODE_OAUTH_TOKEN: "tok-sub", ANTHROPIC_API_KEY: "key-fallback" }),
    ).toEqual({ kind: "subscription", token: "tok-sub" });
  });

  test("falls back to the API key when no subscription token", () => {
    expect(resolveAuth({ ANTHROPIC_API_KEY: "key-only" })).toEqual({
      kind: "api-key",
      apiKey: "key-only",
    });
  });

  test("throws a clear error when neither credential is set", () => {
    expect(() => resolveAuth({})).toThrow(/CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY/);
  });

  test("ignores empty-string credentials (unset-by-blank)", () => {
    expect(() =>
      resolveAuth({ CLAUDE_CODE_OAUTH_TOKEN: "", ANTHROPIC_API_KEY: "" }),
    ).toThrow();
  });
});
