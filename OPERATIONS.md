# Homunculus Operations Guide

## Quick Commands

### Start Homunculus
```bash
./START.sh
```

### Check Status
```bash
./STATUS.sh
```

Expected output when running:
```
✅ Homunculus is running
joexu     908126  0.4  0.1 204828 50308 pts/0    Sl+  18:43   0:00 python3 -m homunculus ...
```

### Restart (with cleanup)
```bash
./RESTART.sh
```

This will:
1. Find and kill any existing Homunculus processes
2. Start a fresh instance

Use this if:
- Bot is not responding
- You see "zombie" processes
- After config changes

### Stop Homunculus
```bash
pkill -f "python3 -m homunculus"
```

## Troubleshooting

### Bot shows online but doesn't respond

**Symptoms:**
- Discord shows bot as online
- @mentions don't get any reaction
- No typing indicator

**Solution:**
```bash
./RESTART.sh
```

**Why this happens:**
- Process was killed (signal 9)
- Old zombie process still holds connection
- Event loop crashed

### Multiple processes running

**Check:**
```bash
ps aux | grep homunculus | grep -v grep
```

**Clean up:**
```bash
./RESTART.sh
```

### Bot connects but crashes immediately

**Check logs:**
```bash
# If started with START.sh, logs are in terminal
# Look for errors like:
# - "Failed to add reaction"
# - "OpenClaw request failed"
# - "QMD timeout"
```

**Common issues:**
1. **OpenClaw gateway not running**
   ```bash
   openclaw status
   ```
   
2. **Wrong agent_id in config**
   ```bash
   openclaw agents list | grep homunculus
   ```
   
3. **Discord token expired**
   - Check `KOVACH_DISCORD_BOT_TOKEN` in START.sh

### QMD Memory not updating

**Check status:**
```bash
cd ~/.homunculus/agents/kovach
XDG_CACHE_HOME=qmd/xdg-cache /home/joexu/.cache/.bun/bin/qmd status
```

**Manual update:**
```bash
cd ~/.homunculus/agents/kovach
XDG_CACHE_HOME=qmd/xdg-cache /home/joexu/.cache/.bun/bin/qmd update
XDG_CACHE_HOME=qmd/xdg-cache /home/joexu/.cache/.bun/bin/qmd embed
```

## Monitoring

### Watch for crashes

Create a simple systemd service or cronjob to auto-restart:

```bash
# Add to crontab (every 5 minutes)
*/5 * * * * cd /home/joexu/Repos/Homunculus && ./STATUS.sh || ./RESTART.sh
```

### Check OpenClaw sessions

```bash
openclaw sessions list | grep homunculus
```

This shows all active LLM requests from Homunculus.

### View memory usage

```bash
ps aux | grep homunculus | grep -v grep | awk '{print $4}'
```

Typical: 0.1% - 0.5% of RAM

## Configuration

### Change model

Edit `examples/kovach/config.json`:
```json
{
  "model": {
    "agent_id": "homunculus",
    "name": "claude-haiku-4-5"  // or opus-4-6, sonnet-4-5
  }
}
```

Then restart:
```bash
./RESTART.sh
```

### Change NPC character

Edit `examples/kovach/character-card.json` and restart.

### Change Discord channel

Edit `examples/kovach/config.json`:
```json
{
  "discord": {
    "channel_id": 1472783663077785722  // new channel ID
  }
}
```

## Logs

Logs are printed to stdout when using `START.sh`.

To save logs:
```bash
./START.sh 2>&1 | tee homunculus.log
```

Or run in background:
```bash
nohup ./START.sh > homunculus.log 2>&1 &
```

## Performance

### Typical response time
- **Haiku-4-5**: 1-3 seconds
- **Sonnet-4-5**: 2-5 seconds  
- **Opus-4-6**: 3-8 seconds

### Memory overhead
- Base: ~50 MB
- With QMD: +3-5 MB
- Per Discord connection: +1 MB

### QMD index updates
- Every 5 minutes (configurable in config.json)
- Only updates if memory files changed
- Embedding: ~1-2 seconds per file
