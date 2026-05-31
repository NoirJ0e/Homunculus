# 9. Agent SDK 驱动 + 引擎即 MCP 工具裁判（控制权半反转）

- 状态：Accepted
- 日期：2026-06-01
- 关系：改写 [ADR-0003] 的节奏触发方式；细化 [ADR-0002] 的共治边界落地为工具权限；不动 [ADR-0001/0004/0005/0006/0007/0008] 的决策内核。

## 背景

v1 第一版的 Agent 端口用 **Messages API（chat SDK）**，由确定性引擎当导演、循环调 `agent.takeTurn()`。两个驱动力要求转向：

- **friction**：引擎把节奏/裁决一步步编排死，凡 agent 行为出偏差就要在引擎里补 patch。希望"写个大致 workflow 交给 Agent，它自带小工具，出问题自己组合工具修"——friction 最少的设计就是好设计。
- **省钱**：希望复用 Claude 订阅额度（Pro/Max 的 Agent SDK 月度额度），而非按 token 付费的 API 信用点。

## 决策

### 控制权半反转
- **DM 完全反转**：DM = 一个长活的 **Agent SDK `query()` 自驱循环**，主动调引擎暴露的工具（`narrate` / `await_actors` / `advance_milestone` …）推动牌桌。自治活在叙事 judgment 里。
- **NPC 不反转**：当 DM 的 `await_actors` 挂起时，**引擎**按出手顺序拉起在场 NPC（先过唤醒闸，再让其 agent 出 `speak`/`pass`/`roll`）。每个 NPC 仍是独立 agent + 独立上下文——保住 PRD"每 NPC 一个 agent，满注意力扮演单个角色"的核心赌注。

### 引擎 = 进程内 MCP 工具裁判
- 引擎用 Agent SDK 的 `createSdkMcpServer` + `tool()`（Zod schema）把能力暴露成工具；工具 handler 是**同进程 TS 闭包**，直接调用现有纯内核（pacing/scenes/canonicity/memory/milestone/world-clock/...），共享状态、零 IPC。
- 引擎从"导演"退为"裁判 + 共享状态"。**纪律从"求 agent 配合"变成"工具边界物理强制"**：
  - **NPC 角色拿不到 `narrate`/`advance_milestone`** → 纯叙事共治（[ADR-0002]）在工具权限层强制，不靠 prompt 自觉。
  - **DM 只有 `read_card`、没有 `write_card`** → SealDice 唯一写权威（[ADR-0001/0002]）物理保证。
  - **真人沉默时 `await_actors` 溢出一轮后不返回** → [ADR-0003] 的暂停语义变成"一个挂起的 await"，DM 物理上绕不过去。

### 节奏触发方式（改写 [ADR-0003] 的机制、不改其语义）
- 旧：AIDM 写完散文吐 `awaiting:[...]`/`continue` 控制信号，引擎据此 hold/放行。
- 新：AIDM 调工具 `await_actors(sceneId, order)`；引擎按 [ADR-0003] 的"简化战斗轮"跑这一轮（后手看前手、效果留存、真人是闸、溢出一轮即 hang），收齐后让工具返回。

### 鉴权
- 复用 Claude 订阅：`CLAUDE_CODE_OAUTH_TOKEN`（Pro/Max 的 Agent SDK 月度额度）。落地前用最小 `query()` 实测 SDK 是否认此 token；不认则回退 `ANTHROPIC_API_KEY`（仅影响省钱，不影响架构）。
- **红线**：订阅 token 仅自用；多人化（pillar 3）时各操控者各自鉴权，不共用订阅。

### 抢救内核、重写外壳
- **保留**：domain 全部；engine 纯逻辑（pacing/scenes/canonicity/memory/milestone-cursor/world-clock/soft-gravity/world-branch/reflection/controller/roster）及其单测；SealDice/Discord/genesis 适配器；非 agent 的端口与假实现。
- **删除**：`ports/agent.ts`（AgentPort）、`adapters/anthropic/anthropic-agent.ts`（chat 适配器）、`adapters/memory/fake-agent.ts`、以及针对旧导演循环写的编排型集成测试。
- **新建**：MCP 工具服务器、DM 的 Agent-SDK 驱动、NPC 单次出手、简化战斗轮小循环；编排型集成测试以"假工具调用流"形态重写（替代旧 FakeAgent 的角色）。

## 备选

- **维持 chat SDK + API key（不转向）**：省事但 friction 高、不省钱。否决（用户明确要转）。
- **DM 完全接管、引擎变薄**：friction 绝对最小，但防碰撞/暂停保证退化成"prompt 里求它别抢话"，模型可能不听，确定性测试也丢。否决。
- **只换鉴权/底层、编排不动**：Agent SDK 的自治循环与"引擎当导演"冲突，等于买了 SDK 却不用其长处。否决。
- **独立 MCP server 进程（stdio/HTTP）**：更解耦，但引入进程间通信 + 状态同步复杂度，对单机跑团是 over-engineering。否决，选进程内。
- **NPC 也走 Agent-SDK 自治循环**：最贴 PRD，但 NPC 不需要自治循环（引擎带节奏即可），多个自治循环并发徒增成本与编排难度。NPC 用单次调用即可（chat-SDK 单次或 Agent-SDK 单次，实现时择简）。

## 后果

- friction 大降：DM 行为偏差由它自己组合工具修，引擎不再为每种情况补 patch。
- 共治/暂停/唯一写权威三条不变量从"约定"升级为"工具边界物理事实"。
- 测试范式微调：编排测试从"假 agent 返回脚本化响应"变成"假工具调用序列"驱动；纯内核单测不受影响。
- 依赖一次订阅鉴权实测（寄存）；**锚点问题**（AI 比真人快/准、把结论摆上桌可能架空真人）由 [ADR-0003] 的"溢出一轮"缓冲 + 粒度旋钮调，暂不拍死。
