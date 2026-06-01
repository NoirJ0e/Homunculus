import { describe, expect, test } from "vitest";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { actorId, campaignId } from "../../src/domain/ids.js";
import { createSoul } from "../../src/domain/soul.js";
import type { CharacterSheet } from "../../src/ports/card-store.js";
import { CardVerifySession, CardVerifySessionTable } from "../../src/runtime/card-verify-session.js";
import type { CampaignLegality, CardVerifierLlm, VerifiableCard } from "../../src/runtime/card-verifier.js";
import { createVerifyCardHandler } from "../../src/adapters/discord/verify-card-handler.js";

/**
 * #35 — the `/verify-card` command handler (player, roster-gated by #31). It
 * runs/continues the STATEFUL per-thread verify session and posts the verdict
 * feedback back into the thread. On the first `/verify-card` in a thread it
 * starts a session (bound to that thread); subsequent invokes continue the SAME
 * session (re-verify after revise). Headless: verifier LLM stub, stores fakes,
 * thread-post a recording stub.
 */

const sheet: CharacterSheet = { system: "coc7", skills: { 侦查: 60 } };

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "verify-card",
  invokerId: "user-alice",
  channelId: "chan-x",
  threadId: "thread-alice",
  options: {},
  ...over,
});

const legality = (): CampaignLegality => ({ bespokeRules: {}, exceptions: [] });

interface Harness {
  table: CardVerifySessionTable;
  posts: Array<{ threadId: string; text: string }>;
  binds: { souls: string[]; sheets: number; approved: number };
  handler: ReturnType<typeof createVerifyCardHandler>;
  setVerdict: (passed: boolean) => void;
}

function makeHarness(): Harness {
  const table = new CardVerifySessionTable();
  const posts: Array<{ threadId: string; text: string }> = [];
  const binds = { souls: [] as string[], sheets: 0, approved: 0 };
  let pass = false;

  const llm: CardVerifierLlm = {
    adjudicate: async () => (pass ? { passed: true, feedback: "通过！绑定中" } : { passed: false, feedback: "请修改" }),
  };
  const card = (): VerifiableCard => ({
    soul: createSoul(actorId("actor-user-alice"), { name: "侦探", temperament: "冷静" }),
    sheet,
  });

  const handler = createVerifyCardHandler({
    sessionTable: table,
    resolveActor: (invokerId) => actorId(`actor-${invokerId}`),
    resolveCampaign: () => campaignId("camp-1"),
    startVerifierLlm: () => llm,
    readCard: () => card(),
    readLegality: () => legality(),
    soulStore: { load: () => undefined, save: (s) => binds.souls.push(s.id) },
    cardWriter: { write: () => { binds.sheets += 1; } },
    rosterStore: { get: () => undefined, set: () => {}, markApproved: () => { binds.approved += 1; } },
    postFeedback: async (threadId, text) => { posts.push({ threadId, text }); },
  });

  return { table, posts, binds, handler, setVerdict: (p) => { pass = p; } };
}

describe("verify-card handler", () => {
  test("reject → posts feedback, not bound; same-thread re-verify after revise → bound", async () => {
    const h = makeHarness();

    h.setVerdict(false);
    await h.handler(event());
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]?.threadId).toBe("thread-alice");
    expect(h.posts[0]?.text).toContain("请修改");
    expect(h.binds).toEqual({ souls: [], sheets: 0, approved: 0 });

    // Re-verify in the SAME thread continues the SAME session.
    const session = h.table.get("thread-alice");
    expect(session).toBeInstanceOf(CardVerifySession);

    h.setVerdict(true);
    await h.handler(event());
    expect(h.table.get("thread-alice")).toBe(session); // not a fresh session
    expect(h.posts).toHaveLength(2);
    expect(h.posts[1]?.text).toContain("通过");
    expect(h.binds).toEqual({ souls: ["actor-user-alice"], sheets: 1, approved: 1 });
  });
});
