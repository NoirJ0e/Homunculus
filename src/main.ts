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
import { makeRunners } from "./runtime/runners.js";
import { FileCampaignStore } from "./adapters/store/file-campaign-store.js";
import { FileRosterStore } from "./adapters/store/file-roster-store.js";
import { FileCampaignMetaStore } from "./adapters/store/file-campaign-meta-store.js";
import { Dispatcher } from "./runtime/dispatcher.js";
import { CardCreationSessionTable } from "./runtime/card-creation-session.js";
import { campaignId, actorId, type CampaignId } from "./domain/ids.js";
import { createCommandSource } from "./adapters/discord/command-interaction.js";
import { createCommandRouter, type CommandEvent } from "./adapters/discord/command-router.js";
import { createCommandSet } from "./adapters/discord/command-set.js";
import { createCampaignAuthority } from "./adapters/discord/campaign-authority.js";
import { createSetRosterHandler } from "./adapters/discord/set-roster-handler.js";
import { createStartGameHandler } from "./adapters/discord/start-game-handler.js";

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
const campaignStore = new FileCampaignStore(process.env.DATA_DIR ?? "data");

const runners = makeRunners({
  discordClient,
  adminPort,
  campaignStore,
  defaultArchetype: cfg.defaultArchetype,
  isSessionActive: () => active,
  onError: (where, error) => console.error(`[runner-error] ${where}`, error),
});

// #34 — open-card sessions are command-bound (threadId → session) by the
// `/create-character-card` handler, NOT topic-routed. The dispatcher checks this
// table first and short-circuits a bound thread's text to its session. The
// slash-command source that fills this table is wired in the all-chain (#36).
const cardSessions = new CardCreationSessionTable();

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
const dataDir = process.env.DATA_DIR ?? "data";
const rosterStore = new FileRosterStore(dataDir);
const metaStore = new FileCampaignMetaStore(dataDir);

// Per-event campaign resolution: a command targets the campaign its channel is
// routed to. Routing resolution is async (live topic fetch); the command source
// pre-resolves it before dispatch and stashes it here so the (sync) handlers /
// authority can read it. v1 single-session shortcut — see runtime-config debt.
const channelCampaign = new Map<string, CampaignId>();
const resolveCampaign = (event: CommandEvent): CampaignId =>
  channelCampaign.get(event.channelId) ?? campaignId(cfg.lobbyCampaign);

const authority = createCampaignAuthority({ metaStore, rosterStore, resolveCampaign });

// The channel a command reply should be posted to — set per-dispatch by the
// command source below (v1 single-session glue; commands are not concurrent).
let replyChannel = cfg.lobbyCampaign;
const reply = async (text: string): Promise<void> => {
  await discordClient.sendWebhookMessage(replyChannel, { content: text, username: "系统" });
};

const commandSet = createCommandSet({
  // #34 / others land in the all-chain (#36); stubbed here so the set is whole.
  createCharacterCard: async () => {},
  verifyCard: async () => {},
  approve: async () => {},
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

// HITL glue — the bot cannot invoke slash commands; only humans do. Pre-resolve
// the channel's campaign so the sync authority/handlers see it, then dispatch.
const commandSource = await createCommandSource(cfg.botToken);
commandSource.onCommand((event) => {
  replyChannel = event.channelId;
  void resolveRouting(event.channelId)
    .then((routing) => {
      if (routing !== null) channelCampaign.set(event.channelId, campaignId(routing.campaign));
      return commandRouter.dispatch(event);
    })
    .catch((e) => console.error(`[command-error] ${event.name}`, e));
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
