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
import { Dispatcher } from "./runtime/dispatcher.js";

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

const dispatcher = new Dispatcher({
  eventSource,
  resolveRouting,
  runConciergeQuery: runners.runConciergeQuery,
  runAidmQuery: runners.runAidmQuery,
  runCardCreationQuery: runners.runCardCreationQuery,
  deleteSession: runners.deleteSession,
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
