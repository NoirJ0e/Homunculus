# Homunculus

Phase-1 backend foundation for a Discord-based TTRPG NPC runtime.

## Current scope (BE-01 + BE-02 + BE-03 + BE-04 + BE-05 + BE-06 + BE-07 + BE-08 + BE-09 + BE-10 + BE-11)

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

The runtime currently boots and waits for shutdown signals. Feature adapters are added in follow-up tasks.
