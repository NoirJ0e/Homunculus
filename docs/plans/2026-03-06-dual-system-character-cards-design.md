# Dual System Character Cards (CoC 7e + D&D 5e)

## Summary

Add a `"system"` field to character cards so the same codebase can validate and run both CoC 7e and D&D 5e characters with strict per-system stat validation.

## Approach

**Unified dataclass + validation dispatch.** `CharacterCard` keeps a single `stats: Mapping[str, int]` field. A new `system: str` field selects which validation rules apply at load time. No subclasses, no type-level split.

Rationale: stats are only used for validation and prompt string assembly (`"Stats: STR=65, CON=70, ..."`). Both use cases work identically regardless of system, so structural differentiation adds complexity with no runtime benefit.

## Schema

### CoC 7e

```json
{
  "system": "coc7e",
  "name": "...",
  "description": "...",
  "personality": "...",
  "background": "...",
  "stats": {
    "STR": 65, "CON": 70, "DEX": 55, "INT": 50, "POW": 60,
    "APP": 40, "SIZ": 75, "EDU": 45, "HP": 14, "SAN": 52, "MP": 12
  },
  "skills": { "射击": 65 },
  "inventory": ["左轮手枪"]
}
```

Required stats: STR, CON, DEX, INT, POW, APP, SIZ, EDU, HP, SAN, MP. Range: 0-100.

### D&D 5e

```json
{
  "system": "dnd5e",
  "name": "...",
  "description": "...",
  "personality": "...",
  "background": "...",
  "stats": {
    "STR": 16, "DEX": 14, "CON": 12, "INT": 10, "WIS": 13, "CHA": 8,
    "AC": 18, "HP": 45, "proficiency_bonus": 3, "level": 5
  },
  "skills": { "Athletics": 6 },
  "inventory": ["Longsword"]
}
```

Required stats: STR, DEX, CON, INT, WIS, CHA (range 1-30), AC (1-30), HP (1-999), proficiency_bonus (1-10), level (1-20).

## Backward Compatibility

If `"system"` is missing, default to `"coc7e"` and log a deprecation warning. Existing character cards continue to work without modification.

## Changes by File

### Core change: `src/homunculus/character_card.py`

- Add `system: str` to `CharacterCard` dataclass.
- Add `"system"` to `_REQUIRED_TOP_LEVEL_FIELDS` (but allow missing with default).
- Rename `_REQUIRED_STATS_FIELDS` to `_COC7E_STATS`.
- Add `_DND5E_STATS` with per-field range definitions.
- `_validate_stats()` dispatches to `_validate_coc7e_stats()` or `_validate_dnd5e_stats()` based on system.
- `system` must be `"coc7e"` or `"dnd5e"`, else validation error.

### Minor follow-ups

- `ops/bootstrap.py` — Template `character-card.json` gets `"system": "coc7e"`.
- `examples/kovach/character-card.json` — Add `"system": "coc7e"`.
- `tests/test_character_card.py` — Existing tests add `"system": "coc7e"` to payloads; new tests for D&D validation and missing-system fallback.

### No changes needed

- `prompt/builder.py` — Iterates `stats.items()`, system-agnostic.
- `config/settings.py` — `skill_ruleset` is independent of card `system`.
- `runtime/factory.py` — Calls `load_character_card()`, unaffected by new field.
- `pipeline/response_pipeline.py` — Does not touch stats.
