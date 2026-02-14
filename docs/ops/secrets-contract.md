# Secrets Contract (OPS-01)

This document defines the environment-variable contract used by startup validation.

## Scope

The contract has two levels:

1. Global runtime variables shared by all NPC agents.
2. Per-NPC variables keyed by NPC slug.

## Required Variables

| Variable | Scope | Secret | Required | Validation |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Global | Yes | Yes | Non-empty string. Never logged in plaintext. |
| `HOMUNCULUS_NPCS` | Global | No | Yes | Comma-separated slug list (`[a-z0-9_\\-]+` after trim). |
| `NPC_<SLUG>_DISCORD_TOKEN` | Per-NPC | Yes | Yes | Non-empty string for every slug in `HOMUNCULUS_NPCS`. |
| `NPC_<SLUG>_CHANNEL_ID` | Per-NPC | No | Yes | Discord snowflake (17-20 digits). |
| `NPC_<SLUG>_CHAR_CARD_PATH` | Per-NPC | No | Yes | Existing readable JSON file path. |

## Optional Variables

| Variable | Default | Validation |
| --- | --- | --- |
| `HOMUNCULUS_AGENT_HOME` | `$HOME/.homunculus/agents` | Non-empty path string. |
| `HOMUNCULUS_RECENT_MESSAGE_LIMIT` | `25` | Integer, range `1-200`. |
| `HOMUNCULUS_MEMORY_TOP_K` | `10` | Integer, range `1-50`. |
| `HOMUNCULUS_QMD_QUERY_TIMEOUT_SECONDS` | `8` | Integer, range `1-120`. |
| `HOMUNCULUS_QMD_UPDATE_INTERVAL_SECONDS` | `300` | Integer, range `30-3600`. |
| `NPC_<SLUG>_SKILL_RULESET` | `coc7e` | Allowed values: `coc7e`, `dnd5e`. |
| `NPC_<SLUG>_MODEL` | `claude-sonnet-4-5-20250929` | Non-empty model identifier string. |

## Startup Validation Rules

1. Parse and normalize `HOMUNCULUS_NPCS`.
2. Fail fast if the list is empty.
3. For each slug, verify all required per-NPC variables exist and are valid.
4. Validate every numeric variable range before service start.
5. Report all validation errors together and exit with non-zero status.

## Secret Handling Rules

1. Keep `.env` local only. The repository must only track `.env.example`.
2. Redact secret values in logs and error output (`***` + last 4 chars only).
3. Do not print environment dumps in CI or local debug output.
4. Never commit per-NPC Discord bot tokens or provider API keys.

## Local Setup

```bash
cp ".env.example" ".env"
```

Then fill actual values in `.env` for your environment.
