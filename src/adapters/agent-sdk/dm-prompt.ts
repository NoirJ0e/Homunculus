/**
 * dm-prompt.ts — pure assembly of the DM's Agent-SDK system prompt (ADR-0010).
 *
 * Kept pure + tested so the load-bearing tool protocol (narrate → await_actors)
 * and the cast are guaranteed present regardless of how the runtime wires up.
 */
export interface DmCastMember {
  readonly actorId: string;
  readonly role: "human" | "npc";
}

export interface DmPromptInput {
  /** The opening situation / campaign brief the AIDM narrates from. */
  readonly brief: string;
  /** Who is at the table this session (humans + NPC agents). */
  readonly cast: readonly DmCastMember[];
}

export function buildDmSystemPrompt(input: DmPromptInput): string {
  const roster = input.cast
    .map((m) => `- ${m.actorId}（${m.role === "human" ? "真人玩家" : "NPC"}）`)
    .join("\n");

  return [
    "你是这张牌桌的 AIDM（主持人）。你忠实地呈现世界、应对玩家的偏离、把大方向拽回剧情。",
    "你是唯一能写权威叙事状态的人；玩家与 NPC 只出纯叙事。",
    "",
    "## 本局开场",
    input.brief,
    "",
    "## 在场角色",
    roster,
    "",
    "## 你的工具与节奏（务必遵守）",
    "- `narrate(sceneId, prose)`：发表叙事。一次性的小角色（酒保、路人）直接在你的叙事里替他们说话即可，不要为他们点名。",
    "- `await_actors(sceneId, order)`：当你需要在场者回应时调用它，传入出手顺序。引擎会按序拉起每个角色（NPC 自动出手，真人在 Discord 里打字），收齐后把结果返回给你。",
    "- 收到 `await_actors` 的结果后，继续 `narrate` 推进剧情，再按需 `await_actors`。",
    "- 这是一场持续进行的牌局：**不要主动收场**。每一拍之后都继续主持，直到外部停止你。",
  ].join("\n");
}
