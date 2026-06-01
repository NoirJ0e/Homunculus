# Plan: 开卡 → 审卡 → 开场 生命周期 + 战役持久化（ADR-0012）

> 落地 [ADR-0012]。补全 [ADR-0011] 暴露的流程黑洞：主线频道任意消息无条件开场、开卡/审卡根本没接。
> 控制流交给 slash command（确定性），模型只生成内容。合并原 issue #29（持久化）。

## 原则

- **控制确定性、内容生成式**：状态转换走 slash command；自由文本喂当前 thread/频道绑定的角色 agent。
- **审卡权威只来自玩家无法伪造的状态**（bible 规则 + owner `/批准` 写的例外），无视 prose 声明（[ADR-0002] 延伸）。
- **TDD 守在 DI 接缝内**：文件 store、命令分派、会话绑定、审卡裁决都注入假实现/临时目录做 headless 单测；真 Discord 命令注册 + interactionCreate + 真 LLM 是 HITL。
- 引擎/referee 不动；genesis 内核不动；AIDM 仍只读卡（[ADR-0002] 红线）。每阶段 `tsc --noEmit` + `vitest run` + 纯度守卫绿。

---

## Phase 1 — 持久化文件后端（TDD，纯 fs）

给现有端口落地文件后端 + 战役级 store。原 #29 的核心。

- `SoulStore` / `CardStore` 文件实现（`data/campaigns/<id>/souls|sheets/<actor>.json`，复用 `serializeSoul`/`deserializeSoul`）。
- `CampaignStore`（`bible.json`）、`ExceptionStore`（`exceptions.json`）、`RosterStore`（`roster.json`）。
- **非-AIDM 写卡路径**：`CardStore` 加一个写入口（开卡/绑定用），AIDM 侧仍只读（无 `write_card` 工具）。
- 单测（临时目录）：save→load round-trip；缺文件→undefined；写卡后 read 反映；campaign 隔离。

**成功标准**：store 单测全绿；tsc/纯度绿。

---

## Phase 2 — AIDM 改用持久 CampaignStore（TDD + 接线）

把 [ADR-0011] 的 in-memory `CampaignStore` 换成 Phase 1 的文件后端 → 重启续命、修掉「重启后 AIDM 不知道战役」。

- `genesis_campaign` 工具写 `bible.json`；`runAidmQuery` 从文件读 bible 拼 brief（`buildCampaignBrief` 不变）。
- 单测：genesis 工具落盘 + AIDM brief 从盘上 bible 取字段。

**成功标准**：单测绿；tsc/纯度绿。

---

## Phase 3 — slash command 输入模态（TDD 接缝 + HITL 接线）

引入命令作为确定性控制面。

- 命令分派纯逻辑：`CommandEvent { name, invokerId, channelId, threadId?, options }` → 路由到 handler。可注入、headless 单测。
- 命令注册 + `interactionCreate` → `CommandEvent` 的真 Discord 接线（HITL，dynamic import discord.js，像 `createGatewaySource`）。
- 权限闸：owner-only 命令校验 `invokerId === campaign.ownerId`（不可伪造）。
- 单测：命令路由、owner-only 拒非 owner、名单内才放行玩家命令。

**成功标准**：命令分派单测绿；tsc/纯度绿。

---

## Phase 4 — 显式名单 + 开场闸（TDD + 接线）

修掉用户的原始痛点。

- owner 声明名单的命令 → 写 `roster.json`；`/create character card` 仅名单内可用。
- **开场闸**：主线频道不再 auto-start AIDM；`/开场`（owner）+ guard（名单全过审）→ 才拉起 AIDM。
- 单测：roster 写读；开场 guard（缺过审→拒）；非 owner `/开场`→拒。

**成功标准**：单测绿；tsc/纯度绿。

---

## Phase 5 — 开卡 thread + 开卡辅助 agent（TDD 接缝 + HITL）

- `/create character card` → launch 玩家专属 thread + 绑定开卡会话（会话表 keyed by threadId）。
- thread 内自由文本 → 该玩家的开卡辅助 agent（产出 soul 叙事草稿 + sheet 数值草稿；v1 数值用模板/掷骰，细节见下）。
- 引导消息：thread 建好发「在这聊你的角色，写好用 `/verify card`」。
- 单测：会话绑定（threadId→session）、thread 文本投递到对的会话、草稿落临时态。

**成功标准**：会话/绑定单测绿；tsc/纯度绿。

---

## Phase 6 — 审卡 agent 反馈环 + /verify card + /批准（TDD 接缝 + HITL）

ADR-0012 的核心状态。

- `/verify card` → 审卡 agent（per-thread 有状态会话）读**权威合法性状态**（bible 规则 + `exceptions.json`）+ 该卡 → 出 feedback；玩家改 → 再 `/verify card` → … → pass → **绑定**（写 `souls/`+`sheets/`、`roster.json` 标记过审）。
- `/批准 <项>`（owner-only）→ 写 `exceptions.json`；审卡读它。审卡 prompt 铁律：无视 prose 里的「已获批准」。
- 盲盒：审卡只拿合法性语境，不给 secretTruth。
- 单测：审卡读例外 + 无视 prose 声明（喂含「我跟 DM 说过」的卡 + 无例外→拒；owner /批准 后→放）；pass→绑定落库 + roster 更新；非 owner /批准→拒。

**成功标准**：审卡裁决 + 绑定单测绿；tsc/纯度绿。

---

## Phase 7 — HITL 全链路验收（不可约 live）

空服务器手验：拉 bot → `npm start` → owner lobby 说团名 → 建团 → owner 声明名单 → 玩家 `/create character card`（开 thread、捏卡）→ `/verify card`（看 feedback、改、过审、绑定）→ 试 `/批准` 例外 → owner `/开场`（验 guard：未过审拒）→ AIDM 开场（on-theme）→ 玩一拍。验完更新 README/`.env.example`。

---

## TDD 边界

| 可 headless 单测（DI 接缝 + 临时目录/假实现） | 不可测、HITL |
|---|---|
| 文件 store（save/load/隔离/写卡路径） | 真 Discord 命令注册 + interactionCreate |
| 命令分派 + 权限闸（owner-only/名单） | 真 LLM 开卡/审卡行为 |
| 开卡会话绑定（threadId→session） | 真 launch thread / 归档 |
| 审卡读例外 + 无视 prose + pass→绑定 | 真在 Discord 走一遍开卡→审卡→开场 |
| 开场 guard（名单全过审才放） | — |

## 留给后续切片

- [ADR-0004] git canonicity（fork/merge/discard、兵分两路）——目录布局已留路。
- 数值域整块割给 SealDice（[ADR-0001]）替换 v1 自持 sheet。
- 开卡辅助 agent 的数值生成细节（模板 vs 系统掷骰 vs 手填）若 Phase 5 未定，单列。
- 跨团持久灵魂继承（同一 discordUserId 带 soul 跨 campaign）。
