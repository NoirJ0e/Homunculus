/**
 * main.ts — the application composition root (ADR-0011 Phase 5 rewrite).
 *
 * One bot, one process, zero hand-copied ids. Wires the dispatcher to the real
 * world and starts it; everything campaign-specific is provisioned at runtime by
 * the concierge and routed by channel topic.
 *
 *   resolveAuth (Agent-SDK credential)
 *   → real Discord: webhook-posting client (out) + dispatcher gateway source (in)
 *     + Discord-admin port (concierge provisioning)
 *   → makeRunners(...) (concierge / AIDM / card-creation query runners)
 *   → new Dispatcher({...}).start()
 *
 * HITL — run with auth + Discord env set (see .env.example):
 *
 *   npm start          # node --env-file=.env --import tsx src/main.ts
 *
 * This file is the irreducible composition glue: type-checked, not unit-tested.
 * Ctrl-C stops the process (the in-flight await IS the pause).
 */
import { resolveAuth } from "./runtime/auth.js";
import { buildRuntimeConfig } from "./runtime/config.js";
import { createWebhookPostingClient } from "./adapters/discord/create-real-discord.js";
import { createDispatcherGatewaySource } from "./adapters/discord/create-gateway-source.js";
import { createRealDiscordAdmin } from "./adapters/discord/real-discord-admin.js";
import { makeRunners, makeCardCreationAssistant } from "./runtime/runners.js";
import { FileCampaignStore } from "./adapters/store/file-campaign-store.js";
import { FileRosterStore } from "./adapters/store/file-roster-store.js";
import { FileSoulStore } from "./adapters/store/file-soul-store.js";
import { FileCampaignMetaStore } from "./adapters/store/file-campaign-meta-store.js";
import { FileCardWriter } from "./adapters/store/file-card-store.js";
import { FileExceptionStore } from "./adapters/store/file-exception-store.js";
import { Dispatcher } from "./runtime/dispatcher.js";
import { CardCreationSessionTable } from "./runtime/card-creation-session.js";
import { CardVerifySessionTable } from "./runtime/card-verify-session.js";
import { buildLegality, type CampaignLegality } from "./runtime/card-verifier.js";
import { readCardUnderReview } from "./runtime/read-card-under-review.js";
import { DEFAULT_COC7_SHEET } from "./runtime/card-creation.js";
import { campaignId, actorId, type CampaignId } from "./domain/ids.js";
import {
  createCommandSource,
  registerGuildCommands,
  describeCommands,
} from "./adapters/discord/command-interaction.js";
import { createCommandRouter, type CommandEvent } from "./adapters/discord/command-router.js";
import { createCommandSet, COMMAND_DESCRIPTIONS } from "./adapters/discord/command-set.js";
import { createCampaignAuthority } from "./adapters/discord/campaign-authority.js";
import { createSetRosterHandler } from "./adapters/discord/set-roster-handler.js";
import { createStartGameHandler } from "./adapters/discord/start-game-handler.js";
import { createCreateCharacterCardHandler } from "./adapters/discord/create-character-card-handler.js";
import { createVerifyCardHandler } from "./adapters/discord/verify-card-handler.js";
import { createApproveHandler } from "./adapters/discord/approve-handler.js";
import { createAddAiSeatHandler } from "./adapters/discord/add-ai-seat-handler.js";
import {
  createCardVerifierLlm,
  createAiReviser,
} from "./adapters/agent-sdk/card-llm-seams.js";

const auth = resolveAuth(process.env);
console.log(`[auth] ${auth.kind}`);

const cfg = buildRuntimeConfig(process.env);

// Discord I/O: persona webhooks out (per-channel), gateway messages + thread
// lifecycle in, admin provisioning for the concierge.
const discordClient = await createWebhookPostingClient(cfg.botToken);
const { eventSource, resolveRouting } = await createDispatcherGatewaySource(
  cfg.botToken,
  cfg.lobbyCampaign,
);
const adminPort = await createRealDiscordAdmin({ botToken: cfg.botToken, guildId: cfg.guildId });

let active = true;

// Persistent campaign bibles (#32, ADR-0012): survives restart so the AIDM still
// knows which campaign it's running after a process bounce.
const dataDir = process.env.DATA_DIR ?? "data";
const campaignStore = new FileCampaignStore(dataDir);

// Persisted roster + souls (#30). The AIDM runner reads its VERIFIED, BOUND AI
// teammates back from these (replacing ADR-0011's inlined genesisFullAuto bypass,
// #37). v1 single-session: souls are scoped to the lobby campaign (see the
// runtime-config hardcoded-debt note — multi-campaign soul-store wiring later).
const rosterStore = new FileRosterStore(dataDir);
const soulStore = new FileSoulStore(dataDir, campaignId(cfg.lobbyCampaign));

// #35/#37 card-lifecycle stores: sheets writer (the non-AIDM write seam,
// never handed to the AIDM — ADR-0002), and the owner-sanctioned exception
// list `/approve` appends to (the SOLE exception authority the verifier reads).
const cardWriter = new FileCardWriter(dataDir);
const exceptionStore = new FileExceptionStore(dataDir);

const runners = makeRunners({
  discordClient,
  adminPort,
  campaignStore,
  soulStore,
  rosterStore,
  defaultArchetype: cfg.defaultArchetype,
  isSessionActive: () => active,
  onError: (where, error) => console.error(`[runner-error] ${where}`, error),
});

// #34 — open-card sessions are command-bound (threadId → session) by the
// `/create-character-card` handler, NOT topic-routed. The dispatcher checks this
// table first and short-circuits a bound thread's text to its session. The
// slash-command source that fills this table is wired in the all-chain (#36).
const cardSessions = new CardCreationSessionTable();

// #35 — the STATEFUL per-thread 审卡反馈环 table (threadId → verify session).
// One session per player thread; re-running `/verify-card` continues the SAME
// session (re-verify after an in-thread revise).
const verifySessions = new CardVerifySessionTable();

// The live LLM seams (#36, sdk-runner.ts style — real query(), HITL-unverified):
// ONE provenance-agnostic verifier shared by BOTH the human `/verify-card` loop
// and the AI-seat loop, plus the AI-seat auto-reviser.
const verifierLlm = createCardVerifierLlm();
const aiReviser = createAiReviser();

// The open-card assistant seam the `/create-character-card` handler injects —
// each call spins up a streaming-input query() bound to one thread.
const startCardAssistant = makeCardCreationAssistant({
  discordClient,
  onError: (where, error) => console.error(`[card-assistant-error] ${where}`, error),
});

const dispatcher = new Dispatcher({
  eventSource,
  resolveRouting,
  runConciergeQuery: runners.runConciergeQuery,
  runAidmQuery: runners.runAidmQuery,
  runCardCreationQuery: runners.runCardCreationQuery,
  deleteSession: runners.deleteSession,
  cardSessionFor: (threadId) => cardSessions.get(threadId),
});

// #33 — explicit roster + OPEN GATE. The owner declares the party (`/set-roster`)
// and starts the AIDM (`/start-game`) — the main `role=aidm` channel no longer
// auto-starts on a plain message. Slash commands are the deterministic control
// surface (ADR-0012). Per-campaign stores are file-backed (survive restart).
const metaStore = new FileCampaignMetaStore(dataDir);

// Per-event campaign resolution: a command targets the campaign its channel is
// routed to. Routing resolution is async (live topic fetch); the command source
// pre-resolves it before dispatch and stashes it here so the (sync) handlers /
// authority can read it. v1 single-session shortcut — see runtime-config debt.
const channelCampaign = new Map<string, CampaignId>();
const resolveCampaign = (event: CommandEvent): CampaignId =>
  channelCampaign.get(event.channelId) ?? campaignId(cfg.lobbyCampaign);

const authority = createCampaignAuthority({ metaStore, rosterStore, resolveCampaign });

// The authoritative legality the verifier adjudicates against (#35): the
// campaign bible's non-secret legality fields (NEVER secretTruth — blindbox,
// ADR-0007) + the owner-sanctioned exception list. Re-read per verify round so a
// freshly `/approve`'d exception is picked up on re-verify.
const readLegality = (event: CommandEvent): CampaignLegality => {
  const campaign = resolveCampaign(event);
  const exceptions = exceptionStore.list(campaign);
  const bible = campaignStore.get(campaign);
  if (bible === undefined) {
    // No registered bible yet (v1 lobby campaign): only owner exceptions apply.
    return { bespokeRules: {}, exceptions };
  }
  return buildLegality(bible, exceptions);
};

// The channel a command reply should be posted to — set per-dispatch by the
// command source below (v1 single-session glue; commands are not concurrent).
let replyChannel = cfg.lobbyCampaign;
const reply = async (text: string): Promise<void> => {
  await discordClient.sendWebhookMessage(replyChannel, { content: text, username: "系统" });
};

const commandSet = createCommandSet({
  // #34 — launch the player's private thread, start the open-card assistant,
  // bind threadId→session so the dispatcher routes the thread's text to it.
  createCharacterCard: createCreateCharacterCardHandler({
    sessionTable: cardSessions,
    createThread: (channelId, name) => adminPort.createThread(channelId, name),
    resolveActor: (invokerId) => actorId(invokerId),
    resolveCampaign,
    startAssistant: startCardAssistant,
    postOnboarding: (threadId, text) =>
      discordClient.sendWebhookMessage(threadId, { content: text, username: "开卡向导" }),
  }),
  // #35 — the stateful 审卡反馈环: adjudicate via the provenance-agnostic core
  // (authoritative legality only), post feedback, BIND on pass. readCard bridges
  // the open-card session's drafts (genesis fallback) → a complete card.
  verifyCard: createVerifyCardHandler({
    sessionTable: verifySessions,
    resolveActor: (invokerId) => actorId(invokerId),
    resolveCampaign,
    startVerifierLlm: () => verifierLlm,
    readCard: (event) =>
      readCardUnderReview(event.threadId ?? event.channelId, {
        sessionFor: (threadId) => cardSessions.get(threadId),
        actorId: actorId(event.invokerId),
        fallbackArchetype: cfg.defaultArchetype,
        fallbackSheet: DEFAULT_COC7_SHEET,
      }),
    readLegality,
    soulStore,
    cardWriter,
    rosterStore,
    postFeedback: (threadId, text) =>
      discordClient.sendWebhookMessage(threadId, { content: text, username: "审卡官" }),
  }),
  // #35 — owner writes a sanctioned exception (the SOLE exception authority).
  approve: createApproveHandler({ exceptionStore, resolveCampaign }),
  // #37 — the AI seat runs genesis → SAME verifier → capped auto-revise → bind;
  // on cap-exhaustion the owner is notified and the seat is NOT bound.
  addAiSeat: createAddAiSeatHandler({
    resolveCampaign,
    resolveActor: (event) => actorId(event.options["name"] ?? `ai:${event.options["archetype"] ?? cfg.defaultArchetype}`),
    legality: readLegality,
    sheetFor: () => DEFAULT_COC7_SHEET,
    verifierLlm: () => verifierLlm,
    reviser: aiReviser,
    soulStore,
    cardWriter,
    rosterStore,
    reply,
  }),
  setRoster: createSetRosterHandler({
    rosterStore,
    metaStore,
    resolveCampaign,
    resolveActor: (discordUserId) => actorId(discordUserId),
    reply,
  }),
  startGame: createStartGameHandler({
    rosterStore,
    resolveCampaign,
    // spawn = resolve the channel's routing then start the AIDM (idempotent).
    spawnAidm: (channelId) => {
      void resolveRouting(channelId).then((routing) => {
        if (routing !== null) dispatcher.startAidm(channelId, routing);
      });
    },
    reply,
  }),
});

const commandRouter = createCommandRouter(commandSet, authority);

// #31 — PUBLISH the command set as guild application commands so they appear in
// the Discord client (the bot can never invoke them; only humans). Needs the
// application (client) id — read from env. Idempotent: re-registering replaces.
const appId = process.env.DISCORD_APP_ID;
if (appId === undefined || appId === "") {
  console.warn(
    "[commands] DISCORD_APP_ID not set — skipping slash-command registration. " +
      "The commands will NOT appear in Discord until you set it and restart.",
  );
} else {
  await registerGuildCommands(
    cfg.botToken,
    appId,
    cfg.guildId,
    describeCommands(commandSet, COMMAND_DESCRIPTIONS),
  );
  console.log(`[commands] registered ${commandSet.length} guild slash commands.`);
}

// HITL glue — the bot cannot invoke slash commands; only humans do. Pre-resolve
// the channel's campaign so the sync authority/handlers see it, then dispatch.
const commandSource = await createCommandSource(cfg.botToken);
commandSource.onCommand((event) => {
  console.log(
    `[cmd] recv "${event.name}" invoker=${event.invokerId} channel=${event.channelId}` +
      `${event.threadId ? ` thread=${event.threadId}` : ""} opts=${JSON.stringify(event.options)}`,
  );
  replyChannel = event.channelId;
  void resolveRouting(event.channelId)
    .then(async (routing) => {
      if (routing !== null) {
        channelCampaign.set(event.channelId, campaignId(routing.campaign));
        console.log(`[cmd] "${event.name}" routing: campaign=${routing.campaign} role=${routing.role}`);
      } else {
        console.log(`[cmd] "${event.name}" routing: none for channel ${event.channelId}`);
      }
      const result = await commandRouter.dispatch(event);
      switch (result.kind) {
        case "dispatched":
          console.log(`[cmd] "${event.name}" dispatched OK`);
          break;
        case "denied":
          console.warn(`[cmd] "${event.name}" DENIED (scope=${result.scope}, invoker=${event.invokerId})`);
          await reply(
            result.scope === "owner"
              ? `「/${event.name}」只有 owner 能用。`
              : `「/${event.name}」需要你在名单里——请让 owner 先用 /set-roster 把你加进来（owner 可 @ 自己）。`,
          ).catch(() => {});
          break;
        case "unknown-command":
          console.warn(`[cmd] "${event.name}" UNKNOWN command`);
          await reply(`未知命令「/${event.name}」。`).catch(() => {});
          break;
      }
    })
    .catch(async (e) => {
      console.error(`[command-error] ${event.name}`, e);
      await reply(`「/${event.name}」处理出错：${e instanceof Error ? e.message : String(e)}`).catch(() => {});
    });
});

process.on("SIGINT", () => {
  active = false;
  console.log("\n[stop] dispatcher stopped (in-flight awaits are the pause).");
  process.exit(0);
});

dispatcher.start();
console.log(
  `[ready] dispatcher live on guild ${cfg.guildId}. ` +
    `Say "我想跑《…》" in any topicless channel to start; Ctrl-C to stop.`,
);
