/**
 * dispatcher.ts — the single-process "channel → role → query" router (ADR-0011).
 *
 * One bot, one process. Every inbound Discord message lands here; the dispatcher
 * reads the channel's routing (its topic / thread name, via the injected
 * `resolveRouting`) to infer the channel's ROLE, then consults an active-query
 * table: if no query is live for that channel it spins up the right one (a
 * long-lived concierge / AIDM, or a temporary card-creation) and registers the
 * handle; if one already exists, the message is handed to that query's waiting
 * slot. A thread-archived event tears the query's session down and removes it.
 *
 * Testability is the crux: the dispatcher imports NO discord.js and NO Agent
 * SDK. Everything crosses a constructor seam — the event source, the routing
 * resolver, the three per-role query runners, and the deleteSession hook — so
 * the whole router is exercised headless with hand-driven fakes (ADR-0010 DI
 * style, mirroring `dm-driver`'s `runQuery` thunk and `GatewayInbox`'s source).
 */
import type { ChannelRole, ChannelRouting } from "../adapters/discord/channel-routing.js";
import type { GatewayMessage } from "../adapters/discord/message-events.js";

/**
 * The gateway-push seam the dispatcher consumes. Extends the message stream with
 * thread-archived notifications (the card-creation teardown trigger). The real
 * adapter backs this with discord.js gateway events; tests hand-drive it.
 */
export interface DispatcherEventSource {
  /** Register a handler invoked for every inbound message. */
  onMessage(handler: (message: GatewayMessage) => void): void;
  /** Register a handler invoked when a thread/channel is archived. */
  onThreadArchived(handler: (channelId: string) => void): void;
}

/** What a query runner is told when the dispatcher spins it up. */
export interface QueryRunnerContext {
  /** The channel/thread snowflake the query is bound to. */
  readonly channelId: string;
  /** The resolved routing pointer for that channel. */
  readonly routing: ChannelRouting;
  /** The first message that triggered the spin-up. */
  readonly firstMessage: GatewayMessage;
}

/**
 * A live query's handle, as seen by the dispatcher. The runner owns the actual
 * `query()`; the dispatcher only hands later messages to its waiting slot.
 */
export interface QueryHandle {
  /** Hand a subsequent message to this query's waiting slot. */
  deliver(message: GatewayMessage): void;
}

/** Starts one query for a role and returns its handle. */
export type QueryRunner = (ctx: QueryRunnerContext) => QueryHandle;

export interface DispatcherDeps {
  readonly eventSource: DispatcherEventSource;
  /**
   * Resolve a channel's routing pointer (topic / thread name). null = unknown.
   * May be sync (tests, a pure resolver) or async (a live discord.js topic
   * fetch); the dispatcher awaits either, buffering same-channel messages that
   * race in during resolution so the query is spun up exactly once.
   */
  readonly resolveRouting: (
    channelId: string,
  ) => ChannelRouting | null | Promise<ChannelRouting | null>;
  readonly runConciergeQuery: QueryRunner;
  readonly runAidmQuery: QueryRunner;
  readonly runCardCreationQuery: QueryRunner;
  /** Tear down a query's SDK session (called on thread-archived). */
  readonly deleteSession: (channelId: string) => void;
}

export class Dispatcher {
  private readonly deps: DispatcherDeps;
  private readonly active = new Map<string, QueryHandle>();
  /** Channels whose routing is being resolved; later same-channel messages
   *  buffer here so the query spins up exactly once (async-resolveRouting race). */
  private readonly resolving = new Map<string, GatewayMessage[]>();

  constructor(deps: DispatcherDeps) {
    this.deps = deps;
  }

  /** Subscribe to the event source. Call once after construction. */
  start(): void {
    this.deps.eventSource.onMessage((m) => this.handleMessage(m));
    this.deps.eventSource.onThreadArchived((id) => this.handleArchive(id));
  }

  private runnerFor(role: ChannelRole): QueryRunner {
    switch (role) {
      case "concierge":
        return this.deps.runConciergeQuery;
      case "aidm":
        return this.deps.runAidmQuery;
      case "cardcreation":
        return this.deps.runCardCreationQuery;
    }
  }

  private handleMessage(message: GatewayMessage): void {
    const channelId = message.threadId;

    const existing = this.active.get(channelId);
    if (existing) {
      existing.deliver(message);
      return;
    }

    // A resolution is already in flight for this channel — buffer until it lands
    // (so we never spin up a second query for the same channel).
    const inFlight = this.resolving.get(channelId);
    if (inFlight) {
      inFlight.push(message);
      return;
    }

    const resolved = this.deps.resolveRouting(channelId);
    if (resolved instanceof Promise) {
      this.resolving.set(channelId, []);
      void resolved.then(
        (routing) => this.completeSpinUp(channelId, message, routing),
        () => this.resolving.delete(channelId),
      );
      return;
    }
    this.completeSpinUp(channelId, message, resolved);
  }

  /** Finish a (possibly async) routing resolution: spin up once, then flush any
   *  messages that raced in while resolving to the new handle's slot. */
  private completeSpinUp(
    channelId: string,
    firstMessage: GatewayMessage,
    routing: ChannelRouting | null,
  ): void {
    const buffered = this.resolving.get(channelId) ?? [];
    this.resolving.delete(channelId);

    // Unknown / no-routing channel → spin up NOTHING (safe default).
    if (routing === null) return;

    const handle = this.runnerFor(routing.role)({ channelId, routing, firstMessage });
    this.active.set(channelId, handle);
    for (const m of buffered) handle.deliver(m);
  }

  private handleArchive(channelId: string): void {
    if (!this.active.has(channelId)) return;
    this.active.delete(channelId);
    this.deps.deleteSession(channelId);
  }
}
