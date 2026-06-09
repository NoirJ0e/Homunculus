import { describe, expect, test } from "vitest";
import { buildRuntimeConfig } from "../../src/runtime/config.js";

const fullEnv = {
  DISCORD_BOT_TOKEN: "bot-tok",
  DISCORD_GUILD_ID: "guild-123",
};

describe("#28 buildRuntimeConfig — read process secrets, no hardcoded session debt", () => {
  test("throws a clear error when a required Discord var is missing", () => {
    for (const key of Object.keys(fullEnv)) {
      const partial = { ...fullEnv };
      delete (partial as Record<string, string>)[key];
      expect(() => buildRuntimeConfig(partial)).toThrow(new RegExp(key));
    }
  });

  test("carries the bot token + guild id and applies lobby/archetype defaults", () => {
    const cfg = buildRuntimeConfig(fullEnv);
    expect(cfg.botToken).toBe("bot-tok");
    expect(cfg.guildId).toBe("guild-123");
    expect(cfg.lobbyCampaign).toBe("lobby");
    expect(cfg.defaultArchetype.length).toBeGreaterThan(0);
  });

  test("lets the lobby campaign + default archetype be overridden by env", () => {
    const cfg = buildRuntimeConfig({
      ...fullEnv,
      HOMUNCULUS_LOBBY_CAMPAIGN: "front-desk",
      HOMUNCULUS_DEFAULT_ARCHETYPE: "法师",
    });
    expect(cfg.lobbyCampaign).toBe("front-desk");
    expect(cfg.defaultArchetype).toBe("法师");
  });

  test("#53 applies NPC-gen timeout/retry/budget defaults when unset", () => {
    const cfg = buildRuntimeConfig(fullEnv);
    expect(cfg.npcGenTimeoutMs).toBe(30_000);
    expect(cfg.npcGenMaxAttempts).toBe(3);
    expect(cfg.npcGenTotalBudgetMs).toBe(90_000);
  });

  test("#53 parses NPC-gen timeout/retry/budget from env", () => {
    const cfg = buildRuntimeConfig({
      ...fullEnv,
      NPC_GEN_TIMEOUT_MS: "5000",
      NPC_GEN_MAX_ATTEMPTS: "2",
      NPC_GEN_TOTAL_BUDGET_MS: "12000",
    });
    expect(cfg.npcGenTimeoutMs).toBe(5_000);
    expect(cfg.npcGenMaxAttempts).toBe(2);
    expect(cfg.npcGenTotalBudgetMs).toBe(12_000);
  });

  test("#53 falls back to defaults on invalid (non-integer) NPC-gen env", () => {
    const cfg = buildRuntimeConfig({
      ...fullEnv,
      NPC_GEN_TIMEOUT_MS: "soon",
      NPC_GEN_MAX_ATTEMPTS: "",
      NPC_GEN_TOTAL_BUDGET_MS: "1.5x",
    });
    expect(cfg.npcGenTimeoutMs).toBe(30_000);
    expect(cfg.npcGenMaxAttempts).toBe(3);
    expect(cfg.npcGenTotalBudgetMs).toBe(90_000);
  });

  test("#56 enumerates the NPC bot pool from BOT_TOKEN_1.. and stops at the first gap", () => {
    expect(buildRuntimeConfig(fullEnv).botPoolTokens).toEqual([]); // none configured

    const cfg = buildRuntimeConfig({
      ...fullEnv,
      BOT_TOKEN_1: "tok-a",
      BOT_TOKEN_2: "tok-b",
      BOT_TOKEN_3: "tok-c",
    });
    expect(cfg.botPoolTokens).toEqual(["tok-a", "tok-b", "tok-c"]);
  });

  test("#56 stops the pool at the first missing/blank index (no holes)", () => {
    const cfg = buildRuntimeConfig({
      ...fullEnv,
      BOT_TOKEN_1: "tok-a",
      // BOT_TOKEN_2 missing → enumeration stops here
      BOT_TOKEN_3: "tok-c", // ignored (after the gap)
    });
    expect(cfg.botPoolTokens).toEqual(["tok-a"]);

    const blank = buildRuntimeConfig({ ...fullEnv, BOT_TOKEN_1: "  " });
    expect(blank.botPoolTokens).toEqual([]); // blank counts as a gap
  });
});
