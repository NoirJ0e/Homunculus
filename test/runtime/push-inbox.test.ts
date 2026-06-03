import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../../src/domain/ids.js";
import type { GatewayMessage } from "../../src/adapters/discord/message-events.js";
import { PushInbox } from "../../src/runtime/push-inbox.js";

const scene = sceneId("scene-tavern");
const human = actorId("player");

const msg = (content: string, over: Partial<GatewayMessage> = {}): GatewayMessage => ({
  threadId: "chan-main",
  userId: "user-1",
  content,
  messageId: "m1",
  ...over,
});

describe("#28 PushInbox — the dispatcher-fed HumanInboxPort", () => {
  test("deliver-then-poll resolves with the delivered in-character turn", async () => {
    const inbox = new PushInbox();
    inbox.deliver(msg("我推开门。"));
    expect(await inbox.poll(human, scene)).toEqual({ kind: "prose", prose: "我推开门。" });
  });

  test("poll-then-deliver resolves the pending poll", async () => {
    const inbox = new PushInbox();
    const pending = inbox.poll(human, scene);
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    inbox.deliver(msg("我拔剑。"));
    expect(await pending).toEqual({ kind: "prose", prose: "我拔剑。" });
  });

  test("an OOC delivery does not resolve the poll; it keeps waiting for a real turn", async () => {
    const inbox = new PushInbox();
    const pending = inbox.poll(human, scene);
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });

    inbox.deliver(msg("(brb 接个电话)"));
    inbox.deliver(msg("（继续）"));
    await Promise.resolve();
    expect(resolved).toBe(false); // OOC skipped, still holding

    inbox.deliver(msg("我回来了，行动。"));
    expect(await pending).toEqual({ kind: "prose", prose: "我回来了，行动。" });
  });

  test("maps pass → pass through the shared convention (`.ra` is gone, now prose)", async () => {
    const inbox = new PushInbox();

    // ADR-0013: `.ra` is no longer a magic roll trigger — it is ordinary prose.
    const proseP = inbox.poll(human, scene);
    inbox.deliver(msg(".ra 侦查"));
    expect(await proseP).toEqual({ kind: "prose", prose: ".ra 侦查" });

    const passP = inbox.poll(human, scene);
    inbox.deliver(msg("pass"));
    expect(await passP).toEqual({ kind: "pass" });
  });

  test("deliverTurn injects a pre-formed roll turn, resolving a waiting poll", async () => {
    const inbox = new PushInbox();
    const rollP = inbox.poll(human, scene);
    inbox.deliverTurn({ kind: "roll", advantage: "advantage" });
    expect(await rollP).toEqual({ kind: "roll", advantage: "advantage" });
  });

  test("deliverTurn before a poll is buffered and returned by the next poll", async () => {
    const inbox = new PushInbox();
    inbox.deliverTurn({ kind: "roll" });
    expect(await inbox.poll(human, scene)).toEqual({ kind: "roll" });
  });

  test("a message delivered before any poll is buffered and returned by the next poll", async () => {
    const inbox = new PushInbox();
    inbox.deliver(msg("我先发制人。"));
    expect(await inbox.poll(human, scene)).toEqual({ kind: "prose", prose: "我先发制人。" });
  });

  test("an OOC delivery before poll is NOT buffered as a turn", async () => {
    const inbox = new PushInbox();
    inbox.deliver(msg("(先吃个饭)"));
    const pending = inbox.poll(human, scene);
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    inbox.deliver(msg("我回来了。"));
    expect(await pending).toEqual({ kind: "prose", prose: "我回来了。" });
  });
});
