import { query } from "@anthropic-ai/claude-agent-sdk";
import type { DiscordAdminPort } from "../ports/discord-admin.js";
import type { DiscordClient } from "../adapters/discord/discord-substrate.js";
import { actorId, sceneId as brandScene, campaignId, type CampaignId } from "../domain/ids.js";
import type { ActorPersona } from "../adapters/discord/scene-threads.js";
import { DiscordSubstrate } from "../adapters/discord/discord-substrate.js";
import { Referee } from "../engine/referee.js";
import { mapRoster } from "../engine/roster.js";
import { AgentNpc } from "../adapters/agent-sdk/agent-npc.js";
import {
  withTimeoutRetry,
  realClock,
  type TimeoutRetryOptions,
} from "../adapters/agent-sdk/timeout-npc.js";
import { buildDmSystemPrompt } from "../adapters/agent-sdk/dm-prompt.js";
import { buildConciergePrompt } from "../adapters/agent-sdk/concierge-prompt.js";
import { createDiscordAdminMcpServer } from "../adapters/agent-sdk/discord-admin-mcp.js";
import { createGenesisMcpServer } from "../adapters/agent-sdk/genesis-mcp.js";
import type { CampaignStore } from "../ports/campaign-store.js";
import type { SoulStore } from "../ports/soul-store.js";
import type { RosterStore } from "../ports/roster-store.js";
import type { CampaignBible } from "../domain/campaign.js";
import { dmQueryStream, npcGenerate } from "../adapters/agent-sdk/sdk-runner.js";
import { assembleAidmCast } from "./aidm-cast.js";
import { runDmDriver } from "./dm-driver.js";
import { PushInbox } from "./push-inbox.js";
import { StreamInputChannel } from "./stream-input.js";
import { postCardAssistantText } from "./card-creation.js";
import { CheckSessionTable } from "./check-session.js";
import type { QueryHandle, QueryRunner, QueryRunnerContext } from "./dispatcher.js";
import type { DicePort } from "../ports/dice.js";
import type { TraceSink } from "../ports/trace-sink.js";
import { messageToTraceEvents } from "../adapters/agent-sdk/trace-tap.js";

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

/**
 * Build the AIDM's opening brief from a registered CampaignBible — so it narrates
 * ON-THEME (the #28-live bug was the AIDM seeing only a category id). Carries the
 * AIDM-private secretTruth (底牌) + the opening milestone's goal/cue. Pure + tested.
 */
export function buildCampaignBrief(bible: CampaignBible): string {
  const opening = bible.milestones[0];
  const lines = [bible.secretTruth];
  if (opening !== undefined) {
    lines.push(`\n【开局】目标：${opening.goal}`);
    lines.push(`入场引子：${opening.enterCue}`);
  }
  return lines.join("\n");
}

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

    const aidm = actorId("aidm");
    const human = actorId("player");

    // Observability: one trace per session, recording every agent's stream.
    const runId = `${ctx.routing.campaign}-${Date.now()}`;
    const sink = deps.makeTraceSink?.(campaign, runId);
    const observe = sink
      ? (agent: string) =>
          (message: unknown): void => {
            for (const ev of messageToTraceEvents(agent, runId, message)) sink.record(ev);
          }
      : undefined;

    // One NpcPort per teammate (#51 修共脑): each gets its OWN AgentNpc, its own
    // persona, and its own `generate` — traced under its REAL name (no more
    // hardcoded `npc:teammates[0]`) and, when configured, wrapped with the #53
    // timeout/retry guard so a stuck agent passes instead of freezing the table.
    const makeNpc = ({
      soul,
      persona,
    }: {
      soul: import("../domain/soul.js").Soul;
      persona: string;
    }): AgentNpc => {
      const label = `npc:${soul.personaCore.name}`;
      const base = observe ? (p: string) => npcGenerate(p, observe(label)) : npcGenerate;
      const generate = deps.npcTimeout
        ? withTimeoutRetry(base, deps.npcTimeout, realClock)
        : base;
      return new AgentNpc({ persona, generate });
    };

    // Load the campaign's verified, bound AI teammates from the stores — no more
    // inlined genesis. The NPC persona comes from the SAVED soul.
    const cast = assembleAidmCast({
      rosterStore: deps.rosterStore,
      soulStore: deps.soulStore,
      campaign,
      humanId: human,
      makeNpc,
    });
    if (cast.degraded) {
      onError(`aidm:${ctx.channelId}`, new Error("no bound AI teammate — AIDM opening solo"));
    }

    const personas: ActorPersona[] = [{ actorId: aidm, username: "地下城主" }, ...cast.personas];

    // The channel IS the scene: route every post to ctx.channelId.
    const threadMap = { [scene]: ctx.channelId };
    const substrate = new DiscordSubstrate(deps.discordClient, personas, threadMap);

    const inbox = new PushInbox();
    const roster = mapRoster(cast.rosterKinds);

    // #44 — the campaign's mechanical judge (BCDice in prod). With it, `/check`
    // and NPC rolls resolve real dice; without it a roll stays a pass.
    const dice = deps.makeDice?.(campaign);

    // #45 — the registered bible carries the plot spine (milestones + world
    // clocks, ADR-0007). Passing it as `campaign` makes the live Referee track a
    // per-branch milestone cursor + the world clocks, so the AIDM's
    // advance_milestone / discover_lead / advance_clock tools act on real state.
    const bible = campaignStore.get(campaign);

    const referee = new Referee({
      aidmId: aidm,
      substrate,
      humanInbox: inbox,
      roster,
      npcFor: cast.npcFor,
      // #52 — the round roster `nominate` covers: the human + each bound teammate.
      presentActors: [human, ...cast.teammates.map((t) => t.id)],
      ...(dice !== undefined && { dice }),
      ...(bible !== undefined && { campaign: bible }),
    });

    // #44 — register this channel's live AIDM session so the `/check` handler can
    // resolve the invoker's pending check by injecting a roll turn into the inbox.
    // `hasPending` reads the Referee's pending checks (read-only); `deliverTurn`
    // pushes the pre-formed roll into the same inbox the engine polls.
    deps.checkSessions?.bind(ctx.channelId, {
      hasPending: (actor) => referee.pendingCheckFor(actor) !== undefined,
      deliverTurn: (turn) => inbox.deliverTurn(turn),
    });
    teardowns.set(ctx.channelId, () => deps.checkSessions?.delete(ctx.channelId));

    const campaignBrief = bible
      ? buildCampaignBrief(bible)
      : `战役 ${ctx.routing.campaign}：未登记战役语境，按通用开场处理。`;
    const teammateNames = cast.teammates.map((t) => t.personaCore.name).join("、");
    const opening =
      cast.teammates.length > 0
        ? `在主线频道开场，承接玩家与队友 ${teammateNames} 的行动。`
        : "在主线频道开场，承接玩家的行动（暂无 AI 队友，独自开场）。";
    const systemPrompt = buildDmSystemPrompt({
      brief: `${campaignBrief}\n\n${opening}`,
      sceneId: scene,
      cast: [
        ...cast.teammates.map((t) => ({ actorId: t.id, role: "npc" as const })),
        { actorId: human, role: "human" as const },
      ],
    });

    // Feed the trigger message so the first await_actors has the human's turn.
    inbox.deliver(ctx.firstMessage);

    void runDmDriver({
      runQuery: () => dmQueryStream(referee, systemPrompt),
      isSessionActive: deps.isSessionActive,
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

/** The open-card 开卡向导 system prompt (ADR-0012 Phase 5). */
const CARD_ASSISTANT_PROMPT =
  "你是开卡向导：用轻松对话帮玩家把一个角色概念落成一张卡——名字、性格、目标、背景。" +
  "不要主持游戏、不要叙事。聊清楚后复述确认即可；玩家满意了提示他用 `/verify-card` 交审。";

/**
 * Build the `startAssistant` seam the `/create-character-card` handler injects
 * (#34). Each call spins up a streaming-input `query()` bound to ONE open-card
 * thread, posts the assistant's replies back as 开卡向导, and returns the thread's
 * `deliver` (push input). HITL GLUE — type-checked, not unit-tested (makes the
 * real `query()` call), exactly like the runners above. The headless seams it
 * composes (StreamInputChannel, postCardAssistantText, holdInitialDrafts) ARE
 * unit-tested.
 */
export function makeCardCreationAssistant(deps: {
  readonly discordClient: DiscordClient;
  readonly onError?: (where: string, error: unknown) => void;
}): (threadId: string) => (text: string) => void {
  const onError = deps.onError ?? (() => {});
  return (threadId: string) => {
    const channel = new StreamInputChannel();
    const stream = query({
      prompt: channel.iterable,
      options: { systemPrompt: CARD_ASSISTANT_PROMPT, permissionMode: "bypassPermissions" },
    });
    void postCardAssistantText(deps.discordClient, threadId, stream).catch((e) =>
      onError(`cardcreation-assistant:${threadId}`, e),
    );
    return (text: string) => channel.push(text);
  };
}
