# Homunculus Quick Start Guide

Get your first NPC bot running in Discord in 5 minutes.

## Prerequisites

- Python 3.9+
- A Discord bot token ([create one here](https://discord.com/developers/applications))
- Anthropic API key ([get one here](https://console.anthropic.com/))
- QMD CLI ([install guide](https://github.com/qmd-project/qmd))

## Step 1: Install Homunculus

```bash
cd /path/to/Homunculus
pip install -e .
```

This installs `discord.py` and makes the `homunculus` command available.

## Step 2: Set Up Environment Variables

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export KOVACH_DISCORD_BOT_TOKEN="YOUR_DISCORD_BOT_TOKEN"
```

**Note:** Each NPC needs its own Discord bot account and token.

## Step 3: Configure Your NPC

Edit `examples/kovach/config.json`:

1. Set `discord.channel_id` to your target Discord channel ID
2. (Optional) Customize `character-card.json` for your NPC

**How to get channel ID:**
- Enable Developer Mode in Discord (Settings → Advanced)
- Right-click the channel → Copy ID

## Step 4: Bootstrap Agent Directory

```bash
python scripts/bootstrap-agents.py kovach
```

This creates:
```
~/.homunculus/agents/kovach/
├── qmd/             # Memory index state
├── memory/          # Daily markdown logs
└── archive/         # Old identity backups
```

## Step 5: Test Configuration

```bash
homunculus --check --config examples/kovach/config.json
```

You should see:
```
✓ Configuration valid
✓ Character card loaded: 科瓦奇
✓ Discord bot token resolved
✓ QMD binary found: qmd
```

## Step 6: Run!

```bash
homunculus --config examples/kovach/config.json
```

Expected output:
```
INFO homunculus.runtime Loading character card from ./examples/kovach/character-card.json
INFO homunculus.discord.client Discord client connected as YourBotName#1234
INFO homunculus.discord.client Target channel acquired: your-channel-name
INFO homunculus.runtime Runtime started for NPC 'kovach' (channel_id=123456...)
INFO homunculus.memory.scheduler QMD index scheduler started in background.
```

## Step 7: Test In Discord

In your target channel, @mention the bot:

```
@科瓦奇 你今天有什么新货？
```

The bot should respond in-character as 科瓦奇.

## Troubleshooting

### "discord.py not installed"
```bash
pip install discord.py
```

### "Target channel not found"
- Verify `discord.channel_id` in config.json
- Make sure the bot has been invited to your server with `View Channels` and `Send Messages` permissions

### "QMD binary not found"
```bash
# Install QMD first
curl -fsSL https://qmd.sh/install.sh | bash
```

### "Bot doesn't respond to mentions"
- Check that the bot has `Message Content Intent` enabled in Discord Developer Portal
- Verify the bot is online (green dot in member list)
- Check logs for errors

## Next Steps

- **Multiple NPCs:** Copy `examples/kovach/` → `examples/eliza/`, adjust config, run in parallel
- **Memory Review:** `cat ~/.homunculus/agents/kovach/memory/*.md`
- **Hot-Swap:** Use `/npc swap <new-card-path>` to change NPC identity mid-session
- **Custom Rules:** Add excerpts to `src/homunculus/skills/excerpts/` for different game systems

## Production Deployment

See `docs/ops/runtime-packaging.md` for Docker Compose and systemd setup.

---

**Need help?** Check the main README or open an issue on GitHub.
