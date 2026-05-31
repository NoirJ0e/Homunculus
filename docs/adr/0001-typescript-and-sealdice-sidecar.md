# 1. 技术栈用 TypeScript，骰子/规则用 SealDice 作 Go 边车

- 状态：Accepted
- 日期：2026-06-01

## 背景

v1 是 Python。v2 重构需要定主体语言；并需要一套骰子 + 按系统(DND5e/COC7)规则判定的引擎，避免把规则数值压进 AIDM 的上下文（见 [ADR-0002] 标记的 AIDM 负担风险）。[SealDice](https://github.com/sealdice/sealdice-core) 是成熟的网团骰子核心：Go、MIT、内置 DND/COC 规则与角色卡管理。但它是个**独立 daemon**（自带 HTTP + 平台适配器），而非干净的库，且**它自己想拥有角色卡/属性**——与"我们引擎是唯一权威状态源"存在双头冲突。

## 决策

- **v2 主体语言 = TypeScript**（Anthropic SDK / Agent SDK 的 TS 支持是一等公民；多智能体编排在 Node 生态成熟）。
- **SealDice 作 Go 边车**，通过 HTTP/IPC 对话，由我们**自写一个平台适配器**桥接（不用它自带的 Discord 适配器——频道里只出现我们的 Agent，不出现第二个骰子 bot）。
- **领域划分化解双头冲突**：**机械域（角色卡 + 骰子 + 按系统判定）整块割让给 SealDice，是其唯一写权威**；**叙事域（场景 + 分支 + canonicity）归我们的引擎**。两个真相源不重叠。
- **AIDM 对角色卡只有只读权**——能做合理的检定/难度判断、能叙述后果（"你只剩 3 点 HP"），但绝不亲手改数值。

## 备选

- **fork sealdice-core 当 Go 库直调**：控制力最强，但要维护 fork，且把 v2 主体钉死成 Go。否决：边车隔离已够用且保持语言自由。
- **只用 SealDice 算骰子表达式**：浪费其最值钱的"按系统判定 + 卡管理"，杀鸡用牛刀。否决。
- **继续 Python**：可行，但 TS 在 agent SDK 生态更主流，借重构切换。

## 后果

- v2 是多语言部署（TS 主体 + Go 边车），需进程编排。
- 需要一层 **branch-snapshot 垫片**：SealDice 不懂我们的 git 分支，fork/discard/merge 时要快照/还原/落定它持有的卡状态。（寄存待实现。）
- 角色卡的"成长真相"在 SealDice 里，不在我们引擎——canonicity 必须经垫片间接管控。
