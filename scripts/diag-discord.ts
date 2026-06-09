/**
 * diag-discord.ts — REAL integration diagnostic (not a unit test).
 * Logs in each configured bot token individually and reports identity + guild
 * membership, so we can see exactly which token/bot is broken. Run:
 *   node --env-file=.env --import tsx scripts/diag-discord.ts
 */
import { Client, GatewayIntentBits } from "discord.js";
import { buildRuntimeConfig } from "../src/runtime/config.js";

const cfg = buildRuntimeConfig(process.env);
const guildId = cfg.guildId;

async function probe(label: string, token: string): Promise<void> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const t0 = Date.now();
  try {
    await client.login(token);
    const tag = client.user?.tag ?? "?";
    const id = client.user?.id ?? "?";
    let inGuild = "NO";
    try {
      const g = await client.guilds.fetch(guildId);
      inGuild = g ? `YES (${g.name})` : "NO";
    } catch (e) {
      inGuild = `guild-fetch-FAILED: ${(e as Error).message}`;
    }
    console.log(`✅ ${label}: ${tag} (id=${id}) | in guild ${guildId}: ${inGuild} | ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`❌ ${label}: LOGIN FAILED — ${(e as Error).message}`);
  } finally {
    client.destroy();
  }
}

console.log(`guild=${guildId}, pool tokens=${cfg.botPoolTokens.length}`);
await probe("MAIN (DISCORD_BOT_TOKEN)", cfg.botToken);
for (let i = 0; i < cfg.botPoolTokens.length; i++) {
  await probe(`POOL BOT_TOKEN_${i + 1}`, cfg.botPoolTokens[i]!);
}
console.log("done.");
process.exit(0);
