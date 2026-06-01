/**
 * main.ts — the application composition root (ADR-0010 first slice).
 *
 * Wires the pure engine to the real world: Discord (substrate out + gateway in)
 * and the Agent SDK (DM self-driving query() + NPC single-turn query()). HITL —
 * run with auth + Discord env set (see .env.example):
 *
 *   node --env-file=.env --import tsx src/main.ts     # or: npm start
 *
 * 1 AIDM + 1 NPC companion + 1 human, single thread/scene. No dice/spine/clocks.
 */
import { resolveAuth } from "./runtime/auth.js";
import { buildSessionConfig } from "./runtime/config.js";
import { Referee } from "./engine/referee.js";
import { mapRoster } from "./engine/roster.js";
import { DiscordSubstrate } from "./adapters/discord/discord-substrate.js";
import { GatewayInbox } from "./adapters/discord/gateway-inbox.js";
import { createRealDiscordClient } from "./adapters/discord/create-real-discord.js";
import { createGatewaySource } from "./adapters/discord/create-gateway-source.js";
import { AgentNpc } from "./adapters/agent-sdk/agent-npc.js";
import { buildDmSystemPrompt } from "./adapters/agent-sdk/dm-prompt.js";
import { npcGenerate, dmQueryStream } from "./adapters/agent-sdk/sdk-runner.js";
import { runDmDriver } from "./runtime/dm-driver.js";

const auth = resolveAuth(process.env);
console.log(`[auth] ${auth.kind}`);

const cfg = buildSessionConfig(process.env);

// Discord I/O: webhook personas out, gateway messages in.
const client = await createRealDiscordClient({
  botToken: cfg.discord.botToken,
  webhookUrl: cfg.discord.webhookUrl,
});
const substrate = new DiscordSubstrate(client, [...cfg.personas], cfg.threadMap);
const gateway = await createGatewaySource(cfg.discord.botToken);
const inbox = new GatewayInbox(gateway, cfg.personas, cfg.threadMap);

// The NPC companion (single-turn query) + who is human vs AI.
const npc = new AgentNpc({ persona: cfg.npc.persona, generate: npcGenerate });
const roster = mapRoster({ [cfg.humanActorId]: "human", [cfg.npc.actorId]: "ai" });

const referee = new Referee({ aidmId: cfg.aidmId, substrate, npc, humanInbox: inbox, roster });

const systemPrompt = buildDmSystemPrompt({
  brief: cfg.brief,
  sceneId: cfg.sceneId,
  cast: [
    { actorId: cfg.npc.actorId, role: "npc" },
    { actorId: cfg.humanActorId, role: "human" },
  ],
});

let active = true;
process.on("SIGINT", () => {
  active = false;
  console.log("\n[stop] session ended (the in-flight await is the pause).");
  process.exit(0);
});

console.log(`[ready] DM driving scene "${cfg.sceneId}". Play in the Discord thread; Ctrl-C to stop.`);
await runDmDriver({
  runQuery: () => dmQueryStream(referee, systemPrompt),
  isSessionActive: () => active,
  onError: (e) => console.error("[dm-error]", e),
});
