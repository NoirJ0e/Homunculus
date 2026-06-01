import { describe, expect, test, vi } from "vitest";
import {
  COMMAND_DESCRIPTIONS,
  createCommandSet,
  type CommandSetHandlers,
} from "../../src/adapters/discord/command-set.js";
import { createCommandRouter, type CommandScope } from "../../src/adapters/discord/command-router.js";
import { describeCommands } from "../../src/adapters/discord/command-interaction.js";

function noopHandlers(): CommandSetHandlers {
  return {
    createCharacterCard: vi.fn(async () => {}),
    verifyCard: vi.fn(async () => {}),
    startGame: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    setRoster: vi.fn(async () => {}),
    addAiSeat: vi.fn(async () => {}),
  };
}

describe("#31 createCommandSet — ADR-0012 initial command set + scopes", () => {
  test("defines the expected commands with their scopes", () => {
    const set = createCommandSet(noopHandlers());
    const scopeByName = new Map<string, CommandScope>(set.map((r) => [r.name, r.scope]));

    expect(scopeByName.get("create-character-card")).toBe("player");
    expect(scopeByName.get("verify-card")).toBe("player");
    expect(scopeByName.get("start-game")).toBe("owner");
    expect(scopeByName.get("approve")).toBe("owner");
    expect(scopeByName.get("set-roster")).toBe("any"); // bootstrap: first caller claims owner (handler self-guards)
    expect(scopeByName.get("add-ai-seat")).toBe("owner");
    expect(set).toHaveLength(6);
  });

  test("every command has a registration-ready description", () => {
    const set = createCommandSet(noopHandlers());
    const descriptors = describeCommands(set, COMMAND_DESCRIPTIONS);
    for (const d of descriptors) {
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.description).not.toBe(d.name);
    }
  });

  test("wired through the router, an owner invoking set-roster reaches setRoster", async () => {
    const handlers = noopHandlers();
    const router = createCommandRouter(createCommandSet(handlers), {
      isOwner: () => true,
      inRoster: () => true,
    });

    const result = await router.dispatch({
      name: "set-roster",
      invokerId: "owner-1",
      channelId: "lobby",
      options: { players: "@a @b" },
    });

    expect(result.kind).toBe("dispatched");
    expect(handlers.setRoster).toHaveBeenCalledTimes(1);
  });

  test("a non-owner invoking the owner-only start-game is denied without running the handler", async () => {
    const handlers = noopHandlers();
    const router = createCommandRouter(createCommandSet(handlers), {
      isOwner: () => false,
      inRoster: () => true,
    });

    const result = await router.dispatch({
      name: "start-game",
      invokerId: "player-2",
      channelId: "main",
      options: {},
    });

    expect(result.kind).toBe("denied");
    expect(handlers.startGame).not.toHaveBeenCalled();
  });
});
