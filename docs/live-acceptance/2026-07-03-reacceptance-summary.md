# 2026-07-03 复验收总结：真 DM 自驱 + BCDice 全链路

时隔近一月的复跑（原验收 2026-06-09，见同目录存档）。两跑均在本机完成，`.env`
从原开发机找回。本次新增两个验收目标：**① 主进程同款 FileTraceSink 消息留存**；
**② BCDice 生产结算路径**（ADR-0013，两个 live 脚本原先都用 NativeDice 种子随机，
BCDice 真路径此前从未进过 live）。

## 跑 1：live-realdm.ts（真 DM 自驱，6 分钟）

原始记录（本目录）：[2026-07-03-realdm-trace.md](2026-07-03-realdm-trace.md)（人眼视图）
+ [2026-07-03-realdm-trace.jsonl](2026-07-03-realdm-trace.jsonl)（机器视图，98 事件）。

- **消息留存 ✅（本次核心验收）**：`FileTraceSink` 双写生效。98 条事件按 agent 分：
  `aidm` 53、`npc:周慎` 15、`npc:铁拳·冈` 15、`npc:林萱` 15——DM 与每个 NPC 以
  真名共入一份时间线；事件类型齐全（turn-start/thinking/tool-use/tool-result/
  text/turn-end）。
- **编排 ✅**：9 次串行 nominate（3 轮 × 3 人全覆盖）+ 4 narrate + 2 discover_lead
  + 1 ToolSearch；零错误、零点名被拒、零空消息；频道实收 21 条。
- **发现 ⚠（检定发起方差）**：本跑 6 分钟内 DM **未喊任何 call_check**（16 次工具
  调用中 0 次）——三轮全是勘验推理，与 06-09 那跑「第二轮即喊侦查」对照，检定
  发起完全取决于 DM 自由裁量、方差极大。这是 PRD #50 预留的「检定发起可靠性
  调优（prompt + eval 台）」epic 的活标本；也因此本跑未覆盖 BCDice，由跑 2 补上。

## 跑 2：live-game.ts + DICE=bcdice（脚本化 DM 全链路，5/5）

原始记录（本目录）：[2026-07-03-live-game-bcdice-5of5.md](2026-07-03-live-game-bcdice-5of5.md)。

- **BCDice 真结算 ✅（本次核心验收）**：5 次检定全部经 BCDice（Cthulhu7th）判定，
  输出为 BCDice 命令语法 `CC<=70 → 50 → 成功（侦查）`（对照 NativeDice 的
  `d100=2 ≤ 70`）；hard 难度正确减半（`CC<=35`）。成功（50/28/9）与失败（58/72）
  两侧均出现，失败分支叙事正确转向（本次斗殴 72>65 失败，与 06-09 seed=7 的成功
  形成对照——BCDice 为真随机，不可复现属预期）。
- 全链路 ✅：5 里程碑推进至全剧终、#57 协商注入 3 次生效、3 池 bot 真身份发帖、
  频道实收 41 条、零错误。

## 判定与遗留

- PRD #50（#51–#57）编排验收：**两次独立复现通过**（06-09 + 07-03），可关闭。
- 消息留存（trace 调优基建）：**验收通过**——`npm start` 主进程同款路径
  （`data/traces/<campaign>/<runId>.{jsonl,md}`，`TRACE=0` 关闭）。
- #46 遗留：BCDice 检定 live ✅（本次补上）；**战斗轮 live 仍未覆盖**——#46 关闭前
  需一次含战斗的坐团。
- 脚本改动（本次 commit）：`live-realdm.ts` 固定走 BcdiceDice + FileTraceSink +
  NPC 真名 tap；`live-game.ts` 加 `DICE=bcdice` 开关（默认仍 NativeDice 种子随机，
  保 playbook 可复现）。
- DM prompt 待调优三件套（06-09 存档已记，本次维持）：cast 缺显示名（林萱→林轩）、
  CoC 团 D&D 式 DC 措辞、call_check 同轮不可再点名宜在 kickoff 预告。
