# Discord Integration Status

## ✅ Completed (2025-02-16)

Discord.py integration is now **fully implemented** and ready for testing.

### What Was Added

#### 1. **Discord Client Service** (`src/homunculus/discord/client.py`)
- Full discord.py event loop integration
- Automatic channel discovery and history fetching
- Message routing to response pipeline
- Error handling and logging

#### 2. **Message Handler Bridge** (`src/homunculus/discord/message_handler.py`)
- Adapts Discord messages to ResponsePipeline interface
- Passes character card and skill ruleset to pipeline

#### 3. **Runtime Factory** (`src/homunculus/runtime/factory.py`)
- Wires up entire system:
  - CharacterCard loading
  - QMD adapter + memory scheduler
  - LLM client (Anthropic)
  - Prompt builder
  - Response pipeline
  - Discord client service
- Manages background tasks (QMD index maintenance)

#### 4. **Runtime App Updates** (`src/homunculus/runtime/app.py`)
- Uses factory to create Discord service
- Manages lifecycle of services and background tasks
- Clean shutdown with task cancellation

#### 5. **Dependencies** (`pyproject.toml`)
- Added `discord.py>=2.3.0`

#### 6. **Examples**
- `examples/kovach/character-card.json` - Full CoC character sheet
- `examples/kovach/config.json` - Ready-to-use configuration
- `docs/QUICKSTART.md` - Step-by-step setup guide

### Architecture

```
Discord Message
    ↓
DiscordClientService (discord/client.py)
    ↓
DiscordMessageHandler (discord/message_handler.py)
    ↓
ResponsePipeline (pipeline/response_pipeline.py)
    ├→ QMD Memory Retrieval (memory/qmd_adapter.py)
    ├→ Prompt Building (prompt/builder.py)
    ├→ LLM Completion (llm/client.py → Anthropic)
    ├→ Reply Formatting (discord/reply_formatter.py)
    └→ Memory Extraction (memory/extractor.py → background)
    ↓
Discord Channel.send()
```

### Key Features

- **Mention-based triggering**: Bot only responds when @mentioned
- **Channel isolation**: Each bot instance is scoped to a single channel
- **Memory persistence**: QMD-backed retrieval + markdown append
- **Background maintenance**: Periodic `qmd update` + `qmd embed`
- **Token budgeting**: Intelligent prompt truncation (2000 token budget)
- **Hot-swap ready**: Infrastructure for NPC identity changes

## Testing Checklist

- [ ] Install dependencies: `pip install -e .`
- [ ] Set environment variables (see `docs/QUICKSTART.md`)
- [ ] Bootstrap agent directory: `python scripts/bootstrap-agents.py kovach`
- [ ] Config check: `homunculus --check --config examples/kovach/config.json`
- [ ] Start runtime: `homunculus --config examples/kovach/config.json`
- [ ] Verify Discord connection in logs
- [ ] Send @mention in target channel
- [ ] Verify in-character response
- [ ] Check memory file: `~/.homunculus/agents/kovach/memory/*.md`

## Known Limitations

1. **Message Content Intent Required**
   - Bot needs `Message Content Intent` enabled in Discord Developer Portal
   - Without it, bot can't read message content

2. **Single Channel Per Instance**
   - Each bot instance monitors exactly one channel
   - For multiple channels, run multiple instances with different configs

3. **No Slash Commands Yet**
   - `/npc status`, `/npc reload`, `/npc swap` defined but not wired to Discord
   - Requires discord.py application commands integration

4. **No Voice Channel Support**
   - Text channels only

5. **No Reaction/Button Support**
   - Could be added via discord.py interactions

## Next Steps (Optional)

- [ ] Wire slash commands to discord.py `app_commands`
- [ ] Add Docker Compose multi-NPC example
- [ ] Integration tests with mocked Discord client
- [ ] Performance tuning (connection pooling, caching)
- [ ] Add health check endpoint for monitoring

## Files Changed/Added

```
src/homunculus/discord/
├── client.py                    [NEW] Discord client service
├── message_handler.py          [NEW] Pipeline bridge
└── __init__.py                 [MODIFIED] Export new classes

src/homunculus/runtime/
├── factory.py                   [NEW] System wiring factory
└── app.py                      [MODIFIED] Use factory

src/homunculus/discord/
└── mention_listener.py          [MODIFIED] Mutable bot_user_id

examples/kovach/
├── character-card.json          [NEW] Example NPC
└── config.json                  [NEW] Example config

docs/
└── QUICKSTART.md                [NEW] Setup guide

pyproject.toml                   [MODIFIED] Add discord.py dependency
```

---

**Status**: Ready for first integration test.

**Estimated effort to get running**: 5-10 minutes (assuming QMD + Discord bot already set up).
