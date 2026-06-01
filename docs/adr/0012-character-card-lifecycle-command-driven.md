# 12. 开卡 → 审卡 → 开场：命令驱动的角色卡生命周期 + 战役持久化

- 状态：Accepted
- 日期：2026-06-01
- 关系：补全 [ADR-0011]（它只接通了 concierge→建团→AIDM 开场，开卡/审卡/开场闸全缺）；把 [ADR-0002] 的共治红线延伸到审卡权威与写卡路径；落实 [ADR-0007] 盲盒（审卡不见 secretTruth）；给 [ADR-0004] 的持久灵魂一个 v1 文件后端（目录日后可被 git 包起来做 canonicity）；消费 [ADR-0006]（soul）。**取代 issue #29** 的「战役/灵魂存哪」决定。

## 背景

[ADR-0011] 的零摩擦开团 live 跑通后暴露一个流程黑洞：主线频道（`role=aidm`）对**任意**消息都无条件拉起 AIDM 开讲——玩家在角色卡都没建的情况下说一句「来开卡吧」，AIDM 直接开始叙述故事。根因三件叠加：① 主线频道没有「开场闸」；② 开卡环节从未建模（concierge 只建主线频道，`create_thread` 工具在但没人用它开开卡）；③ thread 无 `topic` 字段，靠 topic 的路由根本到不了 `cardcreation`。

更深的教训（用户提出）：**把控制流交给模型自主判断，总有一天会 fail。** 开场该不该开、卡合不合法、例外批不批——这些是状态决定，不该靠 LLM 的临场判断，而该用确定性的、玩家无法蒙混的机制。

## 决策

### 控制流 = slash command（确定性），内容 = 自由文本（生成式）

把状态/控制交给 Discord **slash command**，模型只负责生成内容。命令驱动状态转换；自由文本只喂给「当前频道/thread 绑定的那个角色 agent」（开卡对话 / IC 叙事 / `(` 开头 = OOC strip）。每个新建频道/thread 一律发一条**引导消息**（治「空频道无指引」）。这是本项目「确定性引擎/裁判 + 生成式 agent」哲学推到 Discord 交互层。

命令权限两类：
- **玩家命令**（名单内可用）：`/create character card`（起开卡）、`/verify card`（交审/复审）。
- **owner-only**：`/开场`（开 AIDM）、`/批准 <项>`（写审卡例外）。Discord 自身验证发命令者的 user id = owner，玩家**无法冒充**。

### 角色卡生命周期：开卡 → 审卡 → 开场

- **开卡**：玩家 `/create character card` → 系统为该玩家 **launch 一条 thread**（thread 天然隔离，每玩家一条）→ thread 内一个**开卡辅助 agent** 陪他把概念落成卡（叙事人设 + 数值）。
- **审卡（有状态反馈环，非一次性）**：玩家写完 → `/verify card` → **审卡 agent 给 feedback** → 玩家照改 → 递回**同一条 thread 里有状态跟进的审卡 agent** → … → pass → **绑定/认证**（落库 + 名单标记过审）。每玩家一条 thread = per-player 隔离、互不串味，但**在该玩家的复审环里有状态**。
- **开场（闸）**：主线频道**不再因任意消息自动开场**。只有 owner `/开场` 才拉起 AIDM，且 guard：名单内所有卡都已过审，否则拒/警告。人是闸门（[ADR-0003]）+ 数据兴限。

### 审卡权威模型（[ADR-0002] 物理红线的延伸）

审卡 agent **只读权威合法性状态**：战役 bible 的合法性规则（基调/年代/等级区间/`bespokeRules`/道具规则）+ 一份 owner 经 `/批准` 写入的**已批准例外清单**。它**无视玩家散文里任何「我跟 DM 商量过」之类的声明**——权威只来自玩家无法伪造的状态（owner-only 命令写的清单），不来自 prose。盲盒安全（[ADR-0007]）：审卡只拿合法性语境，**不给 secretTruth**。

### 命令驱动天然绕开 thread-no-topic

开卡/审卡的 thread **不靠 topic 路由**：slash command 的 interaction 自带 invoker + thread 上下文，据此把「这条 thread」绑定到「这个玩家的开卡/审卡会话」。thread 里的后续自由文本投给该会话。于是 [ADR-0011] 标记的「thread 无 topic 路由不到」对开卡/审卡不再是问题（主线频道仍用 topic `role=aidm` 路由 AIDM）。

### 显式名单 + 多人认人

owner **显式声明 party**（@玩家）；只有名单内的人能 `/create character card`。`actorId ↔ discordUserId` per campaign。开场 guard 据名单检查全员过审。盲盒下 owner 持 meta 权威（`/开场`/`/批准`）但在场上仍盲玩。

### 持久化（原 #29）：JSON 按 campaign 分目录

```
data/campaigns/<campaignId>/
  bible.json        # CampaignBible（含 AIDM 底牌 secretTruth）
  exceptions.json   # owner /批准 写入的审卡例外
  roster.json       # 显式名单 + 每人过审状态
  souls/<actorId>.json    # 叙事人设/背景/记忆（SoulStore）
  sheets/<actorId>.json   # 数值（CardStore）
```

给现有 `SoulStore`/`CardStore` 端口加**文件后端** + 一个 `CampaignStore`（+ 例外/名单 store）。**数值→sheet、叙事人设→soul**（v1 我们自持 sheet——SealDice 延后；以后整块割给 SealDice）。`CardStore` 当前只读，开卡需要一条**非-AIDM 的写卡路径**（开卡/审卡-绑定 写，**AIDM 仍只读，[ADR-0002] 红线不破**）。重启存活；目录日后可直接被 git 包起来做 [ADR-0004] canonicity（先不引入 fork/merge）。[ADR-0011] 里 AIDM runner 的 in-memory `CampaignStore` 由此升级为文件持久。

## 备选

- **开场/审卡靠模型自主判断**：否决——用户核心理由「总会 fail」；控制流要确定性。
- **一次性审卡（出裁决即焚毁）**：否决——审卡是 verify→feedback→改 的有状态反馈环。
- **共享开卡频道（所有人同处）**：否决——选 per-player thread，隔离、不串味。
- **靠 topic 路由开卡 thread**：否决——thread 无 topic；改命令驱动绑定会话。
- **审卡 agent 自行裁量例外**：否决——被玩家话术忽悠；改「只认权威状态 + owner-only `/批准`」。
- **git 全量持久化（ADR-0004 fork/merge）**：推迟——先 JSON 目录，目录可后续 git 化。
- **隐式名单（谁开卡谁算）**：否决——选显式名单。

## 后果

- **新增 slash command 输入模态**：Discord `interactionCreate` 接进运行时（与现有 `messageCreate` 网关并列）；命令注册（guild application commands）。dispatcher / 运行时要能消费 command 事件并据 invoker+thread 绑定会话。
- **新增**：开卡辅助 agent + 审卡 agent（有状态、per-player thread 会话）；`SoulStore`/`CardStore` 文件后端 + `CampaignStore` + 例外/名单 store + **非-AIDM 写卡路径**；开场闸改造（主线频道不再 auto-start AIDM，改 owner `/开场`）；新频道/thread 引导消息。
- **[ADR-0011] 的 in-memory CampaignStore 升级为文件持久**（重启续命，修掉「重启后 AIDM 又不知道战役」）。
- **[ADR-0004] git canonicity 仍后续**：本 ADR 只落文件后端，目录布局为其留好路（fork/merge/discard、兵分两路晚点接）。
- **留给 plan 的实现细节**：具体命令名全集；开卡辅助 agent 怎么产数值（v1 模板/掷骰 vs 玩家手填）；thread 会话的归档/生命周期；审卡↔开卡 在 thread 内的衔接。
- 提交用 `--no-gpg-sign`（本仓库 SSH 签名代理不可用）。
