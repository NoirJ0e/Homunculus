import { describe, expect, test } from "vitest";
import { actorId, sceneId } from "../../src/domain/ids.js";
import type { Post } from "../../src/domain/post.js";
import type { ActorPersona } from "../../src/adapters/discord/scene-threads.js";
import type { SentMessage } from "../../src/adapters/discord/discord-substrate.js";
import type { PoolBot } from "../../src/adapters/discord/bot-pool.js";
import {
  MultiBotSubstrate,
  DiscordSubstrateError,
} from "../../src/adapters/discord/multi-bot-substrate.js";

/**
 * #56 — MultiBotSubstrate routes each NPC's post through ITS OWN pool bot (a real
 * @-mentionable identity), the AIDM + overflow NPCs through the shared webhook,
 * and renders a post's `mentions` as real Discord @-pings (cue @真人). Tested with
 * fake pool bots + a fake webhook client; the real login/nickname is live glue.
 */

const scene = sceneId("scene:main");
const aidm = actorId("aidm");
const zhou = actorId("npc-zhoushen");
const human = actorId("player");

function fakePoolBot(userId: string) {
  const sends: { channelId: string; content: string; mentions?: readonly string[] }[] = [];
  const bot: PoolBot = {
    userId,
    send: async (channelId, content, mentions) => {
      sends.push({ channelId, content, ...(mentions !== undefined && { mentions }) });
    },
    setNickname: async () => {},
  };
  return { bot, sends };
}

function fakeWebhook() {
  const sent: { threadId: string; message: SentMessage }[] = [];
  return {
    client: {
      sendWebhookMessage: async (threadId: string, message: SentMessage) => {
        sent.push({ threadId, message });
      },
      fetchMessages: async () => [],
    },
    sent,
  };
}

const personas: ActorPersona[] = [
  { actorId: aidm, username: "地下城主" },
  { actorId: zhou, username: "周慎" },
  { actorId: human, username: "玩家", discordUserId: "9001" },
];

describe("MultiBotSubstrate", () => {
  test("an NPC with an assigned pool bot posts through THAT bot, not the webhook", async () => {
    const zhouBot = fakePoolBot("bot-zhou");
    const wh = fakeWebhook();
    const sub = new MultiBotSubstrate({
      webhook: wh.client,
      personas,
      threadMap: { [scene]: "chan-1" },
      botFor: (a) => (a === zhou ? zhouBot.bot : undefined),
    });

    await sub.emit({ sceneId: scene, actorId: zhou, prose: "周慎点头。" } as Post);

    expect(zhouBot.sends).toEqual([{ channelId: "chan-1", content: "周慎点头。" }]);
    expect(wh.sent).toEqual([]); // NOT the shared webhook
  });

  test("the AIDM (no pool bot) posts through the shared webhook with its persona", async () => {
    const wh = fakeWebhook();
    const sub = new MultiBotSubstrate({
      webhook: wh.client,
      personas,
      threadMap: { [scene]: "chan-1" },
      botFor: () => undefined,
    });

    await sub.emit({ sceneId: scene, actorId: aidm, prose: "夜风灌进酒馆。" } as Post);

    expect(wh.sent).toHaveLength(1);
    expect(wh.sent[0]?.message.username).toBe("地下城主");
    expect(wh.sent[0]?.message.content).toBe("夜风灌进酒馆。");
  });

  test("a cue with mentions renders a real @-ping of the human (cue @真人)", async () => {
    const wh = fakeWebhook();
    const sub = new MultiBotSubstrate({
      webhook: wh.client,
      personas,
      threadMap: { [scene]: "chan-1" },
      botFor: () => undefined,
    });

    await sub.emit({
      sceneId: scene,
      actorId: aidm,
      prose: "老张，轮到你了。",
      mentions: [human],
    } as Post);

    const msg = wh.sent[0]?.message;
    expect(msg?.content).toContain("<@9001>"); // the real Discord ping
    expect(msg?.allowedUserMentions).toEqual(["9001"]); // and allowed_mentions to push
  });

  test("an NPC bot post carries its mention ids through to the bot send", async () => {
    const zhouBot = fakePoolBot("bot-zhou");
    const wh = fakeWebhook();
    const sub = new MultiBotSubstrate({
      webhook: wh.client,
      personas,
      threadMap: { [scene]: "chan-1" },
      botFor: (a) => (a === zhou ? zhouBot.bot : undefined),
    });

    await sub.emit({
      sceneId: scene,
      actorId: zhou,
      prose: "周慎看向老张。",
      mentions: [human],
    } as Post);

    expect(zhouBot.sends[0]?.content).toContain("<@9001>");
    expect(zhouBot.sends[0]?.mentions).toEqual(["9001"]);
  });

  test("a missing scene→thread mapping throws", async () => {
    const sub = new MultiBotSubstrate({
      webhook: fakeWebhook().client,
      personas,
      threadMap: {},
      botFor: () => undefined,
    });
    await expect(
      sub.emit({ sceneId: scene, actorId: aidm, prose: "x" } as Post),
    ).rejects.toBeInstanceOf(DiscordSubstrateError);
  });
});
