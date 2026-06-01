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
});
