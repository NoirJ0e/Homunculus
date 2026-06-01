import { describe, expect, test } from "vitest";
import { actorId, campaignId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import {
  CardCreationSession,
  CardCreationSessionTable,
} from "../../src/runtime/card-creation-session.js";

/**
 * #34 — the card-creation session table (keyed by threadId) and the per-thread
 * session that holds the PENDING soul/sheet drafts and delivers thread text to
 * the open-card assistant. All headless: the assistant `deliver` is a recording
 * stub (real `query()` streaming is the HITL glue).
 */

const sampleSoul = createSoul(actorId("p-alice"), { name: "Alice", temperament: "好奇" });
const sampleSheet = { system: "coc7" as const, skills: { 侦查: 60 } };

function makeSession(): { session: CardCreationSession; delivered: string[] } {
  const delivered: string[] = [];
  const session = new CardCreationSession({
    threadId: "thread-1",
    actorId: actorId("p-alice"),
    campaignId: campaignId("mine-01"),
    deliver: (text) => delivered.push(text),
  });
  return { session, delivered };
}

describe("CardCreationSession — per-thread open-card session", () => {
  test("delivers thread text to the bound assistant", () => {
    const { session, delivered } = makeSession();
    session.deliver("我想玩一个图书管理员");
    session.deliver("她有点神经质");
    expect(delivered).toEqual(["我想玩一个图书管理员", "她有点神经质"]);
  });

  test("holds soul + sheet drafts PENDING (not yet bound to any store)", () => {
    const { session } = makeSession();
    expect(session.drafts).toEqual({ status: "pending" });

    session.holdSoulDraft(sampleSoul);
    session.holdSheetDraft(sampleSheet);

    expect(session.drafts).toEqual({
      status: "pending",
      soul: sampleSoul,
      sheet: sampleSheet,
    });
  });

  test("exposes its actor + campaign for the later verify-bind step", () => {
    const { session } = makeSession();
    expect(session.actorId).toBe(actorId("p-alice"));
    expect(session.campaignId).toBe(campaignId("mine-01"));
  });
});

describe("CardCreationSessionTable — keyed by threadId", () => {
  test("bind then get returns the same session for that thread", () => {
    const table = new CardCreationSessionTable();
    const { session } = makeSession();
    table.bind(session);
    expect(table.get("thread-1")).toBe(session);
  });

  test("get on an unbound thread returns undefined", () => {
    const table = new CardCreationSessionTable();
    expect(table.get("never-bound")).toBeUndefined();
  });

  test("delete removes the session (teardown on thread-archive)", () => {
    const table = new CardCreationSessionTable();
    const { session } = makeSession();
    table.bind(session);
    table.delete("thread-1");
    expect(table.get("thread-1")).toBeUndefined();
  });
});
