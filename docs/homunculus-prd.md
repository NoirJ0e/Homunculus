# PRD: Homunculus

> **Version:** 0.1 (Draft)
> **Date:** 2026-02-14
> **Author:** Joe (Owner) / Claude (PM)
> **Status:** Phase 1 — MVP Definition

---

## 1. 文档概览

### 1.1 产品名称

Homunculus

### 1.2 背景与动机

在使用 Discord 进行 TTRPG（桌上角色扮演游戏）线上跑团时，AI KP（如 OpenClaw）通常同时承担叙事推进和 NPC 扮演两项职责。这导致两个问题：

- **人格单一化**：所有 NPC 的行为逻辑和语气都来自同一个 LLM 实例，缺乏独立性和差异感。
- **Token 膨胀**：KP 需要在上下文中同时维护剧情、规则、多个 NPC 的性格和状态，导致 prompt 臃肿、成本高昂。

### 1.3 产品目标

构建一个**轻量级、可配置的 Discord Bot 框架**，使每个 TTRPG NPC 作为独立的 AI Agent 实例运行。每个 NPC 拥有自己的角色卡、记忆和行为逻辑，通过 Discord 频道与玩家和 KP 自然交互。

### 1.4 设计原则

- **极简**：NPC Agent 只做"读上下文 → 角色扮演 → 发消息"这一件事，不做规则引擎、不做叙事推进。
- **可配置**：模型、角色卡、规则集、记忆后端均可通过参数注入。
- **低成本**：通过分层上下文管理（短期 + 长期记忆），将单次调用的 token 消耗控制在合理范围内。
- **不侵入**：不替代 KP，不修改 KP 的行为，仅作为独立的 NPC 参与者加入频道。

---

## 2. 用户故事 (User Stories)

### 2.1 核心用户故事

**US-01** — As a TTRPG 玩家/GM, I want to deploy an independent AI bot for each NPC in my Discord campaign, so that NPCs feel like autonomous characters with their own personality, not puppets of the KP bot.

**US-02** — As a GM, I want to bind a JSON character sheet to each NPC bot, so that the NPC's behavior, skills, and personality are grounded in its character data.

**US-03** — As a GM, I want the NPC to respond when @mentioned by the KP or players, so that the NPC naturally participates in the conversation flow without needing custom trigger protocols.

**US-04** — As a GM, I want NPC bots to remember key events across sessions, so that the NPC can reference past interactions and maintain narrative continuity.

**US-05** — As a GM, I want to configure which LLM model and provider each NPC uses, so that I can balance cost vs. quality per character (e.g., Haiku for minor NPCs, Sonnet for key characters).

### 2.2 次要用户故事

**US-06** — As a GM, I want to switch the SKILL ruleset (CoC/DND/...) per agent, so that the same framework can be reused across different game systems.

**US-07** — As a player, I want to @mention an NPC directly to ask them a question or initiate conversation, so that I can interact with NPCs outside of KP-driven scenes.

---

## 3. 功能需求

### 3.1 Agent 实例化

通过以下签名创建并启动一个 NPC Agent 实例：

```
TTRPGAgent(
  charCard: CharacterCard,   // JSON 格式角色卡
  qmdIndex: str,             // QMD index 名称（每个 NPC 独立）
  channel: DiscordChannelID, // 目标频道
  skill: SkillRuleset,       // 游戏规则集 (CoC | DND | ...)
  model: ModelConfig          // LLM 供应商 + 模型标识
)
```

每个实例绑定一个独立的 Discord Bot 账号，以该 NPC 的身份出现在频道中。

**Hot-swap 支持（撕卡换人）**：当 NPC 被"撕卡"（角色死亡/退场）时，支持通过一行命令重新绑定角色卡，同时更新 Bot 的 Discord 头像和显示名称，等效于完全换人。旧角色的记忆归档，新角色从空白记忆开始。

### 3.2 角色卡 (CharacterCard)

JSON 格式，至少包含以下字段：

```json
{
  "name": "科瓦奇",
  "description": "一个沉默寡言的退伍军人，左眼有一道旧伤疤。",
  "personality": "谨慎、忠诚、不善言辞，但在危险时刻极为果断。",
  "background": "曾参加过大战，退役后在阿卡姆经营一家小杂货店。",
  "stats": {
    "STR": 65,
    "CON": 70,
    "DEX": 55,
    "INT": 50,
    "POW": 60,
    "APP": 40,
    "SIZ": 75,
    "EDU": 45,
    "HP": 14,
    "SAN": 52,
    "MP": 12
  },
  "skills": {
    "射击（手枪）": 55,
    "格斗（拳脚）": 60,
    "侦查": 45,
    "潜行": 40,
    "急救": 35
  },
  "inventory": ["一把旧左轮手枪", "军用水壶", "破旧的军大衣"]
}
```

### 3.3 触发与响应机制

- Agent 监听指定 `channel` 中的消息事件。
- **触发条件**：Agent 的 Discord Bot 被 @mentioned。
- **响应流程**：
  1. 读取频道最近 N 条消息（N 可配置，默认 25）。
  2. 以当前场景构造 query，通过 QMD 混合检索加载 Top-K 条相关长期记忆。
  3. 构造 prompt（见 3.5 上下文构造）。
  4. 调用 LLM 获取响应。
  5. 将响应发送到频道。
  6. 异步执行记忆提取（见 3.4）。
- **无序响应**：多个 Agent 同时被 @ 时各自独立响应，不做排序或等待。

### 3.4 记忆系统

采用两层架构，整体设计借鉴 [OpenClaw 的 QMD memory backend](https://docs.openclaw.ai/concepts/memory)。

**短期上下文（Short-term）**：频道最近 N 条原始消息，每次触发时实时读取，不做持久化。

**长期记忆（Long-term）**：基于 [QMD](https://github.com/tobi/qmd) 的混合检索记忆系统。

#### 核心原则：Markdown as Source of Truth

与 OpenClaw 保持一致，**Markdown 文件是记忆的唯一来源**，QMD 仅作为检索层。每个 NPC 的记忆以 Markdown 文件形式存储在磁盘上，QMD 负责索引和检索。

每个 NPC 的记忆文件布局：

```
~/.homunculus/agents/<npc_name>/memory/
├── MEMORY.md                    # 策展的长期记忆（核心人格、关键关系）
└── memory/
    ├── 2026-02-14.md            # 每日日志（append-only）
    ├── 2026-02-15.md
    └── ...
```

#### 复用现有 QMD 实例

Joe 的 homelab 上已有 OpenClaw 部署的 QMD 实例运行（Bun + 本地 GGUF 模型已就绪）。Homunculus **直接复用同一个 `qmd` binary**，不重复部署。通过独立的 XDG 路径实现数据隔离（借鉴 OpenClaw 的 `~/.openclaw/agents/<agentId>/qmd/` 模式）：

```bash
# 每个 NPC 的 QMD 环境隔离
export XDG_CONFIG_HOME="~/.homunculus/agents/<npc_name>/qmd/xdg-config"
export XDG_CACHE_HOME="~/.homunculus/agents/<npc_name>/qmd/xdg-cache"
```

#### 写入流程

1. 每次 Agent 响应完成后，异步触发一次轻量级 LLM 调用（推荐 Haiku 级别模型）。
2. 从本轮对话中提取与该 NPC 相关的关键事实，append 到当日的 `memory/YYYY-MM-DD.md`。
3. 定时执行 `qmd update` + `qmd embed`（借鉴 OpenClaw 默认 5 分钟间隔），保持索引新鲜。

#### 读取流程

1. 每次 NPC 被触发时，以当前场景信息构造 query。
2. 通过 `qmd query --json` 执行混合检索（BM25 + 向量 + reranking），获取 Top-K 条最相关的历史记忆。
3. 如果 `qmd query` 超时或失败，自动 fallback 到 `qmd search`（纯 BM25，几乎即时）。
4. 将检索结果注入 system prompt。

#### 搜索模式选择（借鉴 OpenClaw 经验）

| 模式 | 命令 | 速度 | 质量 | 使用场景 |
|------|------|------|------|----------|
| BM25 | `qmd search` | 即时 | 关键词精确匹配强 | 默认 fallback |
| 向量 | `qmd vsearch` | 冷启动较慢 | 语义相似度强 | 可选 |
| 混合 | `qmd query` | 最慢（含 reranking） | 最高 | 推荐默认 |

**性能注意**：`qmd query` 和 `qmd vsearch` 在冷启动时可能需要加载本地 LLM 模型（如 Qwen3-1.7B），首次调用可能较慢。建议保持 QMD 进程/模型 warm（如使用 MCP server 模式长驻）。

#### 一致性模型

最终一致性。如果记忆提取失败，仅记录日志，不影响主响应流程。索引更新为异步定时任务，搜索结果可能略有延迟，在跑团场景中可以接受。

#### 记忆隔离

每个 NPC 通过独立的 XDG 路径拥有完全隔离的 QMD 索引。Hot-swap 时旧角色的记忆目录归档保留，新角色创建新目录和索引。

### 3.5 上下文构造

每次 LLM 调用的 prompt 结构如下：

```
[System Prompt]
你是 {name}，一个 TTRPG 角色。
{personality}
{background}

你的属性和技能：
{stats + skills 摘要}

你携带的物品：
{inventory}

游戏规则参考（{skill} 摘要）：
{skill_rules_excerpt}

你的记忆（过去发生的重要事情）：
{qmd_retrieved_memories}  // Top-K results from QMD hybrid search

[User Messages]
以下是最近的对话记录：
{recent_N_messages}

有人正在对你说话，请以 {name} 的身份回应。保持角色性格，简洁自然地回应。
```

### 3.6 SKILL 规则集

以可插拔模块形式提供游戏规则的摘要文本，Agent 不执行规则（不 roll 骰子、不做判定），仅将规则作为行为参考注入 system prompt。

MVP 提供：
- `coc7e`：克苏鲁的呼唤 第七版核心规则摘要
- `dnd5e`：D&D 5e 基础规则摘要

格式为纯文本或 Markdown 文件，路径可配置。

### 3.7 模型配置 (ModelConfig)

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
  "api_key_env": "ANTHROPIC_API_KEY",
  "max_tokens": 500,
  "temperature": 0.7
}
```

支持的供应商（MVP）：Anthropic。预留 provider 抽象层以便后续扩展。

---

## 4. 非功能需求

### 4.1 性能

- 单次 NPC 响应延迟目标 < 5 秒（取决于 LLM API 延迟）。
- 记忆提取任务应在 10 秒内完成，不阻塞主响应。

### 4.2 成本控制

- 单次 NPC 响应的 input token 目标控制在 2,000 以内（system prompt + memories + recent messages）。
- 记忆提取使用最低成本模型（Haiku 级别），单次 < 500 input tokens。

### 4.3 可靠性

- Agent 进程崩溃不影响其他 Agent 实例和 KP bot。
- memoryDB 写入失败不影响主响应流程（graceful degradation）。
- Discord 连接断开后应自动重连。

### 4.4 安全性

- API Key 通过环境变量注入，不硬编码。
- Bot Token 每个实例独立，权限最小化（仅需 Read Messages + Send Messages + Read Message History）。

### 4.5 可维护性

- 角色卡热更新：修改 JSON 文件后，下次触发时自动加载最新版本（或提供 reload 命令）。
- 日志：每次 LLM 调用记录 token 使用量，便于成本监控。

---

## 5. 成功衡量标准 (Success Metrics)

由于这是个人/小团体项目，不采用传统的商业指标，而是关注体验质量：

| 指标 | 目标 | 衡量方式 |
|------|------|----------|
| NPC 人格一致性 | NPC 的回复符合角色卡设定，不跑偏 | 跑团后主观评价 |
| 记忆连续性 | NPC 能引用 2+ sessions 前的关键事件 | 跑团中验证 |
| 单次响应成本 | < 2,500 tokens (input + output) | LLM API 日志 |
| 响应延迟 | < 5 秒 (p90) | 时间戳日志 |
| 系统稳定性 | 单次跑团 session (3-4 小时) 内零崩溃 | 运行日志 |

---

## 6. 技术实现建议

### 6.1 推荐技术栈

| 组件 | 建议 | 理由 |
|------|------|------|
| 语言 | Python 3.12+ | discord.py 生态成熟，async 原生支持 |
| Discord SDK | discord.py | 最流行的 Python Discord 库，async-first |
| LLM Client | anthropic SDK | 官方 SDK，async 支持良好 |
| 记忆检索 | QMD（复用 OpenClaw 已部署的实例） | BM25 + 向量 + reranking 混合检索，全本地，零 API 成本 |
| 记忆存储 | Markdown 文件 + SQLite（QMD 内置） | Markdown 是 source of truth，QMD 自动索引 |
| 本地推理 | Bun + node-llama-cpp（QMD 内置） | QMD 自动下载 GGUF 模型，无需额外 Ollama 守护进程 |
| 配置管理 | YAML/TOML 配置文件 | 角色卡 JSON + 全局配置 YAML |
| 进程管理 | asyncio 多任务 | 多个 Agent 共享一个事件循环 |

### 6.2 架构概览

```
┌─────────────────────────────────────────────┐
│                 Discord                      │
│  #game-table channel                         │
│  ┌──────┐ ┌──────────┐ ┌──────────┐         │
│  │ Joe  │ │ KP (OC)  │ │ 科瓦奇    │ ...    │
│  └──┬───┘ └────┬─────┘ └────┬─────┘         │
└─────┼──────────┼────────────┼────────────────┘
      │          │            │
      │    @科瓦奇 @Joe       │ on_mention
      │          │            ▼
      │          │   ┌──────────────────────┐
      │          │   │    TTRPGAgent        │
      │          │   │   ┌────────────┐     │
      │          │   │   │ charCard   │     │
      │          │   │   │ (JSON)     │     │
      │          │   │   └────────────┘     │
      │          │   │   ┌────────────┐     │
      │          │   │   │ SKILL      │     │
      │          │   │   │ (CoC/DND)  │     │
      │          │   │   └────────────┘     │
      │          │   └──────────┬───────────┘
      │          │              │
      │          │       ┌──────┴──────┐
      │          │       ▼             ▼
      │          │  ┌─────────┐  ┌───────────────┐
      │          │  │ LLM API │  │ qmd query     │
      │          │  │ (Sonnet/│  │ (shell out,   │
      │          │  │  Haiku) │  │  reuse OC's   │
      │          │  └────┬────┘  │  QMD binary)  │
      │          │       │       └───────┬───────┘
      │          │       │               │
      │          │       ▼               │ Top-K memories
      │          │  Response → Channel   │
      │          │       │               │
      │          │       ▼ (async)       │
      │          │  ┌─────────────────────────┐
      │          │  │ Memory Extract (Haiku)  │
      │          │  │ → append to daily .md   │
      │          │  │ → QMD auto-indexes      │
      │          │  └─────────────────────────┘
      │          │
      │          │   ┌──────────────────────────────────┐
      │          │   │  ~/.homunculus/agents/<npc>/      │
      │          │   │  ├── memory/                      │
      │          │   │  │   ├── MEMORY.md                │
      │          │   │  │   └── memory/2026-02-14.md     │
      │          │   │  ├── qmd/xdg-config/              │
      │          │   │  └── qmd/xdg-cache/               │
      │          │   └──────────────────────────────────┘
```

### 6.3 关键实现细节

**多 Bot 部署**：每个 NPC 需要一个独立的 Discord Bot Token（在 Discord Developer Portal 创建）。多个 Agent 可以在同一个 Python 进程中以 asyncio tasks 运行，共享事件循环，也可以作为独立进程部署。

**记忆提取的异步处理**：

```python
# 伪代码
async def on_mention(message):
    context = await build_context(message.channel, n=25)
    scene_query = summarize_scene(context)  # 简短的场景摘要作为检索 query
    memories = await qmd_query(npc_name, query=scene_query, top_k=10)
    prompt = construct_prompt(char_card, memories, context, skill)
    response = await llm.complete(prompt, model_config)
    await message.channel.send(response)
    # Fire-and-forget memory extraction
    asyncio.create_task(extract_and_store_memory(context, response, npc_name))

async def qmd_query(npc_name: str, query: str, top_k: int = 10):
    """Shell out to qmd with NPC-specific XDG paths (borrowing OpenClaw's pattern)."""
    env = {
        "XDG_CONFIG_HOME": f"~/.homunculus/agents/{npc_name}/qmd/xdg-config",
        "XDG_CACHE_HOME": f"~/.homunculus/agents/{npc_name}/qmd/xdg-cache",
    }
    try:
        result = await run_cmd(f"qmd query --json -n {top_k} '{query}'", env=env)
        return parse_qmd_json(result)
    except TimeoutError:
        # Fallback to BM25 (instant, no LLM needed)
        result = await run_cmd(f"qmd search --json -n {top_k} '{query}'", env=env)
        return parse_qmd_json(result)

async def extract_and_store_memory(context, response, npc_name):
    """Extract facts → append to daily Markdown → QMD indexes on next update cycle."""
    try:
        facts_md = await llm.complete(
            memory_extraction_prompt(context, response, npc_name),
            model="claude-haiku-4-5-20251001"
        )
        # Append to daily memory file (Markdown is source of truth)
        today = date.today().isoformat()
        memory_path = f"~/.homunculus/agents/{npc_name}/memory/memory/{today}.md"
        async with aiofiles.open(memory_path, "a") as f:
            await f.write(f"\n{facts_md}\n")
        # QMD picks up changes on next update cycle (default 5m)
        # Or optionally trigger immediate: await run_cmd("qmd update && qmd embed")
    except Exception as e:
        logger.warning(f"Memory extraction failed for {npc_name}: {e}")
```

**角色卡热加载**：每次触发时从文件系统读取 JSON，不做缓存。对于跑团场景的触发频率（每分钟几次），文件 I/O 的开销可以忽略。

### 6.4 部署建议

适合部署在 Joe 的 homelab（AMD 7735HS）上，资源需求较低：

- 内存：每个 Agent 实例 < 50MB；QMD 的本地 GGUF 模型（embedding + reranker + query expansion）已由 OpenClaw 部署，共享使用
- CPU：Python 进程几乎为零（等待 Discord 事件和 LLM API 响应）；QMD 检索时有短暂的 CPU 占用
- 存储：Markdown 记忆文件 + QMD SQLite 索引 + JSON 角色卡，可忽略
- 网络：仅需出站访问 Discord API 和 Anthropic API；QMD 为本地调用

前置依赖：
- QMD CLI（已通过 OpenClaw 部署安装，确保 `qmd` 在 PATH 上）
- Bun runtime（QMD 依赖，已随 OpenClaw 安装）
- 本地 GGUF 模型（QMD 首次 `qmd query` 时自动下载，或复用 OpenClaw 已缓存的模型）

可通过 Docker Compose 管理多个 Agent 实例，也可以直接用 systemd service。

---

## 7. Phase 2 路线图（参考）

以下功能明确不在 MVP 范围内，但作为后续迭代方向记录：

- **骰子集成**：NPC 自动 roll 技能检定并发送格式化的骰子结果。
- **NPC 间对话**：NPC Agent 之间可以直接互动，不需要 KP 或玩家触发。
- **Web UI 管理面板**：可视化管理角色卡、查看/编辑记忆、启停实例。
- **情绪/状态系统**：基于 HP、SAN 等数值变化动态调整 NPC 行为倾向。
- **多频道漫游**：NPC 可以"移动"到不同频道（房间），模拟物理空间。
- **多供应商支持**：扩展到 OpenAI、本地模型（Ollama）等。

---

## 8. 开放问题

| # | 问题 | 影响 | 状态 |
|---|------|------|------|
| 1 | ~~Bot Token 共享还是独立？~~ | — | ✅ 已决定：独立 Token，支持 hot-swap 换角色 |
| 2 | ~~记忆数据库选型和清理策略？~~ | — | ✅ 已决定：QMD 混合检索，按相关性 Top-K 取用，无需清理 |
| 3 | ~~项目命名？~~ | — | ✅ 已决定：Homunculus |
| 4 | QMD 的 embedding 生成是否需要与主响应流程串行？ | 如果 embedding 未完成，下一次检索可能漏掉最新记忆 | 建议异步，接受最终一致性（与 OpenClaw 一致） |
| 5 | QMD 冷启动延迟是否可接受？ | 首次 `qmd query` 需加载本地模型，可能较慢 | 建议使用 QMD MCP server 模式长驻保持 warm，或 fallback 到 `qmd search` |
| 6 | scene_query（用于记忆检索的 query）如何构造？ | 直接影响检索质量 | 借鉴 OpenClaw 的做法，或用最近 3-5 条消息做摘要 |
