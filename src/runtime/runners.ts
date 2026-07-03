import { query } from "@anthropic-ai/claude-agent-sdk";
import type { DiscordAdminPort } from "../ports/discord-admin.js";
import type { DiscordClient } from "../adapters/discord/discord-substrate.js";
import { sceneId as brandScene, campaignId, type CampaignId } from "../domain/ids.js";
import type { TimeoutRetryOptions } from "../adapters/agent-sdk/timeout-npc.js";
import { dmQueryStream } from "../adapters/agent-sdk/sdk-runner.js";
import type { PoolBot } from "../adapters/discord/bot-pool.js";
import { buildConciergePrompt } from "../adapters/agent-sdk/concierge-prompt.js";
import { createCardMcpServer, type CardDraftTarget } from "../adapters/agent-sdk/card-mcp.js";
import { assembleTable } from "./table-assembly.js";
import { createDiscordAdminMcpServer } from "../adapters/agent-sdk/discord-admin-mcp.js";
import { createGenesisMcpServer } from "../adapters/agent-sdk/genesis-mcp.js";
import type { CampaignStore } from "../ports/campaign-store.js";
import type { CardStore } from "../ports/card-store.js";
import type { SoulStore } from "../ports/soul-store.js";
import type { RosterStore } from "../ports/roster-store.js";
import { runDmDriver } from "./dm-driver.js";
import { StreamInputChannel } from "./stream-input.js";
import { postCardAssistantText } from "./card-creation.js";
import { CheckSessionTable } from "./check-session.js";
import type { QueryHandle, QueryRunner, QueryRunnerContext } from "./dispatcher.js";
import type { DicePort } from "../ports/dice.js";
import type { TraceSink } from "../ports/trace-sink.js";

/**
 * runners.ts — the three per-role QueryRunners the dispatcher spins up (ADR-0011
 * Phase 5). FACTORY: `makeRunners(deps)` closes over the shared substrate client,
 * the Discord-admin port, etc., and returns the runners + `deleteSession`.
 *
 * This is GLUE — type-checked, NOT unit-tested (the irreducible HITL boundary,
 * exactly like `sdk-runner.ts` / `create-gateway-source.ts`): it makes the real
 * `query()` / `dmQueryStream()` calls. The genuinely-testable cores it composes
 * (PushInbox, StreamInputChannel, the dm-driver loop, the prompts) ARE unit-
 * tested. The live acceptance is the user's HITL run (issue #28).
 */

/** The 5 Discord-admin MCP tools the concierge is allowed (and only these). */
const CONCIERGE_TOOLS = [
  "mcp__discord-admin__create_category",
  "mcp__discord-admin__create_text_channel",
  "mcp__discord-admin__create_webhook",
  "mcp__discord-admin__create_thread",
  "mcp__discord-admin__set_channel_topic",
  "mcp__genesis__genesis_campaign",
] as const;

// buildCampaignBrief moved to domain/campaign.ts (arch-C1: the table-assembly
// module needs it and importing runners from there would be circular).
export { buildCampaignBrief } from "../domain/campaign.js";

export interface RunnerDeps {
  /** Shared webhook-out client (one per process); per-channel substrates wrap it. */
  readonly discordClient: DiscordClient;
  /** The concierge's provisioning powers (real-discord-admin in production). */
  readonly adminPort: DiscordAdminPort;
  /**
   * Persistent campaign registry (#32, ADR-0012): the concierge's genesis_campaign
   * tool writes the CampaignBible here keyed by campaign id, and the AIDM runner
   * reads it back to build its brief. File-backed in production, so campaign
   * context survives a restart (the in-memory Map of ADR-0011 forgot on restart).
   */
  readonly campaignStore: CampaignStore;
  /**
   * Persisted souls (#30, ADR-0004). The AIDM runner reads its VERIFIED, BOUND AI
   * teammates back from here — replacing ADR-0011's inlined `genesisFullAuto`
   * bypass (which dodged 审卡). Souls are saved here at bind time (`addAiSeat`).
   */
  readonly soulStore: SoulStore;
  /**
   * The explicit party list (#30, ADR-0012). The AIDM runner reads it to find
   * which seats are approved AI teammates whose souls to load into the cast.
   */
  readonly rosterStore: RosterStore;
  /** Default archetype for v1 one-click teammate genesis. */
  readonly defaultArchetype?: string;
  /** Whether the AIDM session is still live (drives the dm-driver restart net). */
  readonly isSessionActive: () => boolean;
  /**
   * Whether a channel's session has been `/pause`d (#55). The AIDM driver's
   * restart gate consults this per channel: held → the self-driving loop stops
   * re-launching. Optional + additive (absent → never paused).
   */
  readonly isPaused?: (channelId: string) => boolean;
  /** Sink for runner-level errors (logging in production). */
  readonly onError?: (where: string, error: unknown) => void;
  /**
   * The campaign's mechanical-judge (#44, ADR-0013): BCDice reading the campaign's
   * read-only CardStore in production. When present, the AIDM Referee gets a
   * DicePort so `/check` resolves real rolls; when undefined the check stays a pass
   * (no dice authority). Per-campaign so sheets are scoped to the right campaign.
   */
  readonly makeDice?: (campaign: CampaignId) => DicePort | undefined;
  /**
   * The campaign's READ-ONLY card store for the DM's `read_card` tool
   * (ADR-0001/0002). Wired alongside `makeDice` (same backing sheets); absent →
   * the tool reports no card (the pre-arch-C1 production behavior).
   */
  readonly makeCards?: (campaign: CampaignId) => CardStore | undefined;
  /**
   * The channelId → live-AIDM-session registry the `/check` handler reaches
   * through (#44). The AIDM runner binds a handle on spin-up; the handler injects
   * the roll turn into that session's inbox. Optional + additive.
   */
  readonly checkSessions?: CheckSessionTable;
  /**
   * Observability (v2 调优基建): builds a {@link TraceSink} for one AIDM session
   * so every agent's stream (AIDM + its NPCs) is recorded — context received,
   * thinking, prose, tool calls + results. File-backed in production
   * (`data/traces/`). Optional: undefined → no trace.
   */
  readonly makeTraceSink?: (campaign: CampaignId, runId: string) => TraceSink;
  /**
   * Agent-slot timeout/retry knobs (#53, ADR-0003 — adapter layer, not the engine).
   * When present, each teammate's `generate` is wrapped so a stuck agent is
   * abandoned + retried, then passes — one slow agent never freezes the table.
   * Wired from RuntimeConfig (`npcGen*`) in the composition root; absent → raw.
   */
  readonly npcTimeout?: TimeoutRetryOptions;
  /**
   * The NPC bot pool (#56, 改写 ADR-0010): each AI teammate posts as its OWN
   * real, @-mentionable bot. When present (≥1 logged-in bot), the AIDM runner
   * binds teammates to pool bots (sets their per-guild nickname) and routes their
   * posts through {@link MultiBotSubstrate}; absent → the single-webhook persona
   * substrate (degrade). Built once at process start via `createBotPool`.
   */
  readonly botPool?: readonly PoolBot[];
  /** The guild id pool bots set their per-NPC nickname in (#56). */
  readonly guildId?: string;
}

export interface Runners {
  readonly runConciergeQuery: QueryRunner;
  readonly runAidmQuery: QueryRunner;
  readonly runCardCreationQuery: QueryRunner;
  readonly deleteSession: (channelId: string) => void;
}

/**
 * Drain a streaming conversational query, posting each assistant TEXT block back
 * into the Discord channel as `username` (via the shared webhook client). Without
 * this the concierge / card-creation agents run INVISIBLY — they drive their own
 * tools fine, but the human sees no reply (the "[ready] 但完全没反应" bug). Tool-use
 * blocks execute silently; only text is posted. Exported + parameterized so it is
 * unit-tested headless (the runners that call it are the live glue).
 */
export async function postAssistantText(
  client: DiscordClient,
  channelId: string,
  username: string,
  stream: AsyncIterable<unknown>,
): Promise<void> {
  for await (const msg of stream as AsyncIterable<{
    type: string;
    message?: { content?: Array<{ type: string; text?: string }> };
  }>) {
    if (msg.type !== "assistant") continue;
    for (const block of msg.message?.content ?? []) {
      if (block.type === "text" && block.text && block.text.trim().length > 0) {
        await client.sendWebhookMessage(channelId, {
          content: block.text.slice(0, 2000),
          username,
        });
      }
    }
  }
}

export function makeRunners(deps: RunnerDeps): Runners {
  const onError = deps.onError ?? (() => {});

  // Persistent campaign registry (#32): the concierge's genesis_campaign tool
  // writes a CampaignBible keyed by campaign id; the AIDM runner reads it back.
  // File-backed → survives restart (the ADR-0011 in-memory Map did not).
  const campaignStore = deps.campaignStore;

  // Per-channel teardown hooks the dispatcher's thread-archive handler invokes.
  const teardowns = new Map<string, () => void>();

  /**
   * AIDM runner. Assembles a minimal v1 Referee for the channel's routing:
   *   - substrate = the channel's scene wired to the shared webhook client;
   *   - the campaign's VERIFIED, BOUND AI teammate(s) loaded from the roster +
   *     SoulStore (`assembleAidmCast`) → AgentNpc, using the SAVED soul's persona;
   *   - roster = { human, …teammates }; aidm is the sole narrator.
   * Then drives a long-lived dm-driver. The first message is fed into the
   * push-inbox so the AIDM's first `await_actors` consumes it.
   *
   * ADR-0012 修正 (#37): this REPLACES the ADR-0011 bypass that inlined
   * `genesisFullAuto` at spin-up to conjure an UNVERIFIED teammate. Teammates are
   * now created→verified→bound during prep (`addAiSeat`) and read back here. If no
   * bound teammate exists the cast DEGRADES gracefully (flagged): the AIDM opens
   * solo with the human, no NPC.
   */
  const runAidmQuery = (ctx: QueryRunnerContext): QueryHandle => {
    const sceneName = ctx.routing.scene ?? ctx.routing.campaign;
    const scene = brandScene(sceneName);
    const campaign = campaignId(ctx.routing.campaign);

    // Observability: one trace per session, recording every agent's stream.
    const runId = `${ctx.routing.campaign}-${Date.now()}`;
    const sink = deps.makeTraceSink?.(campaign, runId);

    // #44 dice / #45 spine / read_card inputs the table is assembled around.
    const dice = deps.makeDice?.(campaign);
    const cards = deps.makeCards?.(campaign);
    const bible = campaignStore.get(campaign);

    // arch-C1 — the whole opening recipe (per-NPC agents + trace taps + bot-pool
    // substrate + Referee + DM prompt) lives in the table-assembly module; this
    // runner keeps only its own lifecycle: the sink, /check binding, teardown,
    // and the long-lived dm-driver.
    const table = assembleTable({
      scene,
      channelId: ctx.channelId,
      campaign,
      rosterStore: deps.rosterStore,
      soulStore: deps.soulStore,
      webhook: deps.discordClient,
      ...(deps.botPool !== undefined && { botPool: deps.botPool }),
      ...(deps.guildId !== undefined && { guildId: deps.guildId }),
      ...(dice !== undefined && { dice }),
      ...(cards !== undefined && { cards }),
      ...(bible !== undefined && { bible }),
      ...(deps.npcTimeout !== undefined && { npcTimeout: deps.npcTimeout }),
      ...(sink !== undefined && { traceSink: sink, runId }),
      onError,
    });
    const { referee, inbox, systemPrompt, observe } = table;

    // #44 — register this channel's live AIDM session so the `/check` handler can
    // resolve the invoker's pending check by injecting a roll turn into the inbox.
    // `hasPending` reads the Referee's pending checks (read-only); `deliverTurn`
    // pushes the pre-formed roll into the same inbox the engine polls.
    deps.checkSessions?.bind(ctx.channelId, {
      hasPending: (actor) => referee.pendingCheckFor(actor) !== undefined,
      deliverTurn: (turn) => inbox.deliverTurn(turn),
      // #54 — a player's hard check request → engine intent, forced to the DM.
      requestCheck: (actor, skill) => referee.requestCheck(actor, skill),
    });
    teardowns.set(ctx.channelId, () => deps.checkSessions?.delete(ctx.channelId));

    // Feed the trigger message so the first await_actors has the human's turn.
    inbox.deliver(ctx.firstMessage);

    void runDmDriver({
      runQuery: () => dmQueryStream(referee, systemPrompt),
      // #55 — the session stops when globally inactive OR this channel is /paused.
      isSessionActive: () =>
        deps.isSessionActive() && !(deps.isPaused?.(ctx.channelId) ?? false),
      onError: (e) => onError(`aidm:${ctx.channelId}`, e),
      ...(observe && { onMessage: observe("aidm") }),
    }).catch((e) => onError(`aidm-driver:${ctx.channelId}`, e));

    return { deliver: (m) => inbox.deliver(m) };
  };

  /**
   * Concierge runner. A streaming-input conversational query with ONLY the 5
   * Discord-admin MCP tools. Its whole job (ADR-0011): chat a CampaignSeed →
   * provision the campaign skeleton → write the routing topic → post a handoff.
   */
  const runConciergeQuery = (ctx: QueryRunnerContext): QueryHandle => {
    const channel = new StreamInputChannel();
    const stream = query({
      prompt: channel.iterable,
      options: {
        systemPrompt: buildConciergePrompt(),
        mcpServers: {
          "discord-admin": createDiscordAdminMcpServer(deps.adminPort),
          genesis: createGenesisMcpServer(campaignStore),
        },
        allowedTools: [...CONCIERGE_TOOLS],
        permissionMode: "bypassPermissions",
      },
    });
    void postAssistantText(deps.discordClient, ctx.channelId, "门房", stream).catch((e) =>
      onError(`concierge:${ctx.channelId}`, e),
    );

    teardowns.set(ctx.channelId, () => channel.close());

    channel.push(ctx.firstMessage.content);
    return { deliver: (m) => channel.push(m.content) };
  };

  /**
   * Card-creation runner. A thin conversational streaming-input query for the
   * card-creation thread. v1 leans on genesis (the deterministic seed expansion)
   * rather than a bespoke tool surface; on thread-archive the dispatcher calls
   * `deleteSession`, which closes the channel here.
   *
   * v1 SHORTCUT (flagged): this is a plain conversational query with no extra
   * MCP tools; persisting the resulting soul to a soul-store is out of scope.
   */
  const runCardCreationQuery = (ctx: QueryRunnerContext): QueryHandle => {
    const channel = new StreamInputChannel();
    const stream = query({
      prompt: channel.iterable,
      options: {
        systemPrompt:
          "你是开卡向导：用轻松对话帮玩家把一个角色的概念落成一句话设定（名字、性格、目标）。" +
          "不要主持游戏、不要叙事。聊清楚后复述确认即可。",
        permissionMode: "bypassPermissions",
      },
    });
    void postAssistantText(deps.discordClient, ctx.channelId, "开卡向导", stream).catch((e) =>
      onError(`cardcreation:${ctx.channelId}`, e),
    );

    teardowns.set(ctx.channelId, () => channel.close());

    channel.push(ctx.firstMessage.content);
    return { deliver: (m) => channel.push(m.content) };
  };

  const deleteSession = (channelId: string): void => {
    const teardown = teardowns.get(channelId);
    if (teardown) {
      teardowns.delete(channelId);
      teardown();
    }
  };

  return { runConciergeQuery, runAidmQuery, runCardCreationQuery, deleteSession };
}

/** The open-card 开卡向导 system prompt (ADR-0012 Phase 5; hold_card 管线 arch-C2). */
const CARD_ASSISTANT_PROMPT =
  "你是开卡向导：用轻松对话帮玩家把一个角色概念落成一张卡——名字、性格、目标、背景。" +
  "不要主持游戏、不要叙事。聊清楚后复述确认；玩家认可这一版人设时，调用 `hold_card` 工具" +
  "把它落成草稿（名字/性格/目标），然后提示他用 `/verify-card` 交审。" +
  "玩家改主意就继续聊，聊定再调一次 `hold_card` 覆盖旧草稿。";

/**
 * Build the `startAssistant` seam the `/create-character-card` handler injects
 * (#34). Each call spins up a streaming-input `query()` bound to ONE open-card
 * thread, posts the assistant's replies back as 开卡向导, and returns the thread's
 * `deliver` (push input). The assistant carries the `hold_card` in-process MCP
 * tool (arch-C2): what the player settles on lands as PENDING drafts on the
 * thread's session — resolved lazily via `resolveDraftTarget`, because the
 * session is bound to the thread AFTER this factory runs — so `/verify-card`
 * finally adjudicates the talked-out card, not the genesis fallback.
 * HITL GLUE — type-checked, not unit-tested (makes the real `query()` call),
 * exactly like the runners above. The headless seams it composes
 * (StreamInputChannel, postCardAssistantText, cardTools → holdInitialDrafts)
 * ARE unit-tested.
 */
export function makeCardCreationAssistant(deps: {
  readonly discordClient: DiscordClient;
  /** The thread's draft landing target (session + campaign rule system); see
   *  {@link CardDraftTarget}. Undefined → the hold tool reports "no session". */
  readonly resolveDraftTarget: (threadId: string) => CardDraftTarget | undefined;
  readonly onError?: (where: string, error: unknown) => void;
}): (threadId: string) => (text: string) => void {
  const onError = deps.onError ?? (() => {});
  return (threadId: string) => {
    const channel = new StreamInputChannel();
    const stream = query({
      prompt: channel.iterable,
      options: {
        systemPrompt: CARD_ASSISTANT_PROMPT,
        mcpServers: { card: createCardMcpServer(() => deps.resolveDraftTarget(threadId)) },
        allowedTools: ["mcp__card__hold_card"],
        permissionMode: "bypassPermissions",
      },
    });
    void postCardAssistantText(deps.discordClient, threadId, stream).catch((e) =>
      onError(`cardcreation-assistant:${threadId}`, e),
    );
    return (text: string) => channel.push(text);
  };
}
