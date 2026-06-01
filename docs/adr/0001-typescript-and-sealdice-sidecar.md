# 1. 技术栈用 TypeScript；骰子 v1 用 TS 原生，SealDice 延后

- 状态：Accepted（2026-06-01 修订骰子方向，见下"2026-06-01 修订"）
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

## 2026-06-01 修订：骰子 v1 用 TS 原生，SealDice 延后

对 sealdice-core 做了源码级调研，推翻了"v1 即接 SealDice 边车"的隐含假设：

- **SealDice 没有干净的"投骰→结构化结果"HTTP 接口**。它的 HTTP（`/sd-api`，端口 3211）是 **web 管理 UI 的 API**，不是投骰 API。真正的投骰只有两条缝：① OneBot v11 反向 WS（假装成聊天平台喂消息、解析它的文字回复）；② 内部 UI 端点 `dice/exec` + 轮询 `dice/recentMessage`（异步 send-then-poll、~500ms 限流、单一假用户身份、返回渲染文字而非 JSON）。两者都**脆且非结构化**。
- **`sealdice-core/dice` 不能当库 import**：投骰逻辑与 DB（CGO SQLite）、所有 IM 适配器焊死在一个巨包里，调一次投骰要 `*MsgContext` + `*Dice` + DB-backed `AttrsManager`。
- 底层引擎 **`github.com/sealdice/dicescript`（Apache-2.0）可以干净 import**，属性靠回调注入——这是**未来**若要接 SealDice 规则的正路（写个薄 Go 边车 import dicescript，而非 import sealdice-core，也非凭空假设的 `POST /roll`）。
- 早前 `http-sealdice` 适配器假设的 `POST /roll → {total,success,detail}` 契约**在 SealDice 中并不存在**，是凭空设想。

**修订决策**：
- **v1 骰子用 TS 原生实现**：在 TS 引擎内实现 DND5e/COC7 的检定语义（`.ra <技能>` → 对卡判定 → 结构化结果）。角色卡的机械数值 v1 也先放我们自己的 SoulStore，不引入 SealDice 双头权威。
- SealDicePort 的**抽象边界保留**（端口仍在），但 v1 的实现是 TS 原生 `NativeDice`，不是 SealDice 边车。
- **接真 SealDice 延后**：等多智能体核心验证后再决定是否值得；届时正路是边车 import `dicescript` + 注入我们持有的属性，或 OneBot 假装适配器——而非已删的 `POST /roll` 设想。
- 由此 [ADR-0002] "骰子是 SealDice 唯一写权威" 在 v1 暂由 TS 原生骰子承担"唯一机械裁决口子"的角色；语义不变（角色只发检定意图、引擎/骰子裁决），只是实现换人。

落地见新切片 D（TS 原生骰子 + 检定流工具化）。原 issue #5（SealDice HTTP 适配器）的实现部分作废，见其变更评论。
