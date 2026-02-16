# Model Selection Guide

Homunculus supports multiple ways to control which model/agent to use when calling OpenClaw.

## Option 1: Direct Model Name (Recommended for fixed setup)

Use the OpenClaw agent:model syntax in the `name` field:

```json
{
  "model": {
    "provider": "openclaw",
    "name": "claude-sonnet-4-5",
    "base_url": "http://127.0.0.1:18789/v1",
    "api_key_env": "OPENCLAW_GATEWAY_TOKEN"
  }
}
```

The model name will be sent directly to OpenClaw, which routes it to the appropriate provider.

## Option 2: Agent-based Routing (for multi-agent setups)

Target a specific OpenClaw agent by encoding it in the model name:

```json
{
  "model": {
    "provider": "openclaw",
    "name": "openclaw:main",           // Routes to 'main' agent (uses claude-sonnet-4-5)
    "base_url": "http://127.0.0.1:18789/v1",
    "api_key_env": "OPENCLAW_GATEWAY_TOKEN"
  }
}
```

Or target the coc-keeper agent (which uses opus-4-6):

```json
{
  "model": {
    "provider": "openclaw",
    "name": "openclaw:coc-keeper",     // Routes to 'coc-keeper' agent (uses claude-opus-4-6)
    "base_url": "http://127.0.0.1:18789/v1",
    "api_key_env": "OPENCLAW_GATEWAY_TOKEN"
  }
}
```

## Option 3: Agent Header (for dynamic routing)

Specify the agent via the `agent_id` config field, which sends the `x-openclaw-agent-id` header:

```json
{
  "model": {
    "provider": "openclaw",
    "name": "claude-sonnet-4-5",
    "base_url": "http://127.0.0.1:18789/v1",
    "api_key_env": "OPENCLAW_GATEWAY_TOKEN",
    "agent_id": "main"                 // Optional: override agent routing
  }
}
```

This allows you to:
- Set a model name that might differ from OpenClaw's config
- Route to a specific agent via header
- Keep config flexible without encoding agent in model name

## Environment Variable Override

All config fields support environment variable overrides:

```bash
export HOMUNCULUS_MODEL_AGENT_ID="coc-keeper"  # Override agent via env
export HOMUNCULUS_MODEL_NAME="claude-opus-4-6"  # Override model name
```

## Current OpenClaw Agents

Check your OpenClaw agents with:

```bash
openclaw status
```

Current configuration:
- **main**: `claude-sonnet-4-5` (default, 200k context)
- **coc-keeper**: `claude-opus-4-6` (TRPG keeper, 200k context)

## Recommendation

For production NPC agents:
1. Use **Option 3** with explicit `agent_id` for clarity
2. This makes it obvious which OpenClaw agent handles the request
3. Allows independent model configuration on both sides

Example production config:

```json
{
  "model": {
    "provider": "openclaw",
    "name": "claude-sonnet-4-5",
    "base_url": "http://127.0.0.1:18789/v1",
    "api_key_env": "OPENCLAW_GATEWAY_TOKEN",
    "agent_id": "main",
    "max_tokens": 1000,
    "temperature": 0.8
  }
}
```
