import { describe, expect, test } from "vitest";
import { buildSessionConfig } from "../../src/runtime/config.js";

const fullEnv = {
  DISCORD_BOT_TOKEN: "bot-tok",
  DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc",
  DISCORD_SCENE_THREAD_ID: "thread-123",
  DISCORD_PLAYER_USER_ID: "user-456",
};

describe("#4/#20 buildSessionConfig — assemble the first-session config from env", () => {
  test("throws a clear error when a required Discord var is missing", () => {
    for (const key of Object.keys(fullEnv)) {
      const partial = { ...fullEnv };
      delete (partial as Record<string, string>)[key];
      expect(() => buildSessionConfig(partial)).toThrow(new RegExp(key));
    }
  });

  test("maps the scene to the thread and routes the human by discord user id", () => {
    const cfg = buildSessionConfig(fullEnv);

    expect(cfg.threadMap[cfg.sceneId]).toBe("thread-123");

    // The human player's persona carries the discord user id (for the inbox);
    // DM + NPC personas do not (they only send, never receive).
    const human = cfg.personas.find((p) => p.actorId === cfg.humanActorId)!;
    expect(human.discordUserId).toBe("user-456");
    const dm = cfg.personas.find((p) => p.actorId === cfg.aidmId)!;
    expect(dm.discordUserId).toBeUndefined();
  });

  test("carries the opening brief and the NPC persona for the drivers", () => {
    const cfg = buildSessionConfig(fullEnv);
    expect(cfg.brief.length).toBeGreaterThan(0);
    expect(cfg.npc.persona.length).toBeGreaterThan(0);
    expect(cfg.discord.botToken).toBe("bot-tok");
    expect(cfg.discord.webhookUrl).toBe("https://discord.com/api/webhooks/1/abc");
  });
});
