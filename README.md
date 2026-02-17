# Homunculus 🎭

> **Autonomous Discord NPC Agent for TTRPG Games**
> 
> Standalone Discord bot runtime for roleplay characters with memory, skill rules, and LLM-powered responses.

## Features

- 🎲 **TTRPG Character System** - Call of Cthulhu 7e support with skill checks
- 🧠 **Persistent Memory** - QMD-based semantic memory for character continuity
- 💬 **Discord Integration** - Mention-triggered responses with typing indicators
- 🔗 **OpenClaw Integration** - Reuse OpenClaw's LLM access without separate API keys
- 🛡️ **Tool Isolation** - Pure LLM mode for security (no filesystem/exec access)
- ⚙️ **Hot-swappable Characters** - JSON-based character cards

## Architecture

```
Discord Message (@mention)
    ↓
Homunculus (Character Logic + Memory)
    ↓
OpenClaw HTTP API (Agent: homunculus)
    ↓
Claude via OAuth (claude-haiku-4-5)
```

**Key Design:**
- Homunculus handles character personality, skills, and memory
- OpenClaw provides LLM access (shared OAuth token)
- Complete workspace isolation (no tool access)
- Independent QMD memory index per character

## Prerequisites

- Python 3.11+
- [OpenClaw](https://github.com/openclaw/openclaw) running locally
- Discord bot token
- OpenClaw gateway token

## Quick Start

### 1. Install Dependencies

```bash
# Clone repository
git clone <your-repo-url>
cd Homunculus

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install discord.py
```

### 2. Configure OpenClaw

Add a dedicated agent for Homunculus:

```bash
openclaw config patch
```

Add this to your OpenClaw config:

```json
{
  "agents": {
    "list": [
      {
        "id": "homunculus",
        "name": "Homunculus (NPC Runtime - No Tools)",
        "workspace": "/tmp/homunculus-isolated",
        "model": "anthropic/claude-haiku-4-5",
        "tools": {
          "deny": [
            "group:runtime",
            "group:fs",
            "group:sessions",
            "group:memory",
            "group:ui",
            "group:messaging",
            "web_search",
            "web_fetch",
            "image",
            "tts"
          ]
        }
      }
    ]
  },
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
```

### 3. Configure Credentials

```bash
# Copy example startup script
cp START.sh.example START.sh

# Edit and add your tokens
nano START.sh
```

Required credentials:
- `KOVACH_DISCORD_BOT_TOKEN` - Discord bot token
- `OPENCLAW_GATEWAY_TOKEN` - Get from `~/.openclaw/openclaw.json`

### 4. Configure Character

Edit `examples/kovach/config.json`:

```json
{
  "agent": {
    "npc_name": "科瓦奇",
    "bot_name": "kovach-bot",
    "character_card_path": "./examples/kovach/character-card.json",
    "qmd_index": "kovach",
    "skill_ruleset": "coc7e"
  },
  "discord": {
    "channels": [
      {
        "channel_id": YOUR_CHANNEL_ID,
        "channel_name": "campaign-1",
        "character_card_path": "./examples/kovach/character-card.json",
        "memory_namespace": "kovach",
        "skill_ruleset": "coc7e"
      }
    ],
    "bot_token_env": "KOVACH_DISCORD_BOT_TOKEN"
  },
  "model": {
    "provider": "openclaw",
    "name": "claude-haiku-4-5",
    "api_key_env": "OPENCLAW_GATEWAY_TOKEN",
    "base_url": "http://127.0.0.1:18789/v1",
    "agent_id": "homunculus"
  }
}
```

### 5. Start the Bot

```bash
./START.sh
```

Expected output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Homunculus - TTRPG NPC Agent
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NPC: 科瓦奇 (Kovach)
  Channel: 1472783663077785722
  Model: claude-haiku-4-5 (via OpenClaw agent: homunculus)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Discord client ready: bot_user_id=... target_channel_ids=[...]
✅ Runtime started for bot 'kovach-bot'
```

## Usage

### Trigger NPC Response

In Discord channel, @mention the bot:
```
@TTRPG_NPC_1 你好，科瓦奇。这附近安全吗？
```

Bot will:
1. ✅ Add checkmark reaction (acknowledged)
2. ⌨️ Show "typing..." indicator
3. 💬 Reply in character

### Operations

**Check status:**
```bash
./STATUS.sh
```

**Restart (with cleanup):**
```bash
./RESTART.sh
```

**Stop:**
```bash
pkill -f "python3 -m homunculus"
```

## Character Cards

Create custom NPCs by editing `character-card.json`:

```json
{
  "name": "角色名",
  "description": "外貌描述",
  "personality": "性格特点",
  "background": "背景故事",
  "stats": {
    "STR": 65,
    "CON": 70,
    ...
  },
  "skills": {
    "射击": 65,
    "格斗": 60,
    ...
  },
  "inventory": [
    "物品1",
    "物品2"
  ]
}
```

## Memory System

Homunculus uses QMD for persistent memory:

**Location:** `~/.homunculus/agents/<npc_name>/`
- `memory/MEMORY.md` - Long-term character memories
- `memory/YYYY-MM-DD.md` - Daily interaction logs
- `qmd/` - QMD index and embeddings

**Auto-updates:** Every 5 minutes (configurable)

**Manual update:**
```bash
cd ~/.homunculus/agents/kovach
XDG_CACHE_HOME=qmd/xdg-cache qmd update
XDG_CACHE_HOME=qmd/xdg-cache qmd embed
```

## Skill Rules

Supported rulesets (in `src/homunculus/skills/excerpts/`):
- **coc7e** - Call of Cthulhu 7th Edition

Add custom rulesets by creating `<ruleset>.md` in excerpts directory.

## Model Selection

Configure via `agent_id` in config:

```json
{
  "model": {
    "agent_id": "homunculus",  // Uses claude-haiku-4-5
    "name": "claude-haiku-4-5"
  }
}
```

Available OpenClaw agents (configured separately):
- `homunculus` - Haiku 4.5 (fast, cheap)
- `main` - Sonnet 4.5 (balanced)
- `coc-keeper` - Opus 4.6 (powerful)

See [MODEL_SELECTION.md](examples/MODEL_SELECTION.md) for details.

## Security

### Tool Isolation

Homunculus agent has **all tools disabled**:
- ❌ No filesystem access
- ❌ No command execution
- ❌ No session management
- ✅ Only pure LLM inference

See [SECURITY_ISOLATION.md](docs/SECURITY_ISOLATION.md).

### Credential Management

- All tokens in environment variables (not in code)
- `START.sh` is gitignored
- Use `START.sh.example` as template

## Troubleshooting

### Bot not responding

```bash
./RESTART.sh
```

### Multiple processes running

```bash
ps aux | grep homunculus | grep -v grep
./RESTART.sh  # Cleans up zombies
```

### Memory not updating

```bash
cd ~/.homunculus/agents/kovach
XDG_CACHE_HOME=qmd/xdg-cache qmd status
XDG_CACHE_HOME=qmd/xdg-cache qmd update
```

### OpenClaw connection failed

```bash
# Check OpenClaw is running
openclaw status

# Verify agent exists
openclaw agents list | grep homunculus

# Test HTTP endpoint
curl -sS http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "x-openclaw-agent-id: homunculus" \
  -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"test"}]}'
```

See [OPERATIONS.md](OPERATIONS.md) for full troubleshooting guide.

## Project Structure

```
Homunculus/
├── src/homunculus/
│   ├── agent/           # Hot-swap system (future)
│   ├── character_card.py # Character JSON loader
│   ├── config/          # Settings management
│   ├── discord/         # Discord.py integration
│   ├── llm/             # LLM client adapters
│   ├── memory/          # QMD integration
│   ├── pipeline/        # Response generation pipeline
│   ├── prompt/          # Prompt building
│   ├── skills/          # Ruleset excerpts
│   └── runtime/         # System assembly
├── examples/
│   └── kovach/          # Example NPC (Kovach)
│       ├── character-card.json
│       └── config.json
├── docs/
│   ├── OPERATIONS.md
│   ├── SECURITY_ISOLATION.md
│   └── OPENCLAW_INTEGRATION.md
├── START.sh.example     # Startup script template
├── STATUS.sh            # Health check script
└── RESTART.sh           # Restart with cleanup
```

## Development

### Running Tests

```bash
# (Tests not yet implemented)
pytest
```

### Adding a New Skill Ruleset

1. Create `src/homunculus/skills/excerpts/<ruleset>.md`
2. Add to `_SUPPORTED_RULESETS` in `skills/excerpts.py`
3. Update character config: `"skill_ruleset": "<ruleset>"`

### Adding New NPC

1. Copy `examples/kovach/` to `examples/<new_npc>/`
2. Edit `character-card.json` and `config.json`
3. Update `START.sh` to use new config path

## Performance

**Response Time:**
- Haiku-4-5: 1-3 seconds
- Sonnet-4-5: 2-5 seconds
- Opus-4-6: 3-8 seconds

**Memory:**
- Base: ~50 MB
- With QMD: +3-5 MB per character

**Cost (via OpenClaw OAuth):**
- Shared with OpenClaw usage
- Haiku: ~$0.0001 per response
- Sonnet: ~$0.001 per response
- Opus: ~$0.005 per response

## Roadmap

- [ ] Systemd service for auto-restart
- [ ] Discord slash commands (/roll, /status)
- [ ] Multi-character support (multiple bots)
- [ ] Webhook logging (errors to Telegram)
- [ ] Web dashboard for character management
- [ ] Voice channel integration

## Credits

- Built by another Agent (predecessor of this implementation)
- Integrated with [OpenClaw](https://github.com/openclaw/openclaw)
- Uses [discord.py](https://github.com/Rapptz/discord.py)
- Memory powered by [QMD](https://github.com/openclaw/qmd)

## License

*(Add your license here)*

## Contributing

*(Add contribution guidelines here)*
