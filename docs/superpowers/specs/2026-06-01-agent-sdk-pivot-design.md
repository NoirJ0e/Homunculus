# 设计：转向 Agent SDK 驱动 + 引擎即 MCP 工具裁判

- 日期：2026-06-01
- 状态：待用户审阅
- 影响：改写 ADR-0003（节奏模型）、新增 ADR-0009（Agent-SDK 驱动 + MCP 工具边界）；不动 ADR-0001/0002/0004/0005/0006/0007/0008 的决策内核

## 1. 动机

当前 `AnthropicAgent` 用的是 **Messages API（chat SDK）**，引擎当导演、循环调 `agent.takeTurn()`。问题：

- **friction**：引擎要把节奏/裁决一步步编排死，凡 agent 行为出偏差就得在引擎里补 patch。
- **省钱**：想复用 Claude 订阅额度（Pro/Max 的 Agent SDK 月度额度），而非按 token 付费的 API 信用点。

转向目标：**把 DM 做成一个自驱的 Agent SDK 循环，自己拿一组小工具，出问题自己组合工具修**。"Friction 最少的设计就是好设计。" 引擎退为**裁判 + 共享状态**，把不变量暴露成工具——纪律从"求 agent 配合"变成"工具边界物理强制"。

## 2. 核心决策（已与用户确认）

1. **控制权半反转**
   - **DM** 完全反转：DM = 一个长活的 Agent SDK `query()` 循环，主动调 `narrate` / `await_actors` / `advance_milestone` 等工具推动牌桌。
   - **NPC** 不反转：当 DM 的 `await_actors` 挂起时，**引擎**按节奏拉起在场 NPC（先过唤醒闸，再让其 agent 出 `speak`/`pass`/`roll`）。每个 NPC 仍是独立 agent + 独立上下文（保住 PRD "每 NPC 一个 agent，满注意力" 的核心赌注）。

2. **引擎能力 = 进程内 MCP server**（`createSdkMcpServer` + `tool()`，Zod schema）。工具 handler 是同进程 TS 闭包，直接调用现有纯内核，共享状态、零 IPC。

3. **复用订阅鉴权**：`CLAUDE_CODE_OAUTH_TOKEN`（Pro/Max 订阅）。落地时用最小脚本实测 Agent SDK 是否认此 token（见 §8 寄存）。

4. **工具三组 + 两条红线物理化**（详见 §4）。
   - NPC 角色拿不到 `narrate`/`advance_milestone` → 纯叙事共治（ADR-0002）在**工具权限层**强制。
   - DM 只有 `read_card`、没有 `write_card` → SealDice 唯一写权威（ADR-0001/0002）物理保证。

5. **统一节奏模型：万物皆"简化战斗轮"**（这是对 ADR-0003 的关键改写，详见 §3）。

6. **出手顺序**：真战斗用 SealDice 投先攻定序；日常/非战斗由 DM 点名定序。

7. **抢救内核、重写外壳**：保留 domain + 纯 engine 逻辑 + 其单测；重写 `engine.ts` 导演循环为 MCP 工具层；删 `AgentPort` / chat 适配器 / `fake-agent`；重写编排型集成测试。

## 3. 统一节奏模型：简化战斗轮（改写 ADR-0003）

**旧模型的错误**：屏障是"一刀切冻结"——只要真人沉默，整拍连同 A/B/C 全部悬停、什么都不确定。这掐死了"后手看前手再反应"的涌现玩法（违反战斗轮真实体感）。

**新模型**：所有场景（战斗 / 查案 / 日常对话）都视为一个**简化战斗轮**：

1. **有出手顺序**（战斗投先攻；日常 DM 点名）。
2. **后手看前手**：靠后的行动者能看到前手**这一轮刚做的事**，据此反应（涌现、JIT、AI 互相串戏）。
3. **效果留存**：前手打出的伤害 / 查到的线索 / 推出的结论都算数、保留，**不因真人沉默而回滚**。
4. **真人是闸**：真人没动 → 牌桌**不冻结当下**，该出手的照常出手。
5. **溢出有界**：剧情**最多往前推进一轮**，然后 **hang 住**等真人。AI 不能无限跑下去。
6. **"别在我缺席时破案"自然涌现**：把案子闭合 / 进下一场是**再下一轮**的事，而下一轮被真人的闸锁住。所以 AI 可以在当前轮把线索摆上桌、甚至喊出结论，但故事不会越过真人闭合。

**hang = 可序列化 `PauseState`**（复用现有），触发点从"立刻"挪到"溢出一轮后"。存档 = 序列化挂起的屏障状态 + 还在等谁；重启 = 重新挂起。

**与 ADR-0007 自洽**：导航/风味抉择天然在轮内流动；后果性闭合天然被"溢出一轮即 hang"挡在真人之后——无需再单列两种锁。

## 4. 工具清单

### A. DM Agent 专属
| 工具 | 作用 | 背后内核 |
|---|---|---|
| `narrate(sceneId, prose)` | 发叙事（唯一叙事→状态翻译官） | `scenes.record` + substrate emit |
| `await_actors(sceneId, order)` | 开屏障；引擎按 `order` 跑一轮小循环；真人沉默→溢出一轮后挂起 | `pacing` + deferred await |
| `call_check(actor, skill, difficulty)` | 喊检定（只喊不掷） | 登记 pending check |
| `roll_initiative(actors)` | 战斗投先攻定序 | SealDice 适配器 |
| `advance_milestone()` / `discover_lead(text)` | 推进剧情脊柱 | `milestone-cursor` |
| `advance_clock(clockId)` | 推世界时钟（软引力） | `world-clock` |
| `add_member` / `remove_member(sceneId, actor)` | 增删场景成员 | `scenes` |
| `read_card(actor)` | **只读**卡值 | SealDice 适配器（读） |

### B. NPC / 玩家角色可调
| 工具 | 作用 |
|---|---|
| `speak(prose)` | 发言（满足屏障） |
| `pass()` | 明确空过（满足屏障、不 hold） |
| `roll()` | 对自己 pending 的检定发 `.ra`（经 SealDice 判定） |

### C. 不暴露为工具（自动 / 带外）
- **唤醒闸**（`shouldSpeak`）：引擎拉起 NPC agent 前自动跑。
- **canonicity fork/merge/discard、人格反思 pass、换手**：owner 的带外会话操作（开局/收尾/管理）。

## 5. 一个回合的数据流（新）

```
1. DM loop 调 narrate("夜风灌进酒馆…")
   └ handler → scenes.record + substrate emit

2. DM 调 await_actors(tavern, order=[rogue, cleric, human])
   └ handler 开屏障，引擎接管节奏跑“一轮小循环”：
        for actor in order:                 # 出手顺序
           ctx = 该 actor 视界 + 本轮前手刚发的帖   # 后手看前手
           - 唤醒闸 shouldSpeak?
           - npc → 拉起其 agent，收 speak/pass/roll（效果留存）
           - human → 查 humanInbox：
                有输入 → 应用
                沉默   → 标记“真人未表态”
        一轮跑完：
           - 所有被等者已表态 → resolve，返回结果给 DM
           - 有真人未表态 → 已溢出这一轮，★挂起★（PauseState），不 resolve
   └ 返回 DM：「rogue 拔匕首；cleric 退后；（human 待定）」

3. DM 读结果 → narrate(...) + 可能 advance_milestone()
   但：若 human 仍未表态，下一轮的小循环不再继续 → 故事停在真人之前
```

**暂停**：第 2 步若真人沉默，溢出一轮后 deferred 永不 resolve → DM loop 停在 `await_actors` = "今晚到此为止"。

## 6. 代码去留（抢救内核、重写外壳）

**原样保留（domain + 纯内核 + 其单测）**
- `src/domain/*`（ids/post/soul/campaign/agent 里的 persona/memory 类型）
- `src/engine/` 纯逻辑：`pacing`、`scenes`、`canonicity`、`memory`、`milestone-cursor`、`world-clock`、`soft-gravity`、`world-branch`、`reflection`、`controller`、`roster`
- 对应单测：pacing、scenes、canonicity、memory、milestone-cursor、world-clock、soft-gravity、party-split、persona-evolution、soul、hot-swap
- 适配器：`sealdice/http-sealdice`、`discord/*`、`genesis/*`、`memory/fake-*`（除 fake-agent）、`ports/{sealdice,substrate,human-inbox,soul-store,card-shim}`

**删除（旧外壳）**
- `src/ports/agent.ts`（AgentPort）
- `src/adapters/anthropic/anthropic-agent.ts`（chat 适配器）
- `src/adapters/memory/fake-agent.ts`
- 编排型集成测试：single-beat、pacing-beat、visibility、spine、dice-flow、soul-memory-context、e2e-session、anthropic-agent（→ 后续以新形态重写）

**新建（新外壳）**
- `src/mcp/engine-server.ts`：`createSdkMcpServer` 包装上述工具。
- `src/runtime/dm-loop.ts`：DM 的 Agent SDK `query()` 驱动 + 订阅鉴权 + systemPrompt（DM persona）。
- `src/runtime/npc-turn.ts`：引擎拉起 NPC 出 `speak/pass/roll` 的单次/带工具调用。
- `src/runtime/round.ts`：简化战斗轮小循环（出手顺序、后手看前手、效果留存、溢出一轮 hang）。
- 重写集成测试：用**假 query/假工具调用流**驱动，断言可见性/节奏/骰子/脊柱/记忆/暂停——保持确定性、无网络（沿用本仓库测试范式）。

**`engine.ts`**：现有 `runBeat` 导演循环被 `round.ts` + MCP 工具层取代；保留它对纯内核的组合方式作参考，但不再是入口。

## 7. 测试策略（沿用接缝范式）

- **接缝 1（纯内核）**：原样，单测继续绿。
- **小循环编排**：`round.ts` 作纯状态机测——给定出手顺序 + 每格的（脚本化）产出 + 真人输入/沉默，断言：后手 ctx 含前手帖、效果留存、溢出一轮后产出 PauseState。
- **MCP 工具层**：每个工具 handler 单测——调用后断言内核状态转移正确（屏障/里程碑/场景成员/pending check）。
- **DM/NPC 驱动**：用**假 query**（脚本化"模型这一步调了哪个工具"）替代真 Agent SDK，确定性测编排——等价于旧 FakeAgent 的角色，但形态是"假工具调用序列"。
- **真 Agent SDK + 订阅**：一条 HITL 冒烟（需 token），`test.skip` 守卫。

## 8. 寄存项

- **订阅鉴权实测**：落地前用最小 `query()` + `CLAUDE_CODE_OAUTH_TOKEN` 验证 Agent SDK 是否认订阅 token；不认则回退 API key（仅影响省钱，不影响架构）。
- **锚点问题**：AI 比真人快/准、把结论摆上桌可能架空真人。烈度由"溢出一轮"缓冲 + "一轮"粒度（playtest 旋钮）调，暂不拍死。
- **NPC 驱动用 chat-SDK 单次还是 Agent-SDK 单次**：NPC 不需要自治循环，二者皆可；实现时择简，不阻塞设计。

## 9. 非目标

- 不重做 domain 模型（已验证正确）。
- 不在本次引入真 Discord/真 SealDice 在线验证（仍 HITL）。
- 不做 pillar 1（VTT）/ pillar 3（完整多人）。
- 订阅 token **仅自用**；多人化时各自鉴权，不共用（红线）。
