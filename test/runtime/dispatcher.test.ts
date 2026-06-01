import { describe, expect, test } from "vitest";
import type { ChannelRouting } from "../../src/adapters/discord/channel-routing.js";
import type { GatewayMessage } from "../../src/adapters/discord/message-events.js";
import {
  Dispatcher,
  type DispatcherEventSource,
  type QueryHandle,
  type QueryRunnerContext,
} from "../../src/runtime/dispatcher.js";

/** Hand-driven event source — the test stand-in for discord.js gateway. */
class FakeEventSource implements DispatcherEventSource {
  private readonly msgHandlers: Array<(m: GatewayMessage) => void> = [];
  private readonly archiveHandlers: Array<(channelId: string) => void> = [];

  onMessage(handler: (m: GatewayMessage) => void): void {
    this.msgHandlers.push(handler);
  }
  onThreadArchived(handler: (channelId: string) => void): void {
    this.archiveHandlers.push(handler);
  }
  emitMessage(m: GatewayMessage): void {
    for (const h of this.msgHandlers) h(m);
  }
  emitArchive(channelId: string): void {
    for (const h of this.archiveHandlers) h(channelId);
  }
}

const msg = (over: Partial<GatewayMessage> = {}): GatewayMessage => ({
  threadId: "chan-general",
  userId: "user-1",
  content: "我想跑《凡达林的矿坑》",
  messageId: "m1",
  ...over,
});

/** Records every spin-up + every message delivered to its waiting slot. */
class RecordingRunner {
  readonly spinUps: QueryRunnerContext[] = [];
  readonly delivered: GatewayMessage[] = [];

  run = (ctx: QueryRunnerContext): QueryHandle => {
    this.spinUps.push(ctx);
    return {
      deliver: (m) => {
        this.delivered.push(m);
      },
    };
  };
}

interface Harness {
  source: FakeEventSource;
  concierge: RecordingRunner;
  aidm: RecordingRunner;
  card: RecordingRunner;
  deleted: string[];
  dispatcher: Dispatcher;
}

/** A bound open-card session (#34) — records the thread text streamed to it. */
interface FakeCardSession {
  readonly threadId: string;
  readonly delivered: string[];
}

interface HarnessOptions {
  /** #34 open-card session lookup: bound threadId → session, else undefined. */
  readonly cardSessionFor?: (threadId: string) => FakeCardSession | undefined;
}

function makeHarness(
  resolveRouting: (
    channelId: string,
  ) => ChannelRouting | null | Promise<ChannelRouting | null>,
  options: HarnessOptions = {},
): Harness {
  const source = new FakeEventSource();
  const concierge = new RecordingRunner();
  const aidm = new RecordingRunner();
  const card = new RecordingRunner();
  const deleted: string[] = [];
  const dispatcher = new Dispatcher({
    eventSource: source,
    resolveRouting,
    runConciergeQuery: concierge.run,
    runAidmQuery: aidm.run,
    runCardCreationQuery: card.run,
    deleteSession: (channelId) => {
      deleted.push(channelId);
    },
    ...(options.cardSessionFor
      ? {
          cardSessionFor: (threadId: string) => {
            const s = options.cardSessionFor?.(threadId);
            return s ? { deliver: (text: string) => s.delivered.push(text) } : undefined;
          },
        }
      : {}),
  });
  dispatcher.start();
  return { source, concierge, aidm, card, deleted, dispatcher };
}

describe("#27 Dispatcher — channel → role → query with on-demand lifecycle", () => {
  test("General (concierge routing) → concierge spun up exactly once", () => {
    const h = makeHarness(() => ({ campaign: "root", role: "concierge" }));

    h.source.emitMessage(msg({ threadId: "chan-general", messageId: "m1" }));
    expect(h.concierge.spinUps).toHaveLength(1);

    // Same channel again → NOT spun up again; routed to existing slot.
    h.source.emitMessage(msg({ threadId: "chan-general", messageId: "m2" }));
    expect(h.concierge.spinUps).toHaveLength(1);
    expect(h.concierge.delivered).toHaveLength(1);
    expect(h.concierge.delivered[0]?.messageId).toBe("m2");
  });

  test("#33 OPEN GATE: a plain message in a role=aidm channel with NO active query does NOT spawn the AIDM", () => {
    // The original pain (ADR-0012): the main channel auto-started the AIDM on
    // ANY message. The open gate now requires the owner's `/开场` (start-game);
    // a plain message must NOT spin the AIDM up.
    const h = makeHarness(() => ({ campaign: "mine-01", role: "aidm", scene: "tavern" }));

    h.source.emitMessage(msg({ threadId: "chan-main", messageId: "m1" }));
    h.source.emitMessage(msg({ threadId: "chan-main", messageId: "m2" }));

    expect(h.aidm.spinUps).toHaveLength(0);
    expect(h.concierge.spinUps).toHaveLength(0);
  });

  test("#33 after the AIDM is started, a later message routes to the running AIDM's slot", () => {
    const h = makeHarness(() => ({ campaign: "mine-01", role: "aidm", scene: "tavern" }));

    // start-game starts the AIDM (the handler calls this seam).
    h.dispatcher.startAidm("chan-main", { campaign: "mine-01", role: "aidm", scene: "tavern" });
    expect(h.aidm.spinUps).toHaveLength(1);
    expect(h.aidm.spinUps[0]?.routing.role).toBe("aidm");

    // Now normal messages route to the running AIDM (existing deliver path).
    h.source.emitMessage(msg({ threadId: "chan-main", messageId: "m2" }));
    h.source.emitMessage(msg({ threadId: "chan-main", messageId: "m3" }));
    expect(h.aidm.spinUps).toHaveLength(1);
    expect(h.aidm.delivered.map((m) => m.messageId)).toEqual(["m2", "m3"]);
  });

  test("card-creation thread message spins it up; thread-archived → deleteSession + removed from table", () => {
    const h = makeHarness(() => ({ campaign: "mine-01", role: "cardcreation" }));

    h.source.emitMessage(msg({ threadId: "thread-card", messageId: "m1" }));
    expect(h.card.spinUps).toHaveLength(1);

    h.source.emitArchive("thread-card");
    expect(h.deleted).toEqual(["thread-card"]);

    // Removed from the table: a later message re-spins-up (not delivered to the
    // torn-down handle).
    h.source.emitMessage(msg({ threadId: "thread-card", messageId: "m2" }));
    expect(h.card.spinUps).toHaveLength(2);
    expect(h.card.delivered).toHaveLength(0);
  });

  test("archiving a channel with no active query is a no-op (no deleteSession)", () => {
    const h = makeHarness(() => null);
    h.source.emitArchive("never-seen");
    expect(h.deleted).toHaveLength(0);
  });

  test("unknown / no-routing channel → nothing spun up (safe default)", () => {
    const h = makeHarness(() => null);

    h.source.emitMessage(msg({ threadId: "chan-random", messageId: "m1" }));
    h.source.emitMessage(msg({ threadId: "chan-random", messageId: "m2" }));

    expect(h.concierge.spinUps).toHaveLength(0);
    expect(h.aidm.spinUps).toHaveLength(0);
    expect(h.card.spinUps).toHaveLength(0);
  });

  test("async resolveRouting (live topic fetch) → spins up once after resolution", async () => {
    const h = makeHarness(async () => ({ campaign: "root", role: "concierge" }));

    h.source.emitMessage(msg({ threadId: "chan-general", messageId: "m1" }));
    // Not spun up synchronously — the resolution is in flight.
    expect(h.concierge.spinUps).toHaveLength(0);

    await Promise.resolve();
    await Promise.resolve();
    expect(h.concierge.spinUps).toHaveLength(1);
    expect(h.concierge.spinUps[0]?.firstMessage.messageId).toBe("m1");
  });

  test("messages racing in during async resolution buffer to the one spun-up slot", async () => {
    // Uses a concierge channel: concierge still auto-spins on first message, so
    // this exercises the async-resolve race-buffering (the aidm path is gated by
    // #33 and only starts via start-game, covered separately above).
    const h = makeHarness(async () => ({ campaign: "root", role: "concierge" }));

    h.source.emitMessage(msg({ threadId: "chan-general", messageId: "m1" }));
    // Two more arrive before the (async) routing resolves.
    h.source.emitMessage(msg({ threadId: "chan-general", messageId: "m2" }));
    h.source.emitMessage(msg({ threadId: "chan-general", messageId: "m3" }));

    await Promise.resolve();
    await Promise.resolve();

    // Spun up exactly once; the racers were flushed to its slot in order.
    expect(h.concierge.spinUps).toHaveLength(1);
    expect(h.concierge.spinUps[0]?.firstMessage.messageId).toBe("m1");
    expect(h.concierge.delivered.map((m) => m.messageId)).toEqual(["m2", "m3"]);
  });
});

describe("#34 Dispatcher — bound open-card thread short-circuits topic routing", () => {
  test("message in a bound thread routes to that session, NOT to topic routing", () => {
    const aliceSession: FakeCardSession = { threadId: "thread-card-alice", delivered: [] };
    const h = makeHarness(
      // Topic routing would say aidm — but the open-card session must win.
      () => ({ campaign: "mine-01", role: "aidm" }),
      { cardSessionFor: (id) => (id === "thread-card-alice" ? aliceSession : undefined) },
    );

    h.source.emitMessage(
      msg({ threadId: "thread-card-alice", content: "我是个图书管理员", messageId: "m1" }),
    );

    expect(aliceSession.delivered).toEqual(["我是个图书管理员"]);
    // No topic-routed runner was spun up for the bound thread.
    expect(h.aidm.spinUps).toHaveLength(0);
    expect(h.card.spinUps).toHaveLength(0);
    expect(h.concierge.spinUps).toHaveLength(0);
  });

  test("a thread NOT bound to a session falls through to topic routing", () => {
    const h = makeHarness(() => ({ campaign: "root", role: "concierge" }), {
      cardSessionFor: () => undefined,
    });

    h.source.emitMessage(msg({ threadId: "chan-general", messageId: "m1" }));

    // Unbound → normal topic routing applies (concierge spun up).
    expect(h.concierge.spinUps).toHaveLength(1);
  });

  test("a bound thread's text never crosses into another player's session", () => {
    const alice: FakeCardSession = { threadId: "thread-alice", delivered: [] };
    const bob: FakeCardSession = { threadId: "thread-bob", delivered: [] };
    const sessions = new Map([
      ["thread-alice", alice],
      ["thread-bob", bob],
    ]);
    const h = makeHarness(() => null, { cardSessionFor: (id) => sessions.get(id) });

    h.source.emitMessage(msg({ threadId: "thread-alice", content: "alice 的话", messageId: "a1" }));
    h.source.emitMessage(msg({ threadId: "thread-bob", content: "bob 的话", messageId: "b1" }));

    expect(alice.delivered).toEqual(["alice 的话"]);
    expect(bob.delivered).toEqual(["bob 的话"]);
  });

  test("no cardSessionFor injected → behavior is unchanged (pure topic routing)", () => {
    const h = makeHarness(() => ({ campaign: "root", role: "concierge" }));
    h.source.emitMessage(msg({ threadId: "chan-general", messageId: "m1" }));
    expect(h.concierge.spinUps).toHaveLength(1);
  });
});
