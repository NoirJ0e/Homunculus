# Homunculus

Phase-1 MVP runtime for a Discord-based TTRPG NPC agent system.

## Current scope (BE-01..BE-11 + FE-01..FE-04 + OPS-01..OPS-05 + QA-01..QA-06)

- `src` package layout
- Typed settings loader with validation
- Base runtime lifecycle wiring and CLI entrypoint
- CharacterCard schema validation with deterministic field-level errors
- Channel-scoped mention listener and trigger filter primitives
- Recent-message collector with deterministic ordering and role attribution
- QMD adapter with timeout fallback and normalized retrieval schema
- Prompt builder with centralized token budget and truncation policy
- Abstract LLM client + Anthropic adapter with model-config injection
- Mention-to-reply orchestration pipeline with controlled failure outcomes
- Async memory extraction with fire-and-forget markdown append
- Scheduled `qmd update` + `qmd embed` index maintenance
- NPC hot-swap identity manager with archive isolation and refresh hook
- Reply formatting templates for consistent in-character Discord output
- Slash command handler layer for `/npc status`, `/npc reload`, and `/npc swap`
- Skill ruleset excerpt rendering from static `coc7e` / `dnd5e` files
- Agent directory bootstrap script for idempotent local setup
- Runtime packaging templates (`Dockerfile`, Docker Compose, systemd unit)
- Observability metrics for token usage and estimated completion cost
- Expanded test coverage for FE/OPS modules and observability

## Quick start

1. Copy `config/homunculus.example.json` and adjust values.
2. Run config check:

```bash
PYTHONPATH=src python3 -m homunculus --check --config config/homunculus.example.json
```

3. Start runtime:

```bash
PYTHONPATH=src python3 -m homunculus --config config/homunculus.example.json
```

Additional setup helpers:

```bash
python3 scripts/bootstrap-agents.py kovach eliza
```
