# Plan: 第一个可在 Discord 玩起来的 session

> 落地 [ADR-0010]。目标：1 DM agent + 1 队友 NPC agent + 1 真人，单 thread=单场景，真的在 Discord 里跑通至少一拍真人参与的牌局。
> 推进 issues #20（真 DM 驱动 + 鉴权实测）、#21（真 NPC 出手驱动）、#4（Discord 最后一条 HITL 验收）。

## 原则

- **承重假设先排雷**（Phase 0 spike），再建正式件。
- **TDD 守在 DI 接缝内**：driver / inbox / config / 系统提示拼装都注入"query 运行器"或"事件源"，用假实现做 headless 单测。
- **HITL 只留不可约的 live 壳**：真 gateway 连接、真订阅鉴权、真 LLM 行为、真在 Discord 跑一拍。
- 引擎 / referee **一行不动**（接缝已就位）。每阶段结束 `tsc --noEmit` + `vitest run` 全绿 + 引擎纯度守卫绿。

---

## Phase 0 — 承重假设 spike（HITL，throwaway，不计入测试套件）

**目的**：在写任何正式件前，单独验掉 [ADR-0010] 标的承重点——SDK 能否在一个 `query()` 的工具 handler 里**嵌套跑另一个 `query()`**、**容忍该 handler 长时间阻塞**、并认**订阅 token**。

- 文件：`scripts/spike-nested-query.mjs`（throwaway，不进 `src/`）。
- 内容：一个 DM `query()`，挂一个进程内 MCP 工具 `await_thing`，其 handler ①`await` 一个 ~10s 的定时器（模拟阻塞等真人），②中途 `await` 一个**嵌套** NPC `query()`（让它返回一句话），再返回给 DM。控制台打印两边输出。
- 鉴权：优先 `CLAUDE_CODE_OAUTH_TOKEN`，回退 `ANTHROPIC_API_KEY`。

**Decision gate**：
- ✅ 嵌套 query + 长阻塞 handler + 订阅鉴权都通 → 按本计划继续。
- ❌ 嵌套 query 不可行 → NPC 回退 Messages API（[ADR-0010] 备选），改 Phase 2；鉴权分裂。
- ❌ 订阅 token 不被认 → 全程回退 `ANTHROPIC_API_KEY`（只影响省钱，不动架构）。

**你需要先给我**：`CLAUDE_CODE_OAUTH_TOKEN`（或 `ANTHROPIC_API_KEY`）。
**产出**：spike 结论一句话记进 #20 评论（兑现 ADR-0009/0010 的"鉴权实测"挂账）。spike 脚本之后删除。

---

## Phase 1 — gateway 背衬的阻塞收件箱（TDD + 一薄层 HITL 接线）

把"真人槽阻塞等 Discord gateway 推来的消息"做成注入式实现，引擎不动。

- **`src/ports/message-events.ts`**（新）：`MessageEventSource` 接口——`onMessage(handler: (m: InboundMessage & { threadId }) => void): void`。这是 gateway 的 DI 接缝。
- **`src/adapters/discord/gateway-inbox.ts`**（新）：`GatewayInbox implements HumanInboxPort`。订阅 `MessageEventSource`，把消息按 (actor via discordUserId, threadId via threadMap) 入队/挂起等待；`poll(actor, scene)` 改为**阻塞等待**下一条匹配消息并映射成 `HumanTurn`。复用 `DiscordInbox` 已有的 content→HumanTurn 映射（`.ra`→roll / `pass`→pass / 其余→prose）——抽成共享纯函数 `mapContentToTurn`。
  - 注：保留 `DiscordInbox`（单次 `poll`）不动，单测仍用它；`GatewayInbox` 是生产用阻塞实现。
- **`test/discord/gateway-inbox.test.ts`**（TDD，headless）：用假 `MessageEventSource`（手动 emit）：
  1. `poll` 在匹配消息到达前不解析；到达后解析为对应 `HumanTurn`。
  2. 只认该 actor（discordUserId）在该 thread 的消息，其它忽略。
  3. `.ra …`→roll、`pass`→pass、自由文本→prose。
  4. 消息早于 `poll` 调用到达也能被下次 `poll` 取到（缓冲不丢）。
- **HITL 接线**（无单测）：`create-real-discord.ts` 加一条 discord.js gateway `Client`（intents: Guilds, GuildMessages, MessageContent），登录后把 `messageCreate` 转成 `MessageEventSource`。

**成功标准**：`gateway-inbox.test.ts` 全绿；`tsc`/纯度绿。

---

## Phase 2 — NPC driver（TDD + HITL 真 query）

引擎在 `await_actors` 里拉起 NPC 的实体。

- **`src/adapters/agent-sdk/agent-npc.ts`**（新）：`AgentNpc implements NpcPort`。
  - 构造注入：persona（人格核心文本）、一个 `runQuery` 函数（DI 接缝——生产是真 `query()`，测试是 stub）。
  - `takeTurn(ctx)`：用 persona + `ctx.transcript` 拼提示，跑一次 `runQuery`，挂 NPC 侧 speak/pass/roll 工具（或读末条文本=speak），映射成 `NpcTurn`。
  - `shouldSpeak`：v1 恒 true（唤醒闸延后，[ADR-0010]）。
- **`src/adapters/agent-sdk/npc-prompt.ts`**（新，纯）：从 persona + transcript 拼 NPC 提示。
- **`test/agent-npc.test.ts`**（TDD，headless）：stub `runQuery`：
  1. 返回 speak 工具调用/文本 → `{ kind: "speak", prose }`。
  2. 返回 pass → `{ kind: "pass" }`。
  3. 返回 roll → `{ kind: "roll" }`。
  4. 提示拼装含 persona + transcript（纯函数单测）。
- **HITL**：真 `query()` 作为 `runQuery` 注入（Phase 4 接线时）。

**成功标准**：`agent-npc.test.ts` 全绿；`tsc`/纯度绿。

---

## Phase 3 — DM driver + 重启网（TDD + HITL 真 query）

- **`src/adapters/agent-sdk/dm-prompt.ts`**（新，纯）：DM 系统提示——身份/职责、可用工具用法（narrate 后用 `await_actors(order)` 抛屏障、收齐后继续、一次性 NPC 行内口述、永不主动收场直到被停）、本局 cast 名单。
- **`src/runtime/dm-driver.ts`**（新）：`runDmDriver({ runQuery, referee, systemPrompt, isSessionActive })`。
  - 跑 `runQuery`（注入真 `query({ mcpServers: { engine: createDmMcpServer(referee) }, allowedTools, systemPrompt })`），消费流。
  - **重启网**：generator 结束且 `isSessionActive()` 仍真 → 重新拉起续跑（带"继续主持"提示）。
  - DI 接缝：`runQuery` 注入。
- **`test/dm-driver.test.ts`**（TDD，headless）：stub `runQuery`：
  1. 一条会自然结束的流 + `isSessionActive` 仍真 → 断言被重新拉起。
  2. `isSessionActive` 转假 → 不再重启、干净退出。
  3. `runQuery` 抛错 → 被捕获、不崩主循环（按策略重启或退出）。
  4. dm-prompt 拼装（纯函数单测）。

**成功标准**：`dm-driver.test.ts` 全绿；`tsc`/纯度绿。

---

## Phase 4 — 组合根 + config（接线 + 纯件 TDD）

- **`src/runtime/auth.ts`**（新，纯）：`resolveAuth(env)` → 优先 `CLAUDE_CODE_OAUTH_TOKEN` 否则 `ANTHROPIC_API_KEY`，都无则抛清晰错误。单测覆盖三分支。
- **`src/runtime/config.ts`**（新）：硬编码最小一局——campaign brief（进 DM 提示）、1 个 NPC persona、roster（human + npc 的 kind + discordUserId）、sceneId↔threadId 映射、personas（webhook 名/头像）。从 env 读 Discord token/webhook/threadId/玩家 userId。
- **`src/main.ts`**（新，组合根，HITL）：`resolveAuth` → `createRealDiscordClient`（含 gateway）→ `DiscordSubstrate` + `GatewayInbox` → `Referee({ aidmId, substrate, npc: AgentNpc, humanInbox: GatewayInbox, roster })`（无 dice/cards/campaign）→ 注入真 `query()` 的 `runQuery` 给 DM/NPC → `runDmDriver(...)`。
- `package.json` 加 `"start": "node --import tsx src/main.ts"`（或预编译；按现有 ESM/NodeNext 配置定）。
- **`test/runtime/config.test.ts`**：`resolveAuth` 分支、config 装配的纯部分。

**成功标准**：`config.test.ts`/`auth.test.ts` 全绿；`tsc`/纯度绿；`npm run build` 干净。

---

## Phase 5 — HITL 真跑（你 + 我，验收）

- 扩 `src/adapters/discord/README.md` runbook：gateway intents、`start` 用法、env 清单。
- 你按 runbook 配：bot token（开 Message Content Intent）、webhook、把 bot 拉进服务器、建 thread 拿 thread ID、拿你自己的 Discord user ID，设环境变量。
- 跑 `npm start`，玩一拍：
  1. DM 在 thread 里以 DM 分身发开场叙事。
  2. DM `await_actors` → NPC 以自己分身回一句（后手看到 DM 的开场）。
  3. 你在 thread 里打字 → 引擎经 gateway 收到、作为 prose turn 处理 → 屏障释放。
  4. DM 收到结果、再叙事推进。
- **验收 = [ADR-0010] 第一切片**：上面闭环跑通。

**产出**：关 #4 最后一条 HITL 验收；#20 鉴权实测 + DM 驱动落地；#21 NPC 驱动落地。按结果决定是否关 #20/#21 或拆后续切片（持久队友 session、唤醒闸、骰子接入、脊柱工具上桌、多场景）。

---

## 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| 嵌套 `query()` 不可行 | Phase 0 | NPC 改 Messages API（鉴权分裂） |
| 订阅 token 不被 SDK 认 | Phase 0 | 全程 `ANTHROPIC_API_KEY` |
| DM 模型频繁提前收场 | Phase 5 | 强化 dm-prompt；重启网兜底；必要时退"每拍 query()"（[ADR-0010] 备选） |
| gateway intents/权限配置坑 | Phase 5 | runbook 排查；`discord-hitl.test.ts` 既有冒烟 |
| 长阻塞 handler 触发 SDK 超时 | Phase 0/5 | 查 SDK 超时项；必要时心跳/分段 |

## 顺序与依赖

Phase 0（gate）→ 1、2、3 可并行（互不依赖、各自 DI 接缝）→ 4 组合 → 5 HITL。
1/2/3 若并行，注意都不碰引擎/referee，仅各自新增文件 + `package.json`/`main.ts` 留到 Phase 4 合并。
