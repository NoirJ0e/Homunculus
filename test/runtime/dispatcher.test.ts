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

function makeHarness(
  resolveRouting: (channelId: string) => ChannelRouting | null,
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

  test("role=aidm channel first message → AIDM spun up once, later messages routed to same slot", () => {
    const h = makeHarness(() => ({ campaign: "mine-01", role: "aidm", scene: "tavern" }));

    h.source.emitMessage(msg({ threadId: "chan-main", messageId: "m1" }));
    expect(h.aidm.spinUps).toHaveLength(1);
    expect(h.aidm.spinUps[0]?.routing.role).toBe("aidm");
    expect(h.aidm.spinUps[0]?.firstMessage.messageId).toBe("m1");
    expect(h.concierge.spinUps).toHaveLength(0);

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
});
