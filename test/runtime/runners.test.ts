import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postAssistantText, buildCampaignBrief } from "../../src/runtime/runners.js";
import type { DiscordClient, SentMessage } from "../../src/adapters/discord/discord-substrate.js";
import { genesisCampaign } from "../../src/genesis/campaign-genesis.js";
import { FileCampaignStore } from "../../src/adapters/store/file-campaign-store.js";
import { campaignId } from "../../src/domain/ids.js";

/**
 * Regression for the live "[ready] 但完全没反应" bug: the conversational concierge /
 * card-creation runners drained their query stream but never posted the model's
 * replies back to Discord, so they ran invisibly. `postAssistantText` now does
 * the posting; these tests pin that behavior headless (fake stream + recording
 * client), no real discord.js / SDK.
 */
function recordingClient(): {
  client: DiscordClient;
  posts: Array<{ channelId: string; msg: SentMessage }>;
} {
  const posts: Array<{ channelId: string; msg: SentMessage }> = [];
  const client: DiscordClient = {
    async sendWebhookMessage(channelId, msg) {
      posts.push({ channelId, msg });
    },
    async fetchMessages() {
      return [];
    },
  };
  return { client, posts };
}

async function* fakeStream(msgs: readonly unknown[]): AsyncIterable<unknown> {
  for (const m of msgs) yield m;
}

describe("postAssistantText", () => {
  test("posts each assistant text block to the channel as the given persona", async () => {
    const { client, posts } = recordingClient();

    await postAssistantText(
      client,
      "chan-1",
      "门房",
      fakeStream([
        { type: "assistant", message: { content: [{ type: "text", text: "想跑什么基调的团？" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "好的，建团中…" }] } },
      ]),
    );

    expect(posts.map((p) => p.msg.content)).toEqual(["想跑什么基调的团？", "好的，建团中…"]);
    expect(posts.every((p) => p.channelId === "chan-1" && p.msg.username === "门房")).toBe(true);
  });

  test("skips non-text blocks, blank text, and non-assistant messages", async () => {
    const { client, posts } = recordingClient();

    await postAssistantText(
      client,
      "c",
      "门房",
      fakeStream([
        { type: "system" },
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use" },
              { type: "text", text: "   " },
              { type: "text", text: "真正的回复" },
            ],
          },
        },
        { type: "result" },
      ]),
    );

    expect(posts.map((p) => p.msg.content)).toEqual(["真正的回复"]);
  });
});

describe("buildCampaignBrief", () => {
  test("carries the campaign's secretTruth + opening milestone so the AIDM narrates on-theme", () => {
    const bible = genesisCampaign({
      premise: "沉船湾海底的古老诅咒正在苏醒",
      tone: "克系恐怖",
      desiredClimax: "潜入沉船核心斩断诅咒之源",
      levelBand: [1, 5],
    });

    const brief = buildCampaignBrief(bible);

    // The AIDM-private 底牌 (premise/tone) reaches the brief — no more generic tavern.
    expect(brief).toContain("沉船湾海底的古老诅咒正在苏醒");
    expect(brief).toContain("克系恐怖");
    // And the opening milestone's cue is included to anchor the first scene.
    const opening = bible.milestones[0];
    expect(opening).toBeDefined();
    if (opening) expect(brief).toContain(opening.enterCue);
  });

  describe("restart semantics (persistent CampaignStore)", () => {
    let dataDir: string;

    beforeEach(() => {
      dataDir = mkdtempSync(join(tmpdir(), "homunculus-runners-"));
    });

    afterEach(() => {
      rmSync(dataDir, { recursive: true, force: true });
    });

    test("the AIDM brief is built from the bible read back through a FRESH store (survives restart)", () => {
      const camp = campaignId("camp:sunken");
      const bible = genesisCampaign({
        premise: "沉船湾海底的古老诅咒正在苏醒",
        tone: "克系恐怖",
        desiredClimax: "潜入沉船核心斩断诅咒之源",
        levelBand: [1, 5],
      });

      // A prior process writes the bible to disk…
      new FileCampaignStore(dataDir).set(camp, bible);
      // …and after a restart, a brand-new store reads it back from disk.
      const reloaded = new FileCampaignStore(dataDir).get(camp);
      expect(reloaded).toBeDefined();

      // The AIDM runner builds its brief from exactly that round-tripped bible.
      const brief = buildCampaignBrief(reloaded!);
      expect(brief).toContain("沉船湾海底的古老诅咒正在苏醒");
      expect(brief).toContain("克系恐怖");
      const opening = reloaded!.milestones[0];
      expect(opening).toBeDefined();
      if (opening) expect(brief).toContain(opening.enterCue);
    });
  });
});
