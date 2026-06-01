import type { Post } from "../../domain/post.js";

/**
 * npc-prompt.ts — pure assembly of an NPC's single-turn prompt (ADR-0010).
 *
 * The NPC sees only its persona core + the transcript it's allowed to see (its
 * scene horizon — the engine passes the visibility-scoped slice). Kept pure +
 * tested so the persona and the just-seen posts are guaranteed present.
 */
export interface NpcPromptInput {
  /** The NPC's resident persona core (who it is, how it acts). */
  readonly persona: string;
  /** Posts visible to this NPC right now (its horizon, incl. this round's). */
  readonly transcript: readonly Post[];
}

export function buildNpcPrompt(input: NpcPromptInput): string {
  const log =
    input.transcript.length > 0
      ? input.transcript.map((p) => `${p.actorId}：${p.prose}`).join("\n")
      : "（场景刚开始，还没有人发言。）";

  return [
    "## 你是谁",
    input.persona,
    "",
    "## 此刻场上发生了什么（只有你能看到的部分）",
    log,
    "",
    "## 现在轮到你",
    "用第一人称、贴合你人格地行动或发言一句——只出你这个角色会说/做的纯叙事，不要写旁白、不要替别人发言、不要描述规则数值。",
    "如果此刻你这个角色确实没有任何要说或做的，就回复空（什么都不输出）。",
  ].join("\n");
}
