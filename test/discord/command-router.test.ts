import { describe, expect, test, vi } from "vitest";
import {
  createCommandRouter,
  type CommandEvent,
  type CommandRegistration,
} from "../../src/adapters/discord/command-router.js";

function event(overrides: Partial<CommandEvent> = {}): CommandEvent {
  return {
    name: "create-character-card",
    invokerId: "user-1",
    channelId: "chan-1",
    options: {},
    ...overrides,
  };
}

describe("#31 createCommandRouter — name→handler routing", () => {
  test("dispatches to the registered handler for the matching name with the CommandEvent", async () => {
    const handler = vi.fn(async () => {});
    const registrations: CommandRegistration[] = [
      { name: "create-character-card", scope: "any", handler },
    ];
    const router = createCommandRouter(registrations, {
      isOwner: () => true,
      inRoster: () => true,
    });

    const ev = event({ options: { concept: "a wandering bard" } });
    const result = await router.dispatch(ev);

    expect(result).toEqual({ kind: "dispatched", name: "create-character-card" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ev);
  });

  test("does not dispatch to handlers registered under other names", async () => {
    const wanted = vi.fn(async () => {});
    const other = vi.fn(async () => {});
    const router = createCommandRouter(
      [
        { name: "verify-card", scope: "any", handler: wanted },
        { name: "start-game", scope: "any", handler: other },
      ],
      { isOwner: () => true, inRoster: () => true },
    );

    await router.dispatch(event({ name: "verify-card" }));

    expect(wanted).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  test("an unknown command runs no handler and reports unknown-command", async () => {
    const handler = vi.fn(async () => {});
    const router = createCommandRouter([{ name: "verify-card", scope: "any", handler }], {
      isOwner: () => true,
      inRoster: () => true,
    });

    const result = await router.dispatch(event({ name: "nope-not-a-command" }));

    expect(result).toEqual({ kind: "unknown-command", name: "nope-not-a-command" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("#31 createCommandRouter — owner-scope permission gate", () => {
  test("an owner-scope command is denied (handler not run) when isOwner is false", async () => {
    const handler = vi.fn(async () => {});
    const router = createCommandRouter([{ name: "start-game", scope: "owner", handler }], {
      isOwner: () => false,
      inRoster: () => true,
    });

    const result = await router.dispatch(event({ name: "start-game" }));

    expect(result).toEqual({ kind: "denied", name: "start-game", scope: "owner" });
    expect(handler).not.toHaveBeenCalled();
  });

  test("an owner-scope command is dispatched when isOwner is true", async () => {
    const handler = vi.fn(async () => {});
    const router = createCommandRouter([{ name: "start-game", scope: "owner", handler }], {
      isOwner: () => true,
      inRoster: () => false,
    });

    const result = await router.dispatch(event({ name: "start-game" }));

    expect(result).toEqual({ kind: "dispatched", name: "start-game" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("#31 createCommandRouter — player-scope permission gate", () => {
  test("a player-scope command is denied (handler not run) when inRoster is false", async () => {
    const handler = vi.fn(async () => {});
    const router = createCommandRouter(
      [{ name: "create-character-card", scope: "player", handler }],
      { isOwner: () => false, inRoster: () => false },
    );

    const result = await router.dispatch(event({ name: "create-character-card" }));

    expect(result).toEqual({ kind: "denied", name: "create-character-card", scope: "player" });
    expect(handler).not.toHaveBeenCalled();
  });

  test("a player-scope command is dispatched when inRoster is true", async () => {
    const handler = vi.fn(async () => {});
    const router = createCommandRouter(
      [{ name: "create-character-card", scope: "player", handler }],
      { isOwner: () => false, inRoster: () => true },
    );

    const result = await router.dispatch(event({ name: "create-character-card" }));

    expect(result).toEqual({ kind: "dispatched", name: "create-character-card" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("the authority predicates receive the CommandEvent so they can scope to the campaign", async () => {
    const handler = vi.fn(async () => {});
    const inRoster = vi.fn(() => true);
    const router = createCommandRouter(
      [{ name: "create-character-card", scope: "player", handler }],
      { isOwner: () => false, inRoster },
    );

    const ev = event({ name: "create-character-card", invokerId: "player-7", channelId: "c-9" });
    await router.dispatch(ev);

    expect(inRoster).toHaveBeenCalledWith(ev);
  });
});
