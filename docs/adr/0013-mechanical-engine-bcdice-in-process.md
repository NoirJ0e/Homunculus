# 13. 机械域引擎改用 BCDice（进程内库），取代 SealDice 边车

- 状态：Accepted
- 日期：2026-06-02
- 关系：**修订 [ADR-0001]**（其决策为"骰子 v1 用 TS 原生、机械域整块割给 SealDice Go 边车、写 branch-snapshot 卡垫片"）。复用 [ADR-0001] 早已留出的 `SealDicePort` 边界（`NativeDice` 已实现它）——本 ADR 只换端口背后的实现 + 卡归属，引擎/referee 不动。是 PRD#2（一整场可玩）A 机械域 路线的承重决策。

## 背景

PRD#2 北极星「一场团从头跑到尾」要求机械域有**真判定**（检定/战斗按系统结算，反馈进叙事）。v1 把骰子留在 TS 原生（`NativeDice` 实现 `SealDicePort`，COC7/DND5e 简化判定），SealDice 作为机械权威被 [ADR-0001] 延后。

PRD#2 选型调研（`docs/research/dice-engine-options.html`）的实测发现改变了成本图景：

- **SealDice 没有干净的骰子/卡 HTTP RPC**：对外只走 **OneBot v11 反向-WS**（它自带的 HTTP 是管理 Web UI）。集成 = 自写一个 OneBot 服务端桥 + 发合成消息事件 + **解析它的自然语言文字回复**（脆），且它本质是会发言的聊天 bot（频道里冒出第二个 bot，违 [ADR-0001] 红线）。
- **Avrae**：开源但**绑 Discord + 仅 D&D5e**，无头/多系统都不契合。
- **BCDice**：日本最流行的 TRPG 判定引擎，**官方有 TS/JS 移植 `npm i bcdice`**——进程内可嵌、动态加载系统（数百个，含 CoC7）、求值 `CC<=54` 返回**结构化结果（成功/大成功/大失败）**。**纯判定器、不拥有角色卡**。无服务器、无聊天、无第二 bot。

用户据此决定**弃用 SealDice，直接上 BCDice**。

## 决策

- **机械判定引擎 = BCDice（npm `bcdice`），进程内嵌**，实现 `SealDicePort`，取代 `NativeDice` 作为生产实现（引擎/referee 不动——端口边界由 [ADR-0001] 预留）。
- **角色卡归我们**：叙事灵魂（soul）+ 按系统的结构化机械卡（sheet）都存我们自己的库（[ADR-0012] 的 SoulStore/CardStore 沿用）。BCDice 只做「给定卡值 + 指令 → 按系统结构化判定」，**不拥有卡**。这天然化解 [ADR-0001] 担心的「SealDice 想拥有卡」双头冲突——BCDice 不抢卡，机械/叙事分工干净。
- **不再起 Go 边车、不写 OneBot 桥、不引入第二 bot、不写 SealDice 卡快照垫片**。
- **承重假设先 spike（PRD#2 第一步）**：BCDice 的 **D&D5e 判定深度**（属性调整、熟练加值、优势/劣势）是否够用。够则正式接；不够则该系统回退自写规则或评估替代，不阻塞 CoC7 路径。

## 备选

- **SealDice Go 边车（[ADR-0001] 原决策）**：否决——非干净 RPC（OneBot 桥 + 脆文字解析）、第二-bot 风险、Go 进程编排，最重的集成。
- **Avrae**：否决——Discord bot + 仅 D&D5e。
- **rpg-dice-roller（npm）/ 继续自写 NativeDice**：只算骰子表达式 / 系统规则全自写，撑不起多系统真判定。`NativeDice` 保留为**端口的离线/测试回退实现**，与 BCDice 并存（同一 `SealDicePort`）。

## 后果

- 新增 `src/adapters/dice/`（如 `bcdice-dice.ts`）：`SealDicePort` 实现，封 `bcdice` 库的系统加载 + 指令求值 + 结构化解析。BCDice 的指令语法（`CC<=`、系统特定）被**封在适配器内**，引擎/AIDM 仍只调 `SealDicePort.callCheck/roll`。`NativeDice` 保留为回退/测试。
- **开卡向导要产「按系统的结构化卡」**（BCDice 判定需要卡值）：CoC7 = 职业 + 技能%；D&D5e = 种族/职业/等级/属性/熟练。审卡官（[ADR-0012] 已系统感知）校验之。
- **[ADR-0001] 的「机械域割给 SealDice + branch-snapshot 卡垫片」作废**：机械判定改 BCDice；卡归我们，所以 canonicity（git fork/merge/discard，PRD#2 之外）直接管我们的卡存储，**不需要 SealDice 卡垫片**（`CardShimPort` 随之失去存在理由，后续清理）。
- 新增 npm 依赖 `bcdice`（MIT，官方维护）。spike 通过后正式接；不通过则按系统回退。
- 提交用 `--no-gpg-sign`（本仓库 SSH 签名代理不可用）。
