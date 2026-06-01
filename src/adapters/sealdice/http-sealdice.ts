/**
 * HttpSealDice — real SealDice sidecar adapter behind SealDicePort (issue #5).
 *
 * Implements SealDicePort by talking to the SealDice Go sidecar over HTTP/IPC.
 * The HTTP transport is injected (HttpClient interface) so unit tests can supply
 * a stub; production wires in a thin fetch wrapper.
 *
 * SealDice owns the character sheet and is the sole writer of mechanical state
 * (ADR-0001, ADR-0002). This adapter NEVER writes sheet state itself — it only
 * translates RollRequest → HTTP POST and parses the response into RollResult.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVISIONAL HTTP/IPC CONTRACT  (pending the real SealDice sidecar HTTP API)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Endpoint:  POST <baseUrl>/roll
 *
 * Request body (application/json):
 *   {
 *     actorId:    string,           // branded ActorId (raw string at runtime)
 *     skill:      string,           // e.g. "侦查", "Athletics"
 *     difficulty?: string           // optional tier, e.g. "困难", "Hard"
 *                                   // omitted entirely when not specified
 *   }
 *
 * Success response (HTTP 2xx, application/json):
 *   {
 *     total:   number,              // numeric roll result (e.g. d100 roll)
 *     success: boolean,             // whether the check passed
 *     detail:  string               // human-readable breakdown,
 *                                   // e.g. "d100=37 ≤ 60 侦查 → 成功"
 *   }
 *
 * Error response (HTTP non-2xx, application/json):
 *   { error: string }               // or any non-conforming shape
 *   → throws SealDiceError
 *
 * Rationale for POST /roll:
 *   SealDice processes a `.ra <skill>` command on behalf of an actor.  The
 *   sidecar resolves the skill value from its own character-sheet store (the
 *   sole write authority) and returns the computed result.  We never pass the
 *   raw stat value ourselves.
 *
 * NOTE: This contract is PROVISIONAL and must be validated / adjusted once the
 * real SealDice HTTP API surface is documented.  The HITL integration test in
 * test/http-sealdice.test.ts performs the live round-trip verification.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ActorId } from "../../domain/ids.js";
import { actorId } from "../../domain/ids.js";
import type { SealDicePort, RollRequest, RollResult } from "../../ports/sealdice.js";

// ---------------------------------------------------------------------------
// Public transport interface (dependency-injected)
// ---------------------------------------------------------------------------

/** The minimal HTTP response surface the adapter needs. */
export interface SealDiceHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Minimal HTTP client interface.  Inject a real fetch-based implementation in
 * production; inject a stub in tests.
 */
export interface HttpClient {
  post(path: string, body: unknown): Promise<SealDiceHttpResponse>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HttpSealDiceConfig {
  /** Base URL of the SealDice sidecar, e.g. "http://localhost:3366". */
  readonly baseUrl: string;
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown when the SealDice sidecar returns an error HTTP status or a response
 * body that does not conform to the expected shape.
 */
export class SealDiceError extends Error {
  readonly skill: string;
  readonly status?: number;

  constructor(message: string, skill: string, status?: number) {
    super(message);
    this.name = "SealDiceError";
    this.skill = skill;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

// ---------------------------------------------------------------------------
// Shape guard for the sidecar success response
// ---------------------------------------------------------------------------

interface SealDiceSuccessBody {
  total: number;
  success: boolean;
  detail: string;
}

function isSealDiceSuccessBody(v: unknown): v is SealDiceSuccessBody {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj["total"] === "number" &&
    typeof obj["success"] === "boolean" &&
    typeof obj["detail"] === "string"
  );
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Real SealDice HTTP adapter.  Translates RollRequest into a sidecar HTTP POST
 * and parses the response into a RollResult.
 *
 * Constructor arguments:
 *   client  — injectable HTTP transport (stub in tests, fetch-based in prod)
 *   config  — sidecar configuration (baseUrl)
 */
export class HttpSealDice implements SealDicePort {
  private readonly client: HttpClient;
  /** Retained for future path/versioning construction; currently only /roll is used. */
  private readonly config: HttpSealDiceConfig;

  constructor(client: HttpClient, config: HttpSealDiceConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Execute a `.ra <skill>` check via the SealDice sidecar.
   *
   * The sidecar looks up the actor's skill value from its own sheet store,
   * rolls the dice, and returns the result.  We pass the difficulty tier
   * (if any) so the sidecar can apply the appropriate threshold modifier.
   *
   * @throws {SealDiceError} on non-2xx response or malformed body.
   */
  async roll(req: RollRequest): Promise<RollResult> {
    // Build request body — omit difficulty when not provided so that
    // exactOptionalPropertyTypes stays satisfied and the sidecar receives a
    // clean object without spurious undefined keys.
    const requestBody: {
      actorId: ActorId;
      skill: string;
      difficulty?: string;
    } = {
      actorId: req.actorId,
      skill: req.skill,
    };
    if (req.difficulty !== undefined) {
      requestBody.difficulty = req.difficulty;
    }

    const response = await this.client.post("/roll", requestBody);

    // Non-2xx → typed error
    if (response.status < 200 || response.status >= 300) {
      throw new SealDiceError(
        `SealDice sidecar returned HTTP ${response.status} for skill "${req.skill}"`,
        req.skill,
        response.status,
      );
    }

    // Validate response shape
    if (!isSealDiceSuccessBody(response.body)) {
      throw new SealDiceError(
        `SealDice sidecar returned a malformed response for skill "${req.skill}": ` +
          `expected { total: number, success: boolean, detail: string }, ` +
          `got ${JSON.stringify(response.body)}`,
        req.skill,
        response.status,
      );
    }

    const body = response.body;

    return {
      actorId: actorId(req.actorId), // re-brand to keep ActorId type flowing
      skill: req.skill,
      total: body.total,
      success: body.success,
      detail: body.detail,
    };
  }
}
