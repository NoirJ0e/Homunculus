# Plan: 零摩擦开团第一刀（bot-as-admin + 频道路由）

> 落地 [ADR-0011]。北极星：把 bot 拉进**空服务器** → 在 General 说"我想跑《凡达林的矿坑》" → 一场团的频道骨架自动起来（category + 主线频道 + webhook + 写好路由 topic）→ 主线频道开口，AIDM 开场，玩一拍。
> 第一刀 = dispatcher + concierge（建团骨架 + topic 路由）+ 前缀表 OOC + 主线 AIDM 按需拉起，**替掉写死的 `config.ts`/`main.ts`**。开卡 thread / card-creation 简化（`genesisFullAuto` 填队友或暂跳）。

## 原则

- **承重假设先排雷**（Phase 0 spike），再建正式件。
- **纯函数先行**：前缀表、topic 编解码这种零依赖的纯逻辑先 TDD 落地（最便宜、最独立）。
- **TDD 守在 DI 接缝内**：admin 工具 handler 注入 `DiscordAdminPort`，dispatcher 注入"事件源 + query 运行器 + admin port + referee 工厂"，全部用假实现做 headless 单测。
- **HITL 只留不可约的 live 壳**：真 Discord-admin API、真 gateway、真订阅鉴权、真 LLM、真在服务器里开团。
- 引擎 / referee **一行不动**；genesis 内核**一行不动**。每阶段结束 `tsc --noEmit` + `vitest run` 全绿 + 引擎纯度守卫绿。

---

## Phase 0 — 承重 spike：concierge 真能建团吗（HITL，throwaway）

**目的**：写正式件前，单独验掉 [ADR-0011] 的承重点——**一条 concierge `query()` 经一个进程内 MCP 工具，真能在 Discord 建 category/频道/webhook、写频道 topic，且另一侧能读回 topic 推断 role**，并认订阅 token。

- 文件：`scripts/spike-concierge-provision.mjs`（throwaway，不进 `src/`）。
- 内容：一条 `query()`，挂一个 MCP 工具 `provision_campaign`，handler 用 discord.js（bot token，Admin）建一个 category + 一个文本频道 + 一个 webhook、把 `homunculus:campaign=spike;scene=main;role=aidm` 写进频道 topic；脚本随后用 gateway/REST 读回该频道 topic 并打印解析结果。对 bot 说"建个 spike 团"。
- 鉴权：优先 `CLAUDE_CODE_OAUTH_TOKEN`，回退 `ANTHROPIC_API_KEY`。

**Decision gate**：
- ✅ 建频道 + webhook + 写/读 topic 全通 → 按本计划继续。
- ❌ discord.js Admin 建频道/webhook 受阻 → 退回"半自动"（人工建 category，bot 只建频道内 webhook + 写 topic）。
- ❌ topic 字段不适合存元数据（长度/可见性不满意）→ 回退外部注册表（[ADR-0011] 备选），改 Phase 2。

**你需要先给我**：一个 bot token（已勾 Administrator）+ 一个空测试服务器 + `CLAUDE_CODE_OAUTH_TOKEN`。
**产出**：spike 结论记进对应 issue 评论；脚本之后删除。

---

## Phase 1 — 前缀表 / 消息分派加 OOC（TDD，纯）

把"按开头符号分派"做成扩展现有 `mapContentToTurn` 的纯逻辑。

- **`src/adapters/discord/message-mapping.ts`**（改）：在现有 `.ra`→roll / `pass`→pass / else→prose 之上，加 `^[（(]` → **OOC**（新 `HumanTurn` 变体或一个"丢弃"信号）。
- **OOC 语义**：映射结果让上层（inbox）**跳过、不解锁 await、不入 DM 上下文**。具体形状：`mapContentToTurn` 对 OOC 返回一个可被 inbox 识别为"非 turn"的标记（如 `{ kind: "ooc" }`），`GatewayInbox.poll` 见到就继续等下一条。
- **`test/discord/message-mapping.test.ts`**（TDD，headless）：
  1. `（`/`(` 开头 → OOC 标记。
  2. `.ra …`→roll、`pass`→pass、自由文本→prose（回归，不破坏现有）。
  3. 仅**首字符**触发；正文里出现括号不误判。
- **`test/discord/gateway-inbox.test.ts`**（补一例）：OOC 消息到达时 `poll` **不解析**，继续等下一条真入戏消息。

**成功标准**：相关单测全绿；`tsc`/纯度绿。

---

## Phase 2 — topic 路由编解码（TDD，纯）

频道 topic ↔ 路由指针的纯编解码，是 dispatcher 的数据层。

- **`src/adapters/discord/channel-routing.ts`**（新，纯）：
  - `encodeTopic(r: ChannelRouting): string` → `homunculus:campaign=…;scene=…;role=…`
  - `parseTopic(topic: string | null): ChannelRouting | null`（非本系统/缺字段 → `null`，容错）
  - `ChannelRouting = { campaign: string; role: "aidm" | "concierge" | "cardcreation"; scene?: string }`
- **`test/discord/channel-routing.test.ts`**（TDD，headless）：
  1. encode→parse round-trip 还原。
  2. 非本系统 topic（用户自己写的频道简介）→ `null`，不误判。
  3. 缺字段 / 脏数据 → `null`，不抛。
  4. topic 里**绝不含**人格/状态文本（纪律由类型保证：只接受稳定字段）。

**成功标准**：`channel-routing.test.ts` 全绿；`tsc`/纯度绿。

---

## Phase 3 — discord-admin MCP + concierge skill（TDD 接缝 + HITL 接线）

concierge 的能力面。

- **`src/ports/discord-admin.ts`**（新）：`DiscordAdminPort` 接口——`createCategory(name)`、`createTextChannel(categoryId, name)`、`createWebhook(channelId, name)`、`createThread(channelId, name)`、`setChannelTopic(channelId, topic)`，各返回所需 id/url。这是 admin 的 DI 接缝。
- **`src/adapters/agent-sdk/discord-admin-mcp.ts`**（新）：`createDiscordAdminMcpServer(admin: DiscordAdminPort)` —— `createSdkMcpServer` + `tool()` + Zod，handler 调注入的 `DiscordAdminPort`。**与 `engine-mcp.ts` 平级，不碰 `src/engine/`**。
- **`src/adapters/discord/real-discord-admin.ts`**（新，HITL）：`DiscordAdminPort` 真实现，dynamic import discord.js，用 bot token（Admin）调真 API。测试永不加载。
- **`src/adapters/agent-sdk/concierge-prompt.ts`**（新，纯）：拼 concierge system prompt——职责（聊出 `CampaignSeed` → 建团骨架 → 写 topic → 发开场系统提示）、`allowedTools` 只挂 admin 那几个、铁律（不 narrate、不替角色说话）。
- **`test/discord/discord-admin-mcp.test.ts`**（TDD，headless）：注入 stub `DiscordAdminPort`，驱动一条"建矿坑团"的工具调用序列，断言：建了 category→主线频道→webhook、`setChannelTopic` 写入的 topic 经 `parseTopic` 还原为 `role=aidm` + 正确 campaign。
- **`test/concierge-prompt.test.ts`**（TDD，纯）：系统提示含 seed 四字段引导、不含 narrate 授权。

**成功标准**：单测全绿；`tsc`/纯度绿。

---

## Phase 4 — dispatcher + 生命周期（TDD 接缝 + HITL 接线）

频道 → role → query 的路由与按需生命周期，单进程的心脏。

- **`src/runtime/dispatcher.ts`**（新）：构造注入 `{ eventSource, resolveRouting, runConciergeQuery, runAidmQuery, runCardCreationQuery, adminPort }`。
  - 收到某频道/thread 消息 → `resolveRouting`（读 topic / thread 名）定 role → 查**活跃 query 表** → 无则按 role 拉起对应 `query()` 并登记；有则把消息投给既有 query 的等待槽。
  - General（或无 routing 的根频道）→ concierge。
  - `role=aidm` 频道第一条真人消息 → 拉起 AIDM（long-lived）。
  - 开卡 thread → 临时 card-creation；thread 归档事件 → `deleteSession` 并从表移除。
- **`test/runtime/dispatcher.test.ts`**（TDD，headless）：假 `eventSource`（手动 emit）+ stub 三个 query 运行器 + stub `resolveRouting`：
  1. General 消息 → 拉起一次 concierge；再来消息不重复拉起。
  2. `role=aidm` 频道首条 → 拉起一次 AIDM；后续消息投给同一 query。
  3. 开卡 thread 消息 → 拉起 card-creation；thread 归档 → `deleteSession` 调用 + 表里移除。
  4. 未知/无 routing 频道 → 不拉起任何团 query（安全默认）。

**成功标准**：`dispatcher.test.ts` 全绿；`tsc`/纯度绿。

---

## Phase 5 — 组合根重写：替掉写死的 config / main（HITL）

偿还 [ADR-0011] 标的 `runtime-config-hardcoded-debt`。

- **`src/runtime/config.ts`**（重写）：从"组装写死 SessionConfig"→ 只读环境里的 `bot token` / auth / 一个"根 category 约定"或留空（空服务器从 General 起）。不再有写死的 NPC/scene/brief。
- **`src/main.ts`**（重写）：`resolveAuth` → `createRealDiscordClient` + `real-discord-admin` + gateway 源 → 构造 `dispatcher`（注入真 query 运行器：concierge / AIDM / card-creation，各自的 prompt + MCP server + `allowedTools`）→ 启动。Ctrl-C 停。
- **开卡简化（第一刀）**：card-creation 先用 `genesisFullAuto(archetype)` 一键填一个 NPC 队友落 soul-store，或第一刀暂跳、concierge 直接用预设队友建团。AIDM 起场时名单含该队友。
- **AIDM query 运行器**：复用 [ADR-0010] 已有的 `dmQueryStream` + `buildDmSystemPrompt`，scene/cast 改为从 dispatcher 解析出的 routing + soul-store 装配（不再来自写死 config）。

**成功标准**：`tsc`/纯度/全套单测绿（被重写模块的旧单测相应迁移）。

---

## Phase 6 — HITL 全链路验收（不可约 live）

空服务器手验北极星路径，无法自动化：

1. 拉 bot（Administrator）进一个**空测试服务器**（只有 General）。`npm start`。
2. 在 General 说"我想跑《凡达林的矿坑》"。
3. 验证 concierge 自动建出：category（团名）+ 主线频道 + webhook + 频道 topic 写入正确路由指针；并在主线频道发一条开场系统提示。
4. 在主线频道开口 → 验证 AIDM 被按需拉起、第一拍 narrate 开场（以分身 webhook 身份）。
5. 玩一拍：真人入戏 → AIDM 承接。
6. OOC 测试：发一条 `(` 开头的吹水 → 验证**不惊动 DM**、不被当成动作。
7. 重启进程 → 在主线频道再开口 → 验证 dispatcher 读回 topic、AIDM 续跑（指针纪律生效，状态不丢）。

**产出**：结论记进对应 issue；README/`.env.example` 更新（Admin invite URL、不再需要手抄 webhook/thread ID）。

---

## TDD 边界

| 可 headless 单测（DI 接缝 + 假实现） | 不可测、HITL |
|---|---|
| 前缀表 OOC 映射（纯函数） | 真 discord.js Admin 建 category/频道/webhook |
| topic 编解码 round-trip + 容错（纯函数） | 真 gateway 连接 + threadCreate/归档事件 |
| admin MCP：stub `DiscordAdminPort` → 断言建团调用序列 + 写 topic | 真订阅 token 是否被 SDK 认 |
| concierge / system prompt 拼装（纯函数） | 真 LLM 行为（concierge 会不会乖乖聊出 seed） |
| dispatcher：假事件源 + stub query 运行器 → 断言按 role 拉起 / 不重复 / deleteSession | 真在空服务器里"说人话→开团→玩一拍" |

## 留给后续切片

- card-creation 完整生命周期（开卡 thread 内真捏人对话 → `genesisSoul` → soul-store → 归档）。
- `DistillerPort`/`SoulDistiller` 接真 LLM（第一刀走确定性模板 / concierge 自蒸馏）。
- `?`/其它前缀的特殊操作语义。
- 多 campaign 并存的资源 / 成本上限、序列化暂停-resume。
- 一次性 NPC 的 webhook 分身、头像、唤醒闸、骰子上桌（见 v2 延后清单）。
