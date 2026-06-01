import { query } from "@anthropic-ai/claude-agent-sdk";
import type { DiscordAdminPort } from "../ports/discord-admin.js";
import type { DiscordClient } from "../adapters/discord/discord-substrate.js";
import { actorId, sceneId as brandScene } from "../domain/ids.js";
import type { ActorPersona } from "../adapters/discord/scene-threads.js";
import { DiscordSubstrate } from "../adapters/discord/discord-substrate.js";
import { Referee } from "../engine/referee.js";
import { mapRoster } from "../engine/roster.js";
import { AgentNpc } from "../adapters/agent-sdk/agent-npc.js";
import { buildDmSystemPrompt } from "../adapters/agent-sdk/dm-prompt.js";
import { buildConciergePrompt } from "../adapters/agent-sdk/concierge-prompt.js";
import { createDiscordAdminMcpServer } from "../adapters/agent-sdk/discord-admin-mcp.js";
import { dmQueryStream, npcGenerate } from "../adapters/agent-sdk/sdk-runner.js";
import { genesisFullAuto } from "../genesis/soul-genesis.js";
import { runDmDriver } from "./dm-driver.js";
import { PushInbox } from "./push-inbox.js";
import { StreamInputChannel } from "./stream-input.js";
import type { QueryHandle, QueryRunner, QueryRunnerContext } from "./dispatcher.js";

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
] as const;

export interface RunnerDeps {
  /** Shared webhook-out client (one per process); per-channel substrates wrap it. */
  readonly discordClient: DiscordClient;
  /** The concierge's provisioning powers (real-discord-admin in production). */
  readonly adminPort: DiscordAdminPort;
  /** Default archetype for v1 one-click teammate genesis. */
  readonly defaultArchetype?: string;
  /** Whether the AIDM session is still live (drives the dm-driver restart net). */
  readonly isSessionActive: () => boolean;
  /** Sink for runner-level errors (logging in production). */
  readonly onError?: (where: string, error: unknown) => void;
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
  const archetype = deps.defaultArchetype ?? "战士";
  const onError = deps.onError ?? (() => {});

  // Per-channel teardown hooks the dispatcher's thread-archive handler invokes.
  const teardowns = new Map<string, () => void>();

  /**
   * AIDM runner. Assembles a minimal v1 Referee for the channel's routing:
   *   - substrate = the channel's scene wired to the shared webhook client;
   *   - one AI teammate NPC, filled one-click via genesisFullAuto → AgentNpc;
   *   - roster = { human, npc }; aidm is the sole narrator.
   * Then drives a long-lived dm-driver. The first message is fed into the
   * push-inbox so the AIDM's first `await_actors` consumes it.
   *
   * v1 SHORTCUT (flagged): the cast is assembled inline from genesisFullAuto, not
   * read back from a soul-store keyed by routing.campaign. Full soul-store wiring
   * (persisted, evolving teammates addressed by campaign id) is out of scope here.
   */
  const runAidmQuery = (ctx: QueryRunnerContext): QueryHandle => {
    const sceneName = ctx.routing.scene ?? ctx.routing.campaign;
    const scene = brandScene(sceneName);

    const aidm = actorId("aidm");
    const human = actorId("player");
    const npcId = actorId("npc-teammate");

    const soul = genesisFullAuto(npcId, archetype);
    const npcPersona = [
      `你是 ${soul.personaCore.name}。`,
      `性格：${soul.personaCore.temperament}`,
      soul.personaCore.goals.length > 0 ? `目标：${soul.personaCore.goals.join("；")}` : "",
    ]
      .filter((s) => s.length > 0)
      .join("\n");

    const personas: ActorPersona[] = [
      { actorId: aidm, username: "地下城主" },
      { actorId: npcId, username: soul.personaCore.name },
      { actorId: human, username: "玩家" },
    ];

    // The channel IS the scene: route every post to ctx.channelId.
    const threadMap = { [scene]: ctx.channelId };
    const substrate = new DiscordSubstrate(deps.discordClient, personas, threadMap);

    const inbox = new PushInbox();
    const npc = new AgentNpc({ persona: npcPersona, generate: npcGenerate });
    const roster = mapRoster({ [human]: "human", [npcId]: "ai" });

    const referee = new Referee({ aidmId: aidm, substrate, npc, humanInbox: inbox, roster });

    const systemPrompt = buildDmSystemPrompt({
      brief: `战役：${ctx.routing.campaign}。在主线频道开场，承接玩家与队友 ${soul.personaCore.name} 的行动。`,
      sceneId: scene,
      cast: [
        { actorId: npcId, role: "npc" },
        { actorId: human, role: "human" },
      ],
    });

    // Feed the trigger message so the first await_actors has the human's turn.
    inbox.deliver(ctx.firstMessage);

    void runDmDriver({
      runQuery: () => dmQueryStream(referee, systemPrompt),
      isSessionActive: deps.isSessionActive,
      onError: (e) => onError(`aidm:${ctx.channelId}`, e),
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
        mcpServers: { "discord-admin": createDiscordAdminMcpServer(deps.adminPort) },
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
