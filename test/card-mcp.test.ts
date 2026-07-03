import { describe, expect, test } from "vitest";
import { cardTools } from "../src/adapters/agent-sdk/card-mcp.js";
import { CardCreationSession } from "../src/runtime/card-creation-session.js";
import { actorId, campaignId } from "../src/domain/ids.js";
import type { DiceSystem } from "../src/ports/card-store.js";

/** arch-C2 — the draft pipeline's missing link: the assistant's `hold_card`
 *  tool must land REAL drafts on the session, so `/verify-card` adjudicates the
 *  talked-out card instead of the genesis fallback. */

function makeSession(): CardCreationSession {
  return new CardCreationSession({
    threadId: "thread-1",
    actorId: actorId("player-1"),
    campaignId: campaignId("camp-1"),
    deliver: () => {},
  });
}

function holdCardHandler(session: CardCreationSession | undefined, system: DiceSystem = "coc7") {
  const tools = cardTools(() => (session ? { session, system } : undefined));
  const hold = tools.find((t) => t.name === "hold_card");
  if (!hold) throw new Error("hold_card tool missing");
  return hold.handler;
}

describe("card-mcp hold_card — 草稿真的落到 session（修断路）", () => {
  test("聊定的人设落成 soul 草稿 + 本团系统的基线 sheet", async () => {
    const session = makeSession();
    const handler = holdCardHandler(session, "coc7");

    const res = await handler(
      { name: "沈青梧", temperament: "冷静克制的女法医", goals: ["查清妹妹的死因"] },
      {},
    );

    const drafts = session.drafts;
    expect(drafts.soul?.personaCore.name).toBe("沈青梧");
    expect(drafts.soul?.personaCore.goals).toEqual(["查清妹妹的死因"]);
    expect(drafts.sheet?.system).toBe("coc7");
    // The tool confirms so the assistant can prompt /verify-card.
    expect(JSON.stringify(res.content)).toContain("verify-card");
  });

  test("dnd5e 团落 dnd5e 基线 sheet（不是 CoC7 卡）", async () => {
    const session = makeSession();
    await holdCardHandler(session, "dnd5e")({ name: "Borr", temperament: "鲁莽" }, {});
    expect(session.drafts.sheet?.system).toBe("dnd5e");
    expect(session.drafts.sheet?.characterClass).toBeDefined();
  });

  test("再调一次覆盖旧草稿（玩家改主意是常态）", async () => {
    const session = makeSession();
    const handler = holdCardHandler(session);
    await handler({ name: "初版", temperament: "a" }, {});
    await handler({ name: "定稿", temperament: "b" }, {});
    expect(session.drafts.soul?.personaCore.name).toBe("定稿");
  });

  test("session 未绑定：不炸，报文本让玩家重开", async () => {
    const handler = holdCardHandler(undefined);
    const res = await handler({ name: "无处落", temperament: "x" }, {});
    expect(JSON.stringify(res.content)).toContain("create-character-card");
  });
});
