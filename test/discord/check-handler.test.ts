import { describe, expect, test } from "vitest";
import type { CommandEvent } from "../../src/adapters/discord/command-router.js";
import { actorId } from "../../src/domain/ids.js";
import type { HumanTurn } from "../../src/ports/human-inbox.js";
import type { CheckSessionHandle } from "../../src/runtime/check-session.js";
import { createCheckHandler } from "../../src/adapters/discord/check-handler.js";

/**
 * #44 — the `/check` handler. The human pulls the trigger on their OWN pending
 * check (ADR-0013): with a live session that has a pending check for the invoker,
 * it injects a `{kind:"roll", advantage?}` turn into the session inbox (the engine
 * then resolves it via BCDice). No live session / no pending → an ephemeral
 * "nothing to roll" reply, and NO turn injected.
 */

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  name: "check",
  invokerId: "player-1",
  channelId: "chan-main",
  options: {},
  ...over,
});

function makeSession(pendingActors: readonly string[], turns: HumanTurn[]): CheckSessionHandle {
  return {
    hasPending: (actor) => pendingActors.includes(actor),
    deliverTurn: (turn) => turns.push(turn),
  };
}

describe("/check handler", () => {
  test("with a pending check, injects a straight roll turn (no advantage option)", async () => {
    const turns: HumanTurn[] = [];
    const session = makeSession(["player-1"], turns);
    const replies: string[] = [];
    const handler = createCheckHandler({
      sessionFor: () => session,
      resolveActor: (invokerId) => actorId(invokerId),
      reply: async (text) => {
        replies.push(text);
      },
    });

    await handler(event());

    expect(turns).toEqual([{ kind: "roll" }]);
    expect(replies).toEqual([]);
  });

  test("maps 优势 → advantage and 劣势 → disadvantage into the roll turn", async () => {
    const adv: HumanTurn[] = [];
    const advSession = makeSession(["player-1"], adv);
    const advH = createCheckHandler({
      sessionFor: () => advSession,
      resolveActor: (id) => actorId(id),
      reply: async () => {},
    });
    await advH(event({ options: { advantage: "优势" } }));
    expect(adv).toEqual([{ kind: "roll", advantage: "advantage" }]);

    const dis: HumanTurn[] = [];
    const disSession = makeSession(["player-1"], dis);
    const disH = createCheckHandler({
      sessionFor: () => disSession,
      resolveActor: (id) => actorId(id),
      reply: async () => {},
    });
    await disH(event({ options: { advantage: "劣势" } }));
    expect(dis).toEqual([{ kind: "roll", advantage: "disadvantage" }]);
  });

  test("no live session → ephemeral 'nothing to roll', no injection", async () => {
    const replies: string[] = [];
    const handler = createCheckHandler({
      sessionFor: () => undefined,
      resolveActor: (id) => actorId(id),
      reply: async (t) => {
        replies.push(t);
      },
    });
    await handler(event());
    expect(replies).toEqual(["你当前没有待掷的检定。"]);
  });

  test("live session but no pending check for the invoker → 'nothing to roll', no injection", async () => {
    const turns: HumanTurn[] = [];
    const session = makeSession(["someone-else"], turns);
    const replies: string[] = [];
    const handler = createCheckHandler({
      sessionFor: () => session,
      resolveActor: (id) => actorId(id),
      reply: async (t) => {
        replies.push(t);
      },
    });
    await handler(event());
    expect(turns).toEqual([]);
    expect(replies).toEqual(["你当前没有待掷的检定。"]);
  });
});
