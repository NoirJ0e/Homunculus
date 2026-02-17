# Multi-Channel Support - Implementation Handover

**Version**: 0.2.0  
**Created**: 2026-02-16  
**Priority**: Medium  
**Estimated Effort**: 4-6 days  
**Assignee**: TBD (Codex or developer)

---

## Executive Summary

Enable a single Homunculus bot instance to handle multiple Discord channels, with each channel having:
- **Independent character identity** (different character cards)
- **Isolated memory** (separate QMD indices)
- **Separate conversation history**

**Use Case**: With 3 bot instances, support multiple 4-player TTRPG campaigns simultaneously without deploying dozens of separate processes.

**Current Limitation**: 1 bot = 1 character = 1 channel (hard-coded)

---

## Background

### Current Architecture (v0.1.0)

```
Homunculus Instance
├── config.json (single channel_id)
├── Character Card (single NPC)
└── QMD Memory (~/.homunculus/agents/<npc_name>/)
    └── Single memory index
```

**Deployment Model**:
- Want 12 NPCs across 3 campaigns? → Deploy 12 separate Homunculus processes
- Each process: ~50MB RAM + 1 Discord connection
- Configuration overhead: 12 config files to manage

### Target Architecture (v0.2.0)

```
Homunculus Instance (multi-channel)
├── config.json
│   └── channels: [
│       {channel_id: A, character: "Kovach", namespace: "kovach"},
│       {channel_id: B, character: "John", namespace: "john"}
│   ]
├── Character Cards (multiple)
└── QMD Memory (~/.homunculus/agents/<bot_name>/)
    ├── kovach/ → memory + qmd
    └── john/ → memory + qmd
```

**Benefits**:
- 3 bot instances → support 12 NPCs (3 campaigns × 4 players)
- Single Discord connection per bot
- Centralized configuration
- ~150MB total vs ~600MB (12 processes)

---

## Technical Specification

### 1. Configuration Schema

#### Before (v0.1.0)
```json
{
  "discord": {
    "channel_id": 1471514033478828123,
    "bot_token_env": "KOVACH_DISCORD_BOT_TOKEN"
  },
  "agent": {
    "npc_name": "kovach",
    "character_card_path": "./examples/kovach/character-card.json",
    "skill_ruleset": "coc7e"
  }
}
```

#### After (v0.2.0)
```json
{
  "discord": {
    "bot_token_env": "HOMUNCULUS_BOT_TOKEN",
    "channels": [
      {
        "channel_id": 1471514033478828123,
        "channel_name": "game-table-campaign-1",
        "character_card_path": "./examples/kovach/character-card.json",
        "memory_namespace": "kovach",
        "skill_ruleset": "coc7e"
      },
      {
        "channel_id": 9999999999999999,
        "channel_name": "game-table-campaign-2",
        "character_card_path": "./examples/john/character-card.json",
        "memory_namespace": "john",
        "skill_ruleset": "coc7e"
      }
    ]
  },
  "agent": {
    "bot_name": "multi-npc-bot"
  },
  "model": { ... },
  "memory": { ... },
  "runtime": { ... }
}
```

**Backward Compatibility**: Support old single-channel config by auto-converting:
```python
if "channel_id" in config.discord:
    # Convert to new format internally
    config.discord.channels = [{
        "channel_id": config.discord.channel_id,
        "character_card_path": config.agent.character_card_path,
        "memory_namespace": config.agent.npc_name,
        "skill_ruleset": config.agent.skill_ruleset
    }]
```

---

### 2. Directory Structure Changes

#### Current
```
~/.homunculus/
└── agents/
    └── kovach/
        ├── memory/
        │   └── MEMORY.md
        └── qmd/
            ├── xdg-config/
            └── xdg-cache/
```

#### Target
```
~/.homunculus/
└── agents/
    └── multi-npc-bot/              # bot_name from config
        ├── kovach/                 # memory_namespace
        │   ├── memory/
        │   │   └── MEMORY.md
        │   └── qmd/
        │       ├── xdg-config/
        │       └── xdg-cache/
        └── john/                   # another namespace
            ├── memory/
            └── qmd/
```

---

### 3. Code Changes

#### 3.1 Configuration (`src/homunculus/config/settings.py`)

**Add new schema**:
```python
@dataclass(frozen=True)
class ChannelSettings:
    channel_id: int
    channel_name: str = ""
    character_card_path: Path
    memory_namespace: str
    skill_ruleset: str = "coc7e"

@dataclass(frozen=True)
class DiscordSettings:
    bot_token_env: str = "DISCORD_BOT_TOKEN"
    channels: Tuple[ChannelSettings, ...]  # NEW: list of channels
    history_size: int = 25
```

**Migration helper**:
```python
def migrate_legacy_config(config: dict) -> dict:
    """Convert v0.1.0 single-channel config to v0.2.0 format."""
    if "channel_id" in config.get("discord", {}):
        # Old format detected
        discord = config["discord"]
        agent = config["agent"]
        config["discord"]["channels"] = [{
            "channel_id": discord["channel_id"],
            "character_card_path": agent["character_card_path"],
            "memory_namespace": agent.get("npc_name", "default"),
            "skill_ruleset": agent.get("skill_ruleset", "coc7e")
        }]
        del config["discord"]["channel_id"]
    return config
```

---

#### 3.2 Runtime Factory (`src/homunculus/runtime/factory.py`)

**Current**:
```python
async def create_discord_service(settings):
    character_card = load_character_card(settings.agent.character_card_path)
    # ... single character setup
```

**Target**:
```python
async def create_discord_service(settings):
    # Load all character cards upfront
    channel_configs = {}
    for ch_config in settings.discord.channels:
        character = load_character_card(ch_config.character_card_path)
        memory = create_memory_adapter(ch_config.memory_namespace, settings)
        channel_configs[ch_config.channel_id] = {
            "character": character,
            "memory": memory,
            "skill_ruleset": ch_config.skill_ruleset,
            "namespace": ch_config.memory_namespace
        }
    
    # Pass channel_configs to message handler
    message_handler = MultiChannelMessageHandler(
        channel_configs=channel_configs,
        pipeline_factory=pipeline_factory,
        logger=logger
    )
    
    # Discord client monitors ALL channels
    channel_ids = [ch.channel_id for ch in settings.discord.channels]
    discord_service = DiscordClientService(
        bot_token=bot_token,
        target_channel_ids=channel_ids,  # NEW: list instead of single ID
        on_message_handler=message_handler,
        ...
    )
    return discord_service
```

---

#### 3.3 Discord Client (`src/homunculus/discord/client.py`)

**Key Changes**:

1. **Monitor multiple channels**:
```python
class DiscordClientService:
    def __init__(self, target_channel_ids: Sequence[int], ...):
        self._target_channel_ids = set(target_channel_ids)  # Set for fast lookup
        self._target_channels: Dict[int, discord.TextChannel] = {}
```

2. **Channel filtering in on_message**:
```python
async def _on_message(self, message: discord.Message):
    # Only process messages from configured channels
    if message.channel.id not in self._target_channel_ids:
        return
    
    # Route to handler with channel_id
    await self._handler.handle(
        message=internal_message,
        channel_id=message.channel.id,  # NEW: pass channel_id
        history_provider=history_provider,
        sender=sender
    )
```

---

#### 3.4 Message Handler (`src/homunculus/discord/message_handler.py`)

**Create new handler**: `MultiChannelMessageHandler`

```python
class MultiChannelMessageHandler:
    def __init__(
        self,
        channel_configs: Dict[int, ChannelConfig],  # channel_id → config
        pipeline_factory: Callable,
        logger: Optional[logging.Logger] = None
    ):
        self._configs = channel_configs
        self._pipeline_factory = pipeline_factory
        self._pipelines: Dict[int, ResponsePipeline] = {}
        self._logger = logger or logging.getLogger("homunculus.multi_handler")
        
        # Create a pipeline per channel
        for channel_id, config in channel_configs.items():
            self._pipelines[channel_id] = pipeline_factory(
                character_card=config["character"],
                memory_retriever=config["memory"],
                skill_ruleset=config["skill_ruleset"]
            )
    
    async def handle(
        self,
        message: MessageLike,
        channel_id: int,
        history_provider: DiscordHistoryProvider,
        sender: ChannelSender
    ):
        # Route to correct pipeline
        if channel_id not in self._pipelines:
            self._logger.warning(f"Unknown channel {channel_id}, ignoring")
            return
        
        pipeline = self._pipelines[channel_id]
        config = self._configs[channel_id]
        
        # Add checkmark + typing indicator
        message_id = getattr(message, "message_id", None)
        if message_id:
            await sender.add_reaction(message_id, "✅")
        await sender.start_typing()
        
        try:
            outcome = await pipeline.on_message(
                message=message,
                history_provider=history_provider,
                sender=sender,
                character_card=config["character"],
                skill_ruleset=config["skill_ruleset"],
                npc_name=config["namespace"]  # Use namespace as npc_name
            )
            # ... handle outcome
        finally:
            await sender.stop_typing()
```

---

#### 3.5 Memory Adapter (`src/homunculus/memory/qmd_adapter.py`)

**Add namespace support**:

```python
class QmdAdapter:
    def __init__(
        self,
        settings: AppSettings,
        namespace: str = "default",  # NEW: namespace parameter
        logger: Optional[logging.Logger] = None,
        ...
    ):
        self._settings = settings
        self._namespace = namespace
        self._logger = logger
    
    def _build_env(self, npc_name: str) -> Mapping[str, str]:
        # Use bot_name + namespace for isolation
        bot_name = self._settings.agent.bot_name
        qmd_root = self._settings.runtime.data_home / "agents" / bot_name / self._namespace / "qmd"
        env = dict(self._environ)
        env["XDG_CONFIG_HOME"] = str(qmd_root / "xdg-config")
        env["XDG_CACHE_HOME"] = str(qmd_root / "xdg-cache")
        return env
```

**Memory Scheduler** (`memory/scheduler.py`):
```python
class QmdIndexScheduler:
    def __init__(self, settings: AppSettings, namespace: str, ...):
        self._namespace = namespace
        # ... same pattern
```

---

### 4. Bootstrap & Migration

**On startup**, check directory structure:
```python
def bootstrap_multi_channel(settings: AppSettings):
    """Create directory structure for all namespaces."""
    bot_name = settings.agent.bot_name
    base_dir = settings.runtime.data_home / "agents" / bot_name
    
    for ch_config in settings.discord.channels:
        namespace_dir = base_dir / ch_config.memory_namespace
        (namespace_dir / "memory").mkdir(parents=True, exist_ok=True)
        (namespace_dir / "qmd" / "xdg-config").mkdir(parents=True, exist_ok=True)
        (namespace_dir / "qmd" / "xdg-cache").mkdir(parents=True, exist_ok=True)
        
        memory_file = namespace_dir / "memory" / "MEMORY.md"
        if not memory_file.exists():
            memory_file.write_text(f"# {ch_config.memory_namespace} Memory\n\nCreated at {datetime.now()}\n")
```

---

## Implementation Plan

### Phase 1: Configuration (Day 1)
- [ ] Update `config/settings.py` with new schema
- [ ] Add `ChannelSettings` dataclass
- [ ] Update `DiscordSettings` to support both old and new format
- [ ] Write `migrate_legacy_config()` function
- [ ] Write unit tests for config parsing

**Files to modify**:
- `src/homunculus/config/settings.py`
- `tests/unit/test_config.py` (new)

**Acceptance**:
- Both old and new config formats parse correctly
- Migration function produces valid new format
- All tests pass

---

### Phase 2: Multi-Channel Client (Day 2)
- [ ] Modify `DiscordClientService` to accept `List[int]` channel IDs
- [ ] Update `_on_ready()` to fetch all target channels
- [ ] Update `_on_message()` to filter by channel set
- [ ] Pass `channel_id` to message handler
- [ ] Write integration tests

**Files to modify**:
- `src/homunculus/discord/client.py`
- `tests/integration/test_discord_client.py` (new)

**Acceptance**:
- Bot connects to multiple channels
- Messages from non-configured channels are ignored
- `channel_id` is correctly passed to handler

---

### Phase 3: Multi-Channel Handler (Day 3)
- [ ] Create `MultiChannelMessageHandler` class
- [ ] Implement channel → pipeline routing
- [ ] Load multiple character cards
- [ ] Create pipeline per channel
- [ ] Handle unknown channels gracefully
- [ ] Write unit tests

**Files to modify**:
- `src/homunculus/discord/message_handler.py`
- `tests/unit/test_multi_handler.py` (new)

**Acceptance**:
- Each channel uses correct character card
- Pipelines are isolated (no cross-talk)
- Unknown channels log warning and return

---

### Phase 4: Memory Isolation (Day 4)
- [ ] Add `namespace` parameter to `QmdAdapter`
- [ ] Update `_build_env()` to use `bot_name/namespace/qmd`
- [ ] Add `namespace` to `QmdIndexScheduler`
- [ ] Update `runtime/factory.py` to create namespace-specific adapters
- [ ] Write directory bootstrap logic
- [ ] Write integration tests

**Files to modify**:
- `src/homunculus/memory/qmd_adapter.py`
- `src/homunculus/memory/scheduler.py`
- `src/homunculus/runtime/factory.py`
- `tests/integration/test_memory_isolation.py` (new)

**Acceptance**:
- QMD indices are separate per namespace
- Memory queries don't leak between channels
- Directory structure is created automatically

---

### Phase 5: Integration & Testing (Day 5)
- [ ] End-to-end test: 2 channels, 2 characters
- [ ] Verify memory isolation (query one, shouldn't see other's data)
- [ ] Verify conversation history isolation
- [ ] Load test: send messages to both channels simultaneously
- [ ] Edge cases: unknown channel, missing character card, corrupted config

**Files to modify**:
- `tests/e2e/test_multi_channel.py` (new)
- `examples/multi-channel/` (new example configs)

**Acceptance**:
- All tests pass
- No memory leaks
- No race conditions
- Error handling is graceful

---

### Phase 6: Documentation (Day 6)
- [ ] Update `README.md` with multi-channel setup
- [ ] Write migration guide (v0.1.0 → v0.2.0)
- [ ] Create example configs
- [ ] Update `OPERATIONS.md`
- [ ] Write architecture doc (multi-channel internals)

**Files to create/update**:
- `README.md`
- `docs/MIGRATION_v0.2.0.md`
- `examples/multi-channel/config.json`
- `examples/multi-channel/kovach/character-card.json`
- `examples/multi-channel/john/character-card.json`
- `OPERATIONS.md`

**Acceptance**:
- User can follow migration guide successfully
- Example configs work out-of-box
- All features documented

---

## Testing Plan

### Unit Tests
```python
# tests/unit/test_config.py
def test_parse_multi_channel_config():
    config = {...}  # multi-channel format
    settings = load_settings(config)
    assert len(settings.discord.channels) == 2

def test_migrate_legacy_config():
    old_config = {...}  # v0.1.0 format
    new_config = migrate_legacy_config(old_config)
    assert "channels" in new_config["discord"]

# tests/unit/test_multi_handler.py
def test_route_to_correct_pipeline():
    handler = MultiChannelMessageHandler(channel_configs)
    # Mock message from channel A
    # Assert pipeline A is called, not pipeline B
```

### Integration Tests
```python
# tests/integration/test_memory_isolation.py
async def test_qmd_namespaces_isolated():
    adapter_a = QmdAdapter(settings, namespace="kovach")
    adapter_b = QmdAdapter(settings, namespace="john")
    
    # Store data in A
    # Query from B
    # Assert no results
```

### End-to-End Tests
```python
# tests/e2e/test_multi_channel.py
async def test_simultaneous_messages():
    # Send message to channel A: "@bot hello"
    # Send message to channel B: "@bot goodbye"
    # Assert channel A gets response from character A
    # Assert channel B gets response from character B
    # Assert no cross-talk
```

---

## Risk Analysis

### High Risk
1. **Memory Leaks**: Multiple pipelines/adapters in one process
   - **Mitigation**: Careful resource management, weak references, explicit cleanup
   
2. **Race Conditions**: Simultaneous messages from different channels
   - **Mitigation**: Each pipeline has independent state, no shared mutable state

3. **QMD Index Corruption**: Multiple adapters writing to different indices
   - **Mitigation**: Each namespace has separate `xdg-cache` directory

### Medium Risk
4. **Configuration Complexity**: Users might misconfigure namespaces
   - **Mitigation**: Clear documentation, validation, helpful error messages

5. **Backward Compatibility**: Breaking v0.1.0 users
   - **Mitigation**: Auto-migration, keep supporting old format

### Low Risk
6. **Discord API Rate Limits**: More channels = more messages
   - **Mitigation**: Single connection, shared rate limiter

---

## Non-Goals (Out of Scope for v0.2.0)

- ❌ Cross-channel memory sharing
- ❌ Dynamic channel addition (without restart)
- ❌ Character switching within a channel
- ❌ Web UI for configuration
- ❌ Multiple bot tokens (still 1 token per instance)

---

## Acceptance Criteria

### Functional
- [ ] Single Homunculus instance handles ≥2 Discord channels
- [ ] Each channel has independent character identity
- [ ] Memory is completely isolated (QMD queries don't leak)
- [ ] Conversation history is isolated
- [ ] Old single-channel configs still work (backward compatible)

### Performance
- [ ] Memory overhead: <100MB per additional channel
- [ ] Response latency: <10% increase vs single-channel
- [ ] No memory leaks after 1000 messages across channels

### Quality
- [ ] ≥80% code coverage for new/modified code
- [ ] All integration tests pass
- [ ] Documentation complete and accurate
- [ ] Migration guide validated with real v0.1.0 config

---

## Example Configs

### Example 1: Multi-Campaign Setup
```json
{
  "agent": {
    "bot_name": "npc-bot-1"
  },
  "discord": {
    "bot_token_env": "HOMUNCULUS_BOT_TOKEN",
    "channels": [
      {
        "channel_id": 1471514033478828123,
        "channel_name": "edge-of-darkness",
        "character_card_path": "./characters/kovach.json",
        "memory_namespace": "kovach-eod",
        "skill_ruleset": "coc7e"
      },
      {
        "channel_id": 9999999999999999,
        "channel_name": "masks-of-nyarlathotep",
        "character_card_path": "./characters/kovach-nyc.json",
        "memory_namespace": "kovach-masks",
        "skill_ruleset": "coc7e"
      }
    ]
  },
  "model": {
    "provider": "openclaw",
    "agent_id": "homunculus",
    "name": "claude-haiku-4-5"
  },
  "memory": {
    "qmd_binary": "/home/joexu/.cache/.bun/bin/qmd",
    "top_k": 10
  },
  "runtime": {
    "log_level": "INFO",
    "data_home": "~/.homunculus"
  }
}
```

**Result**: Same "Kovach" character in 2 campaigns, completely isolated memories.

---

### Example 2: Different Characters
```json
{
  "discord": {
    "bot_token_env": "HOMUNCULUS_BOT_TOKEN",
    "channels": [
      {
        "channel_id": 1111111111111111,
        "character_card_path": "./characters/kovach.json",
        "memory_namespace": "kovach"
      },
      {
        "channel_id": 2222222222222222,
        "character_card_path": "./characters/emily.json",
        "memory_namespace": "emily"
      },
      {
        "channel_id": 3333333333333333,
        "character_card_path": "./characters/john.json",
        "memory_namespace": "john"
      }
    ]
  }
}
```

**Result**: 1 bot, 3 different NPCs, 3 campaigns.

---

## Migration Guide (Quick Reference)

### Step 1: Update Config
**Old**:
```json
{
  "discord": {
    "channel_id": 1471514033478828123
  },
  "agent": {
    "npc_name": "kovach",
    "character_card_path": "./examples/kovach/character-card.json"
  }
}
```

**New**:
```json
{
  "agent": {
    "bot_name": "kovach-bot"
  },
  "discord": {
    "channels": [{
      "channel_id": 1471514033478828123,
      "character_card_path": "./examples/kovach/character-card.json",
      "memory_namespace": "kovach"
    }]
  }
}
```

### Step 2: Update Directory
```bash
# Old location
~/.homunculus/agents/kovach/

# New location (auto-created on v0.2.0 startup)
~/.homunculus/agents/kovach-bot/kovach/

# Migrate data (if needed)
mv ~/.homunculus/agents/kovach/ ~/.homunculus/agents/kovach-bot/kovach/
```

### Step 3: Restart
```bash
cd /home/joexu/Repos/Homunculus
./RESTART.sh
```

**Or**: Keep old config format, v0.2.0 will auto-migrate internally (no action needed).

---

## Questions for Implementer

1. **Preferred test framework**: pytest or unittest?
2. **Logging strategy**: One logger per channel or unified?
3. **Error handling**: Fail entire bot if one channel config is invalid, or skip that channel?
4. **Hot reload**: Should config changes require restart, or support live reload?

---

## References

- **Current codebase**: `/home/joexu/Repos/Homunculus`
- **v0.1.0 docs**: `README.md`, `OPERATIONS.md`, `docs/`
- **Character card schema**: `src/homunculus/character_card.py`
- **Config schema**: `src/homunculus/config/settings.py`
- **QMD integration**: `src/homunculus/memory/qmd_adapter.py`

---

## Contact

For questions or clarifications:
- **Product Owner**: Joe (@Noir)
- **Architecture**: See `docs/OPENCLAW_INTEGRATION.md`, `docs/SECURITY_ISOLATION.md`

---

**STATUS**: Ready for implementation  
**SIGN-OFF**: Pending developer assignment

