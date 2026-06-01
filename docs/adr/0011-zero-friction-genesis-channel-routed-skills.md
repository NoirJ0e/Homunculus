# 11. 零摩擦开团：bot-as-admin + 频道路由的 skill 注入

- 状态：Accepted
- 日期：2026-06-01
- 关系：**泛化** [ADR-0002] 的纯洁性（从"AIDM 只有 narrate"泛化为"每个频道的 agent 只有它那个 role 的工具"）；**扩展** [ADR-0010] 的运行时拓扑（从硬编码单 session → 多频道动态 dispatcher），并**偿还**其遗留的"硬编码最小 config"债（`src/runtime/config.ts`）；消费 [ADR-0004]/[ADR-0006]（灵魂本体在 soul-store）、[ADR-0005]（thread = sub-scene）、[ADR-0007]（genesis seed 展开）；不动 [ADR-0001/0003/0008/0009] 的内核决策。

## 背景

[ADR-0010] 的第一切片把"真的在 Discord 里玩起来"跑通了，但配置摩擦极大：人工在频道拉 webhook、手抄 thread ID 进 env、bot 写死单人单场景（`config.ts`）。北极星体验应该是：**把 bot 拉进服务器 → 在 General 里说"我想跑《凡达林的矿坑》" → 一场团的频道骨架自动起来 → 直接玩**，之后基本不用管它。

两个驱动力：

- **friction**：手动 webhook + thread ID + 写死 bot 是 [ADR-0010] 自己标记的技术债；最小可行性已验证，现在该把这层简单的外部集成做进来。
- **组织性**：一场团天然是一组频道（主线 / 开卡 / 闲聊 / 后日谈），用 Discord 的 Category 做 folder-like 收纳；多场团（矿坑、风海岛之龙）各占一个 Category 才不至于平铺成一团乱。

张力：**零摩擦要 bot 去"做 Discord 操作"，而纯洁性（[ADR-0002]）要 AIDM"除了叙事什么都不做"**。本 ADR 的核心就是化解这对张力。

适用人群约束：自己一个人、或三两好友的很小的私服。**不做 security audit**，威胁模型不存在。

## 决策

### 核心范式：skill = role，channel = which role

一个 bot、一个常驻进程。同一个 bot 在不同频道里被注入不同 **skill**（= 一套 system prompt + `allowedTools` + MCP server 的组合），因此每个频道里的 agent 都是干净纯粹的。

- General → **concierge** skill（Discord-admin 工具，建团）
- 主线频道 → **AIDM** skill（只 `narrate`/`await_actors`）
- 开卡 thread → **card-creation** skill

**纯洁性不是靠克制，是靠"能力物理上在别的地方"**：这把 [ADR-0002] 从"AIDM 只有 narrate"泛化为"每个 channel 的 agent 只持有它那个 role 的工具"。AIDM 实例从来就没拿到过建频道的工具——那工具挂在 concierge 实例上，是另一条 `query()`。

### 频道拓扑（靠 bot 的 Admin 权限自动搭建）

| Discord 结构 | 引擎概念 |
|---|---|
| **Category = 一场团**（矿坑 / 风海岛之龙） | campaign / world（[ADR-0004] soul-set + world-branch） |
| **主线频道 = scene** | 一个 scene，AIDM 驱动；`scene→channel` 路由（复用 `SceneThreadMap` 思路） |
| **开卡 = 主线频道下的一个 thread** | 临时子场景（[ADR-0005] private thread = sub-scene），捏完归档 |
| **OOC = 主线频道里 `(` 开头的消息** | 不是 turn；前缀表直接 strip，不喂 DM |

### 消息分派：前缀表（Chain of Responsibility / dispatch table）

扩展现有 `mapContentToTurn` 为一张按开头符号分派的表，全在 adapter 层、纯函数、可 TDD、不烧 token：

- `(` 或 `（` → **OOC**：从喂给 DM 的上下文里 **strip 掉**，不解锁 `await_actors`，DM 根本看不到（物理上不可能把吹水误认成动作，且省 token）。
- `.ra …` → roll（已有）
- `pass` → pass（已有）
- 其它 → 普通入戏 prose（已有）
- `?` 开头（提问）、其它符号（特殊操作）→ 先留可扩展空槽，等"回答一个提问意味着什么"想清楚再填。

### 两条路由纪律：指针 vs 本体

- **路由真相 = 频道 topic 存"指针"**：concierge 建频道时把稳定外键写进频道的 `topic` 字段，如 `homunculus:campaign=mine-01;scene=tavern;role=aidm`。dispatcher 每次读 topic 推断角色。**自包含于 Discord** → 重启不丢、换机器不丢、真正"丢进去就不管"。
- **本体（会成长的灵魂）在 soul-store**（[ADR-0004]/[ADR-0006] 持久灵魂 + git）。topic 里的 `campaign=mine-01` 只是**指向**它的地址。
- **纪律：topic 绝不存任何会变的东西**（人格描述、记忆、状态文本），只存稳定 id + role。于是跨 session 时 dispatcher 拿 id 去 soul-store 加载**当前最新版**灵魂，演化自然延续、不被冻结、不冲突。
- thread 没有 topic 字段（只有名字）：开卡 thread 由 concierge/AIDM **主动建**，建时即知其 role，靠 thread 名约定（如 `🎴开卡`）或拉起时直接赋 role 识别。

### 运行时：单进程 + 按需 query() + 活跃 query 表

- **dispatcher 是唯一入口**：任何频道/thread 来消息 → 读 topic（或 thread 名）定 role → 查活跃 query 表 → 无则按 role 拉起一条 `query()` 并登记。
- **concierge**（绑 General，long-lived）：听"我想跑矿坑" → 跟玩家聊出 `CampaignSeed`（premise/tone/desiredClimax/levelBand 四字段）→ 调 `genesisCampaign` → 用 Admin 工具建 category / 主线频道 / webhook / 写 topic。
- **AIDM**（每主线频道一条，long-lived）：由"该频道第一条真人消息"按需拉起，纯洁（只 narrate/await_actors）。
- **card-creation**（开卡 thread 期间临时）：thread 归档即 `deleteSession`。
- **交接 = 隐式，无 agent 编排 agent**：concierge 只建骨架 + 发一条 OOC 性质的系统提示（"团建好了，准备好就在这开始"，不碰 narrate）；dispatcher 按需拉起 AIDM；**人是闸门**（[ADR-0003]）——玩家开口才起场，AIDM 第一拍 narrate 开场。

### concierge 能力 + admin 工具的物理归属

- **bot 给 Administrator 权限**（invite URL 直接勾 Admin），省事；不裁剪、不做 security audit（私服）。
- **Discord-admin 工具住 adapter 层的独立 MCP server**（`discord-admin-mcp.ts`），与 `engine-mcp.ts` 平级、互不相干，handler 直接调 Discord API。**它压根不在 `src/engine/` 里，引擎纯度 grep 守卫照常通过**——纯洁性是结构性保证，不是约定。
- 纯工程纪律（非 security）：即便 Discord 层给了 Admin，concierge 的 `allowedTools` 仍只挂它实际要用的几个工具——LLM 工具越少越好调试、越不易自由发挥。

### genesis 复用：agent 是薄前端

`genesisCampaign(seed)` 和 `genesisSoul(id, {name, concept})`（含 `genesisFullAuto(archetype)`）内核已在，且各留了 `DistillerPort`/`SoulDistiller` seam。concierge 与 card-creation 都只是"自然语言对话 → 填 Seed → 调确定性 genesis → 落 soul-store"的薄前端，**内核不重写**。

### 第一刀范围

dispatcher + concierge（建团骨架 + topic 路由）+ 前缀表 OOC + 主线 AIDM 按需拉起，**替掉写死的 `config.ts`/`main.ts`**。开卡 thread / card-creation **本刀简化**（先 `genesisFullAuto` 一键填队友，或暂跳，用预设角色），把"丢进空服务器 → 说跑矿坑 → 能玩"主路打通。

## 备选

- **确定性 provisioner（不给 agent 新能力，纯 TS 代码建频道）**：纯洁性零改动、最稳，但用户要的是"对 bot 说人话就开团"的体验，且 per-channel skill 注入已经把纯洁性结构性保住。否决，选 agent-as-admin。
- **外部注册表文件存路由**：直接，但又多一份要与 Discord 手动同步的状态——正是 [ADR-0010] 那份写死配置的同类债。否决，选 topic 自包含。
- **命名约定推断路由**（不存元数据）：最简但脆（改名/派生 id 不稳）。否决，选 topic 显式指针。
- **每频道一个独立进程**：隔离最强，但进程管理 / IPC / 共享 bot 连接复杂。否决，选单进程 + 按需 query。
- **全部 query 常驻**：最简，但多团堆积常驻 query、占资源、不能 serialize 暂停。否决，选按需拉起 + `deleteSession`。
- **开卡单独建一个频道**：与"一场团一组频道"一致，但比 thread 重。否决，选 thread（轻量、天然子场景、归档即清）。
- **OOC 递给 DM（打标签）**：DM 能答规则问题，但复杂化轮次解析、且费 token。否决，选 strip（彻底绕过信息泄露问题）。
- **裁剪 bot 权限 + security audit**：大型公服才需要；本项目私服。否决，给 Admin。

## 后果

- **`src/runtime/config.ts` + `src/main.ts` 重写**：从"组装一份写死 SessionConfig + 拉起单 DM"变为"dispatcher + 活跃 query 表 + 按需拉起"。这正是 [ADR-0010] 标记的"硬编码单 session 配置"债。
- **新增**：`dispatcher`（频道→role→query 路由 + 生命周期）、`discord-admin-mcp.ts`（adapter 层 MCP）、concierge skill（prompt + 工具）、topic 路由的读/写、前缀表（扩展 `mapContentToTurn` 加 OOC strip）。引擎 / referee 不动。
- **bot 权限升级**：invite URL 需 Administrator；gateway 需 Guilds 事件以发现新频道/thread。README runbook 相应更新。
- **留给 plan/后续切片敲定的实现细节**：①第一刀开卡是 `genesisFullAuto` 还是暂跳；②concierge 把"跑矿坑"聊成 `CampaignSeed` 的方式（对话 vs 模板）；③thread 无 topic 的识别（名约定）；④新建主线频道的 webhook URL 缓存在哪（topic? 运行时表?）；⑤`DistillerPort` 第一刀接不接真 LLM。
- **延后**：多 campaign 并存的资源/成本上限、card-creation 完整生命周期、OOC 之外的 `?`/特殊前缀语义、私聊"泄露"机制（已用 `(` inline OOC 绕过）。
- 提交用 `--no-gpg-sign`（本仓库 SSH 签名代理不可用）。
