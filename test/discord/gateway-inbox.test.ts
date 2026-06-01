import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../../src/domain/ids.js";
import type { ActorPersona, SceneThreadMap } from "../../src/adapters/discord/scene-threads.js";
import type {
  GatewayMessage,
  MessageEventSource,
} from "../../src/adapters/discord/message-events.js";
import { GatewayInbox } from "../../src/adapters/discord/gateway-inbox.js";

/** Hand-driven gateway event source — the test stand-in for discord.js. */
class FakeEventSource implements MessageEventSource {
  private readonly handlers: Array<(m: GatewayMessage) => void> = [];
  onMessage(handler: (m: GatewayMessage) => void): void {
    this.handlers.push(handler);
  }
  emit(m: GatewayMessage): void {
    for (const h of this.handlers) h(m);
  }
}

const scene = sceneId("scene-tavern");
const human = actorId("human-1");
const THREAD = "thread-001";
const USER = "discord-user-111";

const personas: ActorPersona[] = [
  { actorId: human, username: "Thorin", discordUserId: USER },
];
const threadMap: SceneThreadMap = { [scene]: THREAD };

const msg = (over: Partial<GatewayMessage> = {}): GatewayMessage => ({
  threadId: THREAD,
  userId: USER,
  content: "我搜索房间。",
  messageId: "m1",
  ...over,
});

describe("#20/#4 GatewayInbox — blocking human-await over pushed events", () => {
  test("poll does not resolve until a matching message arrives, then maps it", async () => {
    const source = new FakeEventSource();
    const inbox = new GatewayInbox(source, personas, threadMap);

    const pending = inbox.poll(human, scene);
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    // No message yet → still pending (the infinite hold, ADR-0003).
    await Promise.resolve();
    expect(resolved).toBe(false);

    source.emit(msg({ content: "我搜索房间。" }));
    expect(await pending).toEqual({ kind: "prose", prose: "我搜索房间。" });
  });

  test("ignores messages from other users or other threads", async () => {
    const source = new FakeEventSource();
    const inbox = new GatewayInbox(source, personas, threadMap);

    const pending = inbox.poll(human, scene);
    source.emit(msg({ userId: "someone-else", content: "noise" }));
    source.emit(msg({ threadId: "other-thread", content: "elsewhere" }));
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false); // neither matched

    source.emit(msg({ content: "终于轮到我。" }));
    expect(await pending).toEqual({ kind: "prose", prose: "终于轮到我。" });
  });

  test("maps .ra → roll and pass → pass (shared convention)", async () => {
    const source = new FakeEventSource();
    const inbox = new GatewayInbox(source, personas, threadMap);

    const rollP = inbox.poll(human, scene);
    source.emit(msg({ content: ".ra 侦查" }));
    expect(await rollP).toEqual({ kind: "roll" });

    const passP = inbox.poll(human, scene);
    source.emit(msg({ content: "pass" }));
    expect(await passP).toEqual({ kind: "pass" });
  });

  test("OOC messages (leading paren) do not resolve poll; it keeps waiting for the next in-character message", async () => {
    const source = new FakeEventSource();
    const inbox = new GatewayInbox(source, personas, threadMap);

    const pending = inbox.poll(human, scene);
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });

    // OOC chatter arrives — must be skipped: not resolved, not fed to the DM.
    source.emit(msg({ content: "(brb 接个电话)" }));
    source.emit(msg({ content: "（继续）" }));
    await Promise.resolve();
    expect(resolved).toBe(false); // still holding for a real in-character turn

    // A genuine in-character message finally arrives → it resolves the await.
    source.emit(msg({ content: "我推开门。" }));
    expect(await pending).toEqual({ kind: "prose", prose: "我推开门。" });
  });

  test("an OOC message arriving before poll is not buffered as a turn", async () => {
    const source = new FakeEventSource();
    const inbox = new GatewayInbox(source, personas, threadMap);

    source.emit(msg({ content: "(先吃个饭)" })); // OOC before anyone polls
    const pending = inbox.poll(human, scene);
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false); // OOC was not buffered as a turn

    source.emit(msg({ content: "我回来了，行动。" }));
    expect(await pending).toEqual({ kind: "prose", prose: "我回来了，行动。" });
  });

  test("a message arriving before poll is buffered and returned by the next poll", async () => {
    const source = new FakeEventSource();
    const inbox = new GatewayInbox(source, personas, threadMap);

    source.emit(msg({ content: "我先发制人。" })); // arrives before anyone polls
    // Now poll — should get the buffered turn immediately, not hang.
    expect(await inbox.poll(human, scene)).toEqual({ kind: "prose", prose: "我先发制人。" });
  });

  test("throws when the scene has no thread mapping or the actor has no discordUserId", async () => {
    const source = new FakeEventSource();
    const inbox = new GatewayInbox(source, personas, threadMap);

    await expect(inbox.poll(human, sceneId("scene-unmapped"))).rejects.toThrow();
    await expect(inbox.poll(actorId("no-persona"), scene)).rejects.toThrow();
  });
});
