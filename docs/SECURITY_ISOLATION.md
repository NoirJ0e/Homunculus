# Security & Isolation

## Problem: Workspace Access via HTTP API

When Homunculus calls OpenClaw's HTTP API, by default it inherits the agent's tool permissions. This means:

❌ **Bad**: LLM can read/write files in OpenClaw's workspace  
❌ **Bad**: LLM can execute commands  
❌ **Bad**: Cross-contamination of data between OpenClaw and Homunculus

## Solution: Dedicated LLM-only Agent

Create an OpenClaw agent with **all tools disabled**:

```json
{
  "agents": {
    "list": [
      {
        "id": "llm-only",
        "name": "LLM-only (for external APIs)",
        "workspace": "/tmp/llm-only-isolated",
        "model": "anthropic/claude-sonnet-4-5",
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
  }
}
```

### Tool Groups

- `group:runtime`: exec, bash, process
- `group:fs`: read, write, edit, apply_patch
- `group:sessions`: sessions_list, sessions_history, sessions_send, sessions_spawn, session_status
- `group:memory`: memory_search, memory_get
- `group:ui`: browser, canvas
- `group:messaging`: telegram, whatsapp, discord, etc.

### Apply Config

```bash
openclaw config patch < config.json
```

### Update Homunculus

In `config.json`:

```json
{
  "model": {
    "agent_id": "llm-only"
  }
}
```

## Verification

Test that tools are disabled:

```bash
curl -sS http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "x-openclaw-agent-id: llm-only" \
  -d '{
    "model": "claude-sonnet-4-5",
    "messages": [{"role": "user", "content": "List files"}]
  }' | jq -r '.choices[0].message.content'
```

Expected response: *"I don't have direct filesystem access..."*

## What Homunculus Gets

✅ **LLM inference** (via OpenClaw's OAuth token)  
✅ **Model selection** (sonnet/opus via agent config)  
❌ **No tools** (pure text-in, text-out)  
❌ **No workspace access**  
❌ **No session state** (unless using `user` field for persistence)

## Why This Matters

1. **Data isolation**: OpenClaw's SOUL.md/MEMORY.md stays private
2. **Security**: Homunculus can't execute commands on host
3. **Clean separation**: Each runtime has its own identity/memory/tools
4. **Principle of least privilege**: External API calls get minimal access

## Alternative: If You Need Some Tools

Give Homunculus limited tools by using `allow` instead of `deny`:

```json
{
  "tools": {
    "allow": ["web_search", "image"]  // Only these 2 tools
  }
}
```

But for NPC agents that just need character responses, **pure LLM mode is safest**.
