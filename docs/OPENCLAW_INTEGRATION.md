# OpenClaw Integration Guide

Homunculus integrates with OpenClaw to leverage shared authentication and model access.

## Architecture

```
Discord Message → Homunculus → OpenClaw HTTP API → Claude (via OAuth)
                                      ↓
                                QMD Memory (shared binary)
```

## Benefits

1. **Single OAuth token**: No separate Anthropic API key needed
2. **Unified billing**: All usage tracked under one account
3. **Shared infrastructure**: Reuse OpenClaw's QMD binary for memory
4. **Flexible routing**: Use different OpenClaw agents for different models/configs

## Setup

### 1. Enable OpenClaw's HTTP endpoint

OpenClaw config needs:

```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}
```

Apply via:
```bash
openclaw config patch
```

### 2. Get OpenClaw gateway token

```bash
jq -r '.gateway.auth.token' ~/.openclaw/openclaw.json
```

Set in Homunculus environment:
```bash
export OPENCLAW_GATEWAY_TOKEN="<token-from-above>"
```

### 3. Configure Homunculus model

In `config.json`:

```json
{
  "model": {
    "provider": "openclaw",
    "name": "claude-sonnet-4-5",
    "api_key_env": "OPENCLAW_GATEWAY_TOKEN",
    "base_url": "http://127.0.0.1:18789/v1",
    "agent_id": "main"
  }
}
```

## Model Selection

See [MODEL_SELECTION.md](../examples/MODEL_SELECTION.md) for detailed options.

### Quick reference:

- **Use main agent** (sonnet-4-5): `"agent_id": "main"`
- **Use coc-keeper agent** (opus-4-6): `"agent_id": "coc-keeper"`
- **Create custom agent**: Edit OpenClaw config, add to `agents.list`

## Creating a Custom Agent

To create a dedicated agent for Homunculus in OpenClaw:

```bash
openclaw config patch
```

Add to config:

```json
{
  "agents": {
    "list": [
      {
        "id": "homunculus",
        "name": "Homunculus NPC Runtime",
        "model": "anthropic/claude-opus-4-6",
        "workspace": "/home/joexu/.openclaw/workspace-homunculus"
      }
    ]
  }
}
```

Then update Homunculus config:

```json
{
  "model": {
    "agent_id": "homunculus"
  }
}
```

## Monitoring

### Check OpenClaw sessions

```bash
openclaw status  # See all active sessions
```

Homunculus requests will appear as sessions under the targeted agent.

### View logs

```bash
openclaw logs --follow
```

Look for `llm_completion_success` entries with your agent_id.

## Troubleshooting

### "Invalid token" error

- Verify `OPENCLAW_GATEWAY_TOKEN` matches `gateway.auth.token` in openclaw.json
- Check OpenClaw is running: `openclaw status`

### "Agent not found"

- Check agent exists: `openclaw status` → Agents section
- Verify `agent_id` in config matches an existing agent

### Model mismatch

- The `model.name` in Homunculus config is sent to OpenClaw
- OpenClaw may override this with the agent's configured model
- To ensure specific model: create dedicated agent with desired model config

## Cost Tracking

All usage appears under OpenClaw's authenticated account:

```bash
openclaw status  # Check token usage across all agents
```

Usage is attributed to the agent handling the request (e.g., "main", "coc-keeper", "homunculus").
