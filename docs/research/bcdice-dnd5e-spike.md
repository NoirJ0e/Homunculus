# BCDice D&D5e 判定深度 spike（PRD#2-1 / #39）

- 日期：2026-06-04
- 关系：验证 [ADR-0013] 的承重假设——`npm bcdice` 的 **D&D5e 判定深度是否够用**。spike 通过 → #42（D&D5e 适配器路）正式接 BCDice；不通过 → 该系统回退 `NativeDice`（不阻塞 CoC7 路 #40）。
- 结论：**通过。D&D5e 路正式接 BCDice，无需回退。**

## 方法

`DynamicLoader().dynamicLoad('DungeonsAndDragons5')` 进程内 headless（无网络、无聊天），对承重机械逐项求值，读结构化结果（`success/failure/critical/fumble/detailedRands`）。spike 代码即弃，不进生产。

## 发现（逐项三态）

| 承重维度 | 状态 | BCDice 机制 / 实测 |
|---|---|---|
| 属性/技能检定 + 难度 | **原生支持** | `AR±mod>=DC` → `(AR+3>=10) ＞ 16+3 ＞ 19 ＞ 成功`，结构化 success/failure |
| 属性调整值 | **原生支持** | `AR` 的 `±mod` 项 |
| 熟练加值 | **适配器可补** | BCDice 取**单一 ±修正**，不单独建模熟练。适配器从结构化卡算 `总修正 = 属性调整 + (熟练?熟练加值:0)`，作为 `±mod` 传入。这是标准 D&D5e 模型，BCDice 保持纯判定器，分工干净 |
| **优势/劣势** | **原生支持** | `A`/`D` 后缀真掷 2d20 取高/取低：`(AR+5>=15A) ＞ [9,4]+5 ＞ 14`、`...15D ＞ [10,8]+5` |
| 攻击 vs AC | **原生支持** | `AT±mod>=AC` → `(AT+7>=16) ＞ 12+7 ＞ 19 ＞ 成功` |
| 暴击/大失败自动判定 | **原生支持** | `AT±mod@crit>=AC`：实测 nat-1 → `(AT+7@19>=16) ＞ 1+7 ＞ ファンブル`，`fumble:true`；可设暴击阈值 `@19` |
| 伤害（含暴击/双手重投） | **原生支持** | `1D8+3`、`2H2D6+4`（圣武士/战士双手 1-2 重投） |

无任何维度落到「需回退」。

## 决策与影响

- **#42（D&D5e 适配器路）正式接 BCDice**：`BcdiceDice` 增 `dnd5e → 'DungeonsAndDragons5'` 映射，把 `RollRequest`（检定/攻击 + 难度/AC + 优势劣势）翻成 `AR`/`AT` 指令，解析回 `RollResult`。`NativeDice` 仍留作离线/测试回退（同 `DicePort`），但生产用 BCDice。
- **熟练在适配器侧合成**：故 #43 的**结构化 D&D5e 卡**须带：属性值（→调整值）、等级（→熟练加值）、各技能/豁免的熟练标记。适配器据此算总修正。`RollRequest` 可能需要携带「优势/劣势」「目标 AC/DC」「是否攻击」——这些是 #42/#44 接线时对 `DicePort` 契约的小扩展（当前契约只有 `skill`/`difficulty`），在那两片里定。
- BCDice 命令语法（`AR`/`AT`/`@`/`A`/`D`）一律**封死在适配器内**，引擎/AIDM 仍只见 `DicePort`。

## spike 弃用

本 spike 仅探针，无代码合并进生产路径。结论落入 [ADR-0013] 的承重假设一节由本文回填。
