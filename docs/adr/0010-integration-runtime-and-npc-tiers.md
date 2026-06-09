# 10. Integration 运行时：Discord 可玩化 + NPC 三层模型

- 状态：Accepted
- 日期：2026-06-01
- 关系：落地 [ADR-0009] 的 DM/NPC 驱动（把"引擎即 MCP 裁判"接到真 LLM + 真 Discord）；**细化** [ADR-0009] 的 NPC 模型为三层；消费 [ADR-0003]（节奏）、[ADR-0005]（可见性）；不改 [ADR-0001/0002/0004/0007/0008] 的内核决策。

## 背景

单元层已完成：纯引擎 + referee + 全部 MCP 工具（`narrate`/`await_actors`/`call_check`/`roll`/`read_card`/脊柱·场景·时钟工具）经 TDD 落地、138 测试全绿（#15–#19）。但从未接过真 LLM 或真 Discord——`query()` 自驱循环、NPC 真出手、真人实时等待都还是空白（#20/#21 的 `ready-for-human`、#4 的 HITL 验收）。

目标：**真的在 Discord 里玩起来**——把已验证的确定性内核接上真驱动，跑通至少一拍真人参与的牌局。

grill 出的一个关键细化：NPC 不是铁板一块，按"演给谁、活多久"分层；且队友这类核心 NPC 在心智上是"和 DM 平行的 peer"。

## 决策

### NPC 三层模型（晋升与否 = 备团期决定，非运行时）

| 层 | 谁来演 | 生命周期 | 例子 |
|---|---|---|---|
| **① NPC 队友** | 独立 AI Agent | 持久、长活（目标：可 resume 的 session，跨拍/跨 session 复用） | 固定队友 |
| **② 核心 NPC** | 独立 AI Agent | 按需拉起：喂 brief（当前场景 + 前情提要）spin-up，这段剧情结束 `deleteSession` | 某一幕的关键人物、贯穿剧本但不可操作的角色 |
| **③ 一次性 NPC** | DM 行内口述 | 无实例 | 酒保、路过的卫兵 |

- **统一接缝**：①②都从同一个 `NpcPort.takeTurn(ctx)` 表达，差别只在"接缝背后的东西活多久"。引擎/referee 永远只调 `takeTurn`，因此"持久 vs 临时 vs 单次"的实现选择被接缝吸收，可独立演进、不动引擎。③ 根本不进 agent 层（DM 的 `narrate` 散文带过；要不要给一次性 NPC 也挂 webhook 分身，延后）。
- 哪些 NPC 晋升为 ①/②，是**备团配置**，运行时只吃一份 `{ 1 DM, k 个 NPC }` 名单。

### 运行时拓扑（落地 [ADR-0009] 的"控制权半反转"）

- **DM = 一条长活自驱 `query()` 循环 + 重启安全网**：`await_actors` 的工具 handler 阻塞时 `query()` 自然 park，返回后继续。若模型提前结束 turn（误判一拍"做完了"），运行时检测到 generator 结束、在 session 仍活时**重新拉起 `query()` 续跑**。
- **NPC 不反转**：引擎在 `await_actors` 的简化战斗轮里**按出手顺序拉起**在场 NPC，每个出**单次** `takeTurn`（v1 背衬 = 一次性 `query()`；目标可换 ① 的持久 resume session，接缝不变）。
- **"平行 peer"的确切含义**：所有 agent 是独立身份 + 独立上下文 + **信息不对称**（DM 读全量 `fullLog`，NPC 只读自己的 `horizon`）的 peer——但**发言在一轮内仍被引擎按先攻序串行**。理由：① 后手看前手（[ADR-0003]）要求后手能读到前手本轮刚发的帖；② 纯并发会退回"AI 零延迟抢跑碾压真人"的 COC bug（[ADR-0003] 创设动机）。
- **agent 间"通信" = 场景记录（substrate），不是私有侧信道**——这正是信息不对称与反元游戏的来源（[ADR-0005]）。
- **唯一暂时舍弃的、纯并发才多给的能力**：NPC"不被点名、自发插话"。延后（与屏障语义冲突）。

### 真人实时等待 = Discord gateway 推事件阻塞

- Discord 适配器加一条 gateway `Client`（`messageCreate` 推送），真人槽**阻塞等待该 (actor, thread) 的下一条消息**。AFK → await 永不解析 = [ADR-0003] 的"无限期 hold = 暂停"。
- 实现落在**注入的 `HumanInboxPort` 实现**里，引擎 + 组合战斗轮**一行不动**（它们本就 `await` 每个槽）；单次 `poll()→undefined=silent` 的契约保留给单测用，生产用 gateway 背衬的阻塞实现。
- **序列化暂停 / resume 延后**：第一局停 = 杀进程（gateway 断开）。`silent→PauseState` 路径保持被单测覆盖但生产 dormant，留给后续持久化切片。

### 鉴权

- 优先 `CLAUDE_CODE_OAUTH_TOKEN`（Pro/Max 订阅额度，省钱——[ADR-0009] 动机），无则回退 `ANTHROPIC_API_KEY`。第一局即兑现 [ADR-0009] 挂账的"鉴权实测"。

### TDD 边界（项目纪律：能测的照测）

| 可 headless 单测（DI 接缝 + 假实现） | 不可测、HITL |
|---|---|
| gateway→`HumanTurn` 阻塞收件箱（假事件流断言 await 解析 + `.ra`/pass/prose 映射） | 真 gateway 连接 |
| `AgentNpc`：stub `query()` → 断言映射成 speak/pass/roll | 真订阅 token 是否被 SDK 认 |
| DM driver 重启网：stub 会结束的 query 流 → 断言重新拉起 | 真 LLM 行为 |
| config / 系统提示拼装（纯函数） | 真在 Discord 里跑一拍 |

### 第一切片范围

1 DM + 1 队友 NPC（均真 LLM）+ 1 真人，单 thread = 单场景。**无**骰子 / 脊柱 / 世界时钟 / 灵魂持久化 / 兵分两路（皆已在 referee 后单测过，后续切片叠加）。人设/剧本 = 硬编码最小 config；genesis 模块延后。

## 备选

- **NPC 也各跑并发自驱长循环**（最贴字面"全平行"）：否决——破坏屏障/后手看前手、N× 成本与编排、且需仲裁同时出手（等于把先攻序重新发明一遍）。仅"自发插话"延后保留。
- **NPC 用 Messages API 单次调用**：更轻，但按 token 计费、鉴权分裂（DM 订阅 / NPC key），违省钱。**保留为回退**：若"嵌套 `query()`"（见后果）被证不可行，NPC 退回此路。
- **REST 轮询等真人**：复用现有 `fetchMessages` 最省事，但有轮询延迟/浪费。否决，选 gateway（更低延迟、可支撑未来增强）。
- **每拍重启 DM `query()`（引擎当导演）**：更可控，但回退 [ADR-0009] 的 DM 自驱决策。否决，选长活 + 重启网。

## 后果

- **承重假设需先用 tracer 排雷**：DM 的 `query()` 会在其 `await_actors` 工具 handler 里**嵌套跑 NPC 的 `query()`**，且该 handler 还要长时间阻塞等真人。"SDK 能否在一个 query 的工具 handler 内跑另一个 query、并认订阅 token、并容忍长阻塞"是整套设计的承重点。**先打最小 spike 单独验掉**（1 DM query + 假阻塞工具 + 一次嵌套 query + 真鉴权，控制台输出，不接 Discord）；不通则 NPC 回退 Messages API。
- 新增：gateway `Client`（现有适配器只有 REST + webhook）；`src/runtime/` 三个 driver（DM / NPC / 阻塞收件箱）；`src/main.ts` 组合根。引擎/referee 不动。
- integration 层有"可测内核（driver/inbox/config 在 DI 接缝下）+ 薄 HITL 外壳（真 gateway + 真鉴权 + 真跑团）"的分层，TDD 纪律对除不可约 live 部分外全部保留。
- ① 持久队友 / ② 临时核心 NPC 的完整生命周期管理（resume/fork/deleteSession、brief 装配、成本上限）是后续切片；今天只立接缝。

## 修订 2026-06-10（#56 / PRD #50）：单 webhook 多分身 → 多真 bot 池

原拓扑「单 bot + 一个 webhook，靠 username/avatar 切人格分身」无法让 NPC 成为**可被 @ 的真身份**——而 @bot 协商（#57）要求每个 AI 队友是一个真 bot。改写运行时拓扑：

- **bot 池**：`.env` 按 `BOT_TOKEN_{n}` 枚举到第一个空缺为止（`config.botPoolTokens`，纯枚举可单测），每个 token 经 `createBotPool` 登录成一个 `PoolBot`（live glue）。`main` 启动时建池一次，传给 runner。
- **人格→bot 分配**：`assignNpcsToBots`（纯，单测）按 roster 序把每个 teammate 绑到一个池 bot；池小于 cast 时多出的 NPC overflow 回退 webhook 分身（池容量约束 NPC 上场数）。绑定时设该 bot 的服务器内昵称=NPC 名。
- **MultiBotSubstrate**（依赖纯 `PoolBot` 接缝 + webhook client，故可单测）：NPC 发帖经**各自 bot**（显示为其昵称），AIDM/overflow 仍经共享 webhook。`Post.mentions`（引擎只标 actorId）由 substrate 映射到 persona 的 `discordUserId` 渲染成真 `<@id>` + `allowed_mentions`——这就是**点名 cue @ 真人**的落地（真人 id 取自 roster 的 human entry）。
- **@bot 解析**：`parseBotMentions`（纯，单测）把消息里的 `<@id>` 交到池 bot 名单——AC5「gateway 能解析 @ 指向哪个池 bot」的内核；用它做**路由**（hold→注入）是 #57。
- **监听不变**：人类输入仍走主 bot gateway（池 bot 只发言+被@；其发帖 `author.bot=true` 被收件箱正确忽略，不会被当成玩家输入）。
- **degrade**：无 `BOT_TOKEN_n` → 池空 → 回退原 `DiscordSubstrate` 单 webhook 分身，行为与改写前一致。

[ADR-0009]「DM 自驱 + 引擎即 MCP 裁判」不变；本修订只换 substrate 拓扑与 NPC 身份载体。节奏侧的串行点名改写见 [ADR-0003] 的 #52 修订。
