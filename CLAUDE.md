# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Homunculus is an autonomous Discord NPC agent for TTRPG games. It's a Python Discord bot that plays in-character NPCs with persistent memory, skill rules (CoC 7e, D&D 5e), and LLM-powered responses. It integrates with OpenClaw for shared LLM access or calls the Anthropic API directly.

## Common Commands

```bash
# Run the bot
python -m homunculus --config config/homunculus.example.json

# Validate config without starting
python -m homunculus --check --config config/homunculus.example.json

# Run all unit tests
pytest -m "not integration and not smoke" --maxfail=1

# Run a single test file
pytest tests/test_response_pipeline.py

# Run a single test
pytest tests/test_response_pipeline.py::test_function_name -v

# Run integration/smoke tests
pytest -m "integration or smoke" --maxfail=1

# Lint
ruff check .

# CI scripts (used by GitHub Actions)
bash scripts/ci/install-deps.sh
bash scripts/ci/run-lint.sh
bash scripts/ci/run-unit-tests.sh
bash scripts/ci/run-integration-smoke.sh
```

## Architecture

### Data Flow: Discord Message to Response

```
Discord @mention → DiscordClientService → MultiChannelMessageHandler (route by channel_id)
  → DiscordMessageHandler (add reaction, start typing)
    → ResponsePipeline.on_message()
      1. MentionListener.should_respond() — filter
      2. RecentMessageCollector.collect() — channel history
      3. QmdAdapter.retrieve(scene_query) — semantic memory search
      4. load_skill_excerpt(ruleset) — game rules
      5. PromptBuilder.build() — strict 2000-token budget
      6. LlmClient.complete() — Anthropic or OpenAI-compatible
      7. ReplyFormatter.format_reply() — "**NPC:** response"
      8. ChannelSender.send_message()
      9. MemoryExtractor.schedule_extraction() — async background
```

### Key Modules (`src/homunculus/`)

| Module | Purpose |
|--------|---------|
| `runtime/factory.py` | Central wiring — creates all services per channel |
| `runtime/app.py` | Service lifecycle, signal handling, shutdown ordering |
| `pipeline/response_pipeline.py` | Main orchestrator from message to response |
| `discord/client.py` | discord.py wrapper (`DiscordClientService`) |
| `discord/message_handler.py` | Per-channel handler + multi-channel router |
| `discord/mention_listener.py` | Trigger filter (bot mention + correct channel) |
| `llm/client.py` | LLM adapters (Anthropic native, OpenAI-compatible for OpenClaw) |
| `prompt/builder.py` | Prompt assembly with deterministic token budget truncation |
| `memory/qmd_adapter.py` | QMD CLI wrapper (`qmd query` with `qmd search` fallback) |
| `memory/extractor.py` | Fire-and-forget fact extraction via LLM |
| `memory/scheduler.py` | Periodic `qmd update` + `qmd embed` background task |
| `config/settings.py` | Nested dataclass settings (JSON + env var overlay) |
| `character_card.py` | Character JSON schema validation |
| `agent/hotswap.py` | NPC identity swapping with archive |
| `skills/excerpts.py` | Load ruleset markdown (coc7e, dnd5e) |
| `ops/bootstrap.py` | Agent directory structure creation |

### Design Patterns

- **Protocol-based composition**: Loose coupling throughout; most dependencies are Protocols, not concrete classes
- **Per-namespace isolation**: Each NPC gets isolated directories under `~/.homunculus/agents/{bot_name}/{namespace}/`
- **Graceful degradation**: QMD query falls back to keyword search; skill excerpt errors produce empty fallback
- **Strict token budget**: `PromptBuilder` enforces a hard limit (default 2000 tokens) with deterministic truncation — oldest memories dropped first, newest history kept
- **Fire-and-forget memory**: `MemoryExtractor` runs async after response, never blocks the reply

### Config System

Config loads from JSON file (`--config`) with environment variable overrides. Key env vars are in `.env.example`. Per-NPC config uses the pattern `NPC_<SLUG>_<FIELD>`. The `model.provider` field selects between `anthropic`, `openai`, and `openclaw` LLM backends.

### LLM Providers

- **anthropic**: Direct Anthropic Messages API via custom HTTP transport (no SDK dependency)
- **openai/openclaw**: OpenAI Chat Completions format; OpenClaw routes via `x-openclaw-agent-id` header

### Memory System

Uses [QMD](https://github.com/openclaw/qmd) CLI for semantic memory:
- `qmd query` for semantic retrieval (with `qmd search` keyword fallback)
- `qmd update` + `qmd embed` run on a periodic scheduler (default 300s)
- Daily memory files written to `{namespace}/memory/memory/YYYY-MM-DD.md`
- Environment isolation via per-namespace `XDG_CONFIG_HOME` / `XDG_CACHE_HOME`

### Adding a New Skill Ruleset

1. Create `src/homunculus/skills/excerpts/<ruleset>.md`
2. Add to `_SUPPORTED_RULESETS` in `skills/excerpts.py`
3. Set `"skill_ruleset": "<ruleset>"` in character config
