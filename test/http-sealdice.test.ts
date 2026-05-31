/**
 * Unit tests for the HttpSealDice adapter (issue #5).
 *
 * All tests use a STUB transport — no real network calls are made.
 * The HttpClient interface is injected so tests can supply canned sidecar
 * responses and inspect what the adapter sent.
 *
 * Provisional HTTP/IPC contract (marked PROVISIONAL — see adapter source):
 *   POST /roll
 *   Body (JSON): { actorId: string, skill: string, difficulty?: string }
 *   Success (2xx): { total: number, success: boolean, detail: string }
 *   Error body: { error: string }  (or any non-conforming shape → SealDiceError)
 */

import { describe, expect, test } from "vitest";
import {
  HttpSealDice,
  type HttpClient,
  type SealDiceHttpResponse,
  SealDiceError,
} from "../src/adapters/sealdice/http-sealdice.js";
import { FakeSealDice } from "../src/adapters/memory/fake-sealdice.js";
import type { SealDicePort, RollResult } from "../src/ports/sealdice.js";
import { actorId } from "../src/domain/ids.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a stub HttpClient that always resolves with the given body. */
function stubClient(
  body: unknown,
  status = 200,
): HttpClient & { lastPath: string | undefined; lastBody: unknown } {
  let lastPath: string | undefined;
  let lastBody: unknown;
  return {
    get lastPath() {
      return lastPath;
    },
    get lastBody() {
      return lastBody;
    },
    async post(path: string, requestBody: unknown): Promise<SealDiceHttpResponse> {
      lastPath = path;
      lastBody = requestBody;
      return { status, body };
    },
  };
}

const actor = actorId("actor-kovach");

// ---------------------------------------------------------------------------
// Happy-path: successful check
// ---------------------------------------------------------------------------

describe("HttpSealDice — successful roll (success=true)", () => {
  test("returns a RollResult with success=true and human-readable detail", async () => {
    const client = stubClient({
      total: 37,
      success: true,
      detail: "d100=37 ≤ 60 侦查 → 成功",
    });

    const dice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    const result = await dice.roll({
      actorId: actor,
      skill: "侦查",
      difficulty: "困难",
    });

    expect(result.actorId).toBe(actor);
    expect(result.skill).toBe("侦查");
    expect(result.total).toBe(37);
    expect(result.success).toBe(true);
    expect(result.detail).toBe("d100=37 ≤ 60 侦查 → 成功");
  });
});

// ---------------------------------------------------------------------------
// Failed check
// ---------------------------------------------------------------------------

describe("HttpSealDice — failed roll (success=false)", () => {
  test("returns a RollResult with success=false", async () => {
    const client = stubClient({
      total: 85,
      success: false,
      detail: "d100=85 > 60 侦查 → 失败",
    });

    const dice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    const result = await dice.roll({ actorId: actor, skill: "侦查" });

    expect(result.success).toBe(false);
    expect(result.total).toBe(85);
    expect(result.detail).toBe("d100=85 > 60 侦查 → 失败");
  });
});

// ---------------------------------------------------------------------------
// Difficulty pass-through
// ---------------------------------------------------------------------------

describe("HttpSealDice — difficulty pass-through", () => {
  test("sends difficulty in the request body when provided", async () => {
    const client = stubClient({
      total: 20,
      success: true,
      detail: "d100=20 ≤ 30 运动 (困难) → 成功",
    });

    const dice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    await dice.roll({ actorId: actor, skill: "运动", difficulty: "困难" });

    expect(client.lastPath).toBe("/roll");
    expect(client.lastBody).toEqual({
      actorId: actor,
      skill: "运动",
      difficulty: "困难",
    });
  });

  test("omits difficulty key when not provided (exactOptionalPropertyTypes safe)", async () => {
    const client = stubClient({
      total: 55,
      success: true,
      detail: "d100=55 ≤ 70 运动 → 成功",
    });

    const dice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    await dice.roll({ actorId: actor, skill: "运动" });

    // difficulty should not appear in the sent body
    const body = client.lastBody as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "difficulty")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Malformed response
// ---------------------------------------------------------------------------

describe("HttpSealDice — malformed sidecar response", () => {
  test("throws SealDiceError when total is missing", async () => {
    const client = stubClient({ success: true, detail: "ok" }); // no total

    const dice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    await expect(dice.roll({ actorId: actor, skill: "侦查" })).rejects.toThrow(
      SealDiceError,
    );
  });

  test("throws SealDiceError when success is missing", async () => {
    const client = stubClient({ total: 42, detail: "ok" }); // no success

    const dice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    await expect(dice.roll({ actorId: actor, skill: "侦查" })).rejects.toThrow(
      SealDiceError,
    );
  });

  test("throws SealDiceError when detail is missing", async () => {
    const client = stubClient({ total: 42, success: true }); // no detail

    const dice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    await expect(dice.roll({ actorId: actor, skill: "侦查" })).rejects.toThrow(
      SealDiceError,
    );
  });

  test("throws SealDiceError on non-2xx HTTP status", async () => {
    const client = stubClient({ error: "actor not found" }, 404);

    const dice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    await expect(dice.roll({ actorId: actor, skill: "侦查" })).rejects.toThrow(
      SealDiceError,
    );
  });

  test("SealDiceError message includes the skill name", async () => {
    const client = stubClient({ total: 42, success: true }); // no detail

    const dice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    const err = await dice
      .roll({ actorId: actor, skill: "感知" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SealDiceError);
    expect((err as SealDiceError).message).toContain("感知");
  });
});

// ---------------------------------------------------------------------------
// Interchangeability: both implementations satisfy SealDicePort
// ---------------------------------------------------------------------------

describe("SealDicePort interchangeability", () => {
  /**
   * A function typed against the PORT, not either concrete class.
   * TypeScript (tsc) would reject this if either class failed to satisfy
   * SealDicePort.  Vitest confirms it runs correctly at test time.
   */
  async function usePort(port: SealDicePort, skill: string): Promise<boolean> {
    const result = await port.roll({ actorId: actor, skill });
    return result.success;
  }

  test("HttpSealDice is accepted as SealDicePort", async () => {
    const client = stubClient({ total: 30, success: true, detail: "ok" });
    const httpDice = new HttpSealDice(client, { baseUrl: "http://localhost:3366" });

    const succeeded = await usePort(httpDice, "运动");
    expect(succeeded).toBe(true);
  });

  test("FakeSealDice is accepted as SealDicePort", async () => {
    const cannedResult: RollResult = {
      actorId: actor,
      skill: "运动",
      total: 22,
      success: true,
      detail: "scripted success",
    };
    const fakeDice = new FakeSealDice([cannedResult]);

    const succeeded = await usePort(fakeDice, "运动");
    expect(succeeded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HITL integration test — requires a real SealDice sidecar
// ---------------------------------------------------------------------------

/**
 * HOW TO RUN:
 *   1. Start SealDice sidecar: `./sealdice-core` (default port 3366)
 *   2. Set env var: SEALDICE_URL=http://localhost:3366
 *   3. Ensure actor "test-actor-hitl" is registered with a "侦查" skill configured
 *   4. Run: SEALDICE_URL=http://localhost:3366 npm test -- test/http-sealdice.test.ts
 *
 * This test is intentionally SKIPPED in CI — it needs a live sidecar process.
 * It verifies the actual command round-trip through the real SealDice HTTP API.
 */
test.skip("HITL: round-trip .ra check against real SealDice sidecar", async () => {
  const sidecarUrl = process.env["SEALDICE_URL"];
  if (!sidecarUrl) throw new Error("SEALDICE_URL env var required for HITL test");

  /** Minimal fetch-based HttpClient for use against a real sidecar. */
  const realClient: HttpClient = {
    async post(path: string, body: unknown): Promise<SealDiceHttpResponse> {
      const response = await fetch(`${sidecarUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseBody: unknown = await response.json();
      return { status: response.status, body: responseBody };
    },
  };

  const dice = new HttpSealDice(realClient, { baseUrl: sidecarUrl });
  const result = await dice.roll({
    actorId: actorId("test-actor-hitl"),
    skill: "侦查",
    difficulty: "普通",
  });

  // Structural assertions — exact values vary per roll
  expect(typeof result.total).toBe("number");
  expect(typeof result.success).toBe("boolean");
  expect(typeof result.detail).toBe("string");
  expect(result.detail.length).toBeGreaterThan(0);
  expect(result.actorId).toBe("test-actor-hitl");
  expect(result.skill).toBe("侦查");
});
