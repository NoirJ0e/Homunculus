# Deployment Guide

## Quick Setup

1. **Copy configuration templates**
   ```bash
   cp START.sh.example START.sh
   cp examples/kovach/config.json.example examples/kovach/config.json
   ```

2. **Edit START.sh with your credentials**
   ```bash
   export KOVACH_DISCORD_BOT_TOKEN="your_discord_bot_token"
   export ANTHROPIC_API_KEY="your_anthropic_api_key"
   ```

3. **Edit config.json**
   - Set `discord.channel_id` to your target Discord channel ID
   - (Optional) Adjust `memory.qmd_binary` path if needed

4. **Install dependencies**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install discord.py
   ```

5. **Run**
   ```bash
   ./START.sh
   ```

## Security Notes

- **Never commit START.sh** - it contains secrets
- **Never commit examples/*/config.json** - contains channel IDs
- Use `.example` files as templates
- `.gitignore` is configured to protect sensitive files

## Getting Credentials

### Discord Bot Token
1. https://discord.com/developers/applications
2. Create New Application → Bot → Reset Token
3. Enable **Message Content Intent** (required!)
4. Invite bot to server with permissions: Send Messages, Read Message History

### Anthropic API Key
1. https://console.anthropic.com/
2. Settings → API Keys → Create Key
3. **Note**: Standard API key (`sk-ant-api...`) required, OAuth tokens won't work

For more details, see `docs/QUICKSTART.md`
