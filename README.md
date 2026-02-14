# Homunculus

Homunculus is a lightweight Discord bot runtime for TTRPG NPC agents.

This branch currently implements `BE-03`:
- channel-scoped Discord message listening
- bot mention trigger filtering

## Local development

```bash
PYTHONPATH="src" python3 -m unittest discover -s "tests" -v
```
