# Dual System Character Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `"system"` field to character cards with strict per-system stat validation for CoC 7e and D&D 5e.

**Architecture:** Unified `CharacterCard` dataclass gains a `system: str` field. Validation dispatches to system-specific stat rules based on this field. Missing `system` defaults to `"coc7e"` for backward compatibility.

**Tech Stack:** Python 3.11+, unittest, pytest

---

### Task 1: Update existing tests to include `"system"` field

**Files:**
- Modify: `tests/test_character_card.py:16-41` (`_valid_card_payload`)

**Step 1: Add `"system": "coc7e"` to test helper**

In `_valid_card_payload()`, add `"system"` to the returned dict:

```python
def _valid_card_payload():
    return {
        "system": "coc7e",
        "name": "Kovach",
        ...
    }
```

**Step 2: Run tests to confirm they fail**

Run: `pytest tests/test_character_card.py -v`
Expected: FAIL — `parse_character_card` rejects `"system"` as `unknown_field`

---

### Task 2: Add `system` field to `CharacterCard` and validation dispatch

**Files:**
- Modify: `src/homunculus/character_card.py`

**Step 1: Add system constants and update field lists**

Replace `_REQUIRED_STATS_FIELDS` with system-specific definitions:

```python
_SUPPORTED_SYSTEMS = ("coc7e", "dnd5e")

_COC7E_REQUIRED_STATS = (
    "STR", "CON", "DEX", "INT", "POW", "APP", "SIZ", "EDU", "HP", "SAN", "MP",
)
_COC7E_STAT_RANGES: dict[str, tuple[int, int]] = {
    stat: (0, 100) for stat in _COC7E_REQUIRED_STATS
}

_DND5E_REQUIRED_STATS = (
    "STR", "DEX", "CON", "INT", "WIS", "CHA", "AC", "HP", "proficiency_bonus", "level",
)
_DND5E_STAT_RANGES: dict[str, tuple[int, int]] = {
    "STR": (1, 30), "DEX": (1, 30), "CON": (1, 30),
    "INT": (1, 30), "WIS": (1, 30), "CHA": (1, 30),
    "AC": (1, 30), "HP": (1, 999),
    "proficiency_bonus": (1, 10), "level": (1, 20),
}
```

Remove `"system"` from `_REQUIRED_TOP_LEVEL_FIELDS` (it gets special handling for backward compat). Add `"system"` to the known-fields set used for unknown-field detection.

**Step 2: Add `system` to `CharacterCard` dataclass**

```python
@dataclass(frozen=True)
class CharacterCard:
    system: str
    name: str
    description: str
    personality: str
    background: str
    stats: Mapping[str, int]
    skills: Mapping[str, int]
    inventory: Tuple[str, ...]
```

**Step 3: Update `parse_character_card` validation logic**

In `parse_character_card()`:

1. Check for unknown fields against `set(_REQUIRED_TOP_LEVEL_FIELDS) | {"system"}`.
2. Extract and validate `system`:
   - If missing: default to `"coc7e"`, log deprecation warning via `warnings.warn()`.
   - If present but not in `_SUPPORTED_SYSTEMS`: add validation issue.
3. Pass `system` to `_validate_stats()` so it can dispatch.
4. Pass `system` to `CharacterCard(system=system, ...)`.

```python
import logging
import warnings

def parse_character_card(payload: Any) -> CharacterCard:
    issues = []
    if not isinstance(payload, Mapping):
        raise CharacterCardValidationError(
            [ValidationIssue("$", "invalid_type", "Character card root must be an object.")]
        )

    all_known_fields = set(_REQUIRED_TOP_LEVEL_FIELDS) | {"system"}
    unknown_fields = sorted(set(payload.keys()) - all_known_fields)
    for field in unknown_fields:
        issues.append(ValidationIssue(field, "unknown_field", "Unknown field is not allowed."))

    missing_fields = sorted(set(_REQUIRED_TOP_LEVEL_FIELDS) - set(payload.keys()))
    for field in missing_fields:
        issues.append(ValidationIssue(field, "missing_field", "Required field is missing."))

    # System field: default to coc7e for backward compatibility
    raw_system = payload.get("system")
    if raw_system is None:
        system = "coc7e"
        warnings.warn(
            "Character card missing 'system' field; defaulting to 'coc7e'. "
            "Add '\"system\": \"coc7e\"' to silence this warning.",
            DeprecationWarning,
            stacklevel=2,
        )
    else:
        system = _validate_system(raw_system, issues)

    name = _validate_non_empty_string("name", payload.get("name"), issues) if "name" in payload else ""
    description = (
        _validate_non_empty_string("description", payload.get("description"), issues)
        if "description" in payload
        else ""
    )
    personality = (
        _validate_non_empty_string("personality", payload.get("personality"), issues)
        if "personality" in payload
        else ""
    )
    background = (
        _validate_non_empty_string("background", payload.get("background"), issues)
        if "background" in payload
        else ""
    )

    stats = _validate_stats(payload.get("stats"), system, issues) if "stats" in payload else {}
    skills = _validate_skills(payload.get("skills"), issues) if "skills" in payload else {}
    inventory = _validate_inventory(payload.get("inventory"), issues) if "inventory" in payload else ()

    if issues:
        raise CharacterCardValidationError(issues)

    return CharacterCard(
        system=system,
        name=name,
        description=description,
        personality=personality,
        background=background,
        stats=stats,
        skills=skills,
        inventory=inventory,
    )
```

**Step 4: Add `_validate_system` helper**

```python
def _validate_system(value: Any, issues: list) -> str:
    if not isinstance(value, str):
        issues.append(ValidationIssue("system", "invalid_type", "Expected a string value."))
        return "coc7e"

    normalized = value.strip().lower()
    if normalized not in _SUPPORTED_SYSTEMS:
        allowed = ", ".join(_SUPPORTED_SYSTEMS)
        issues.append(
            ValidationIssue("system", "unsupported_system", f"Must be one of: {allowed}.")
        )
        return normalized

    return normalized
```

**Step 5: Refactor `_validate_stats` to dispatch by system**

```python
def _validate_stats(value: Any, system: str, issues: list) -> Mapping[str, int]:
    if not isinstance(value, Mapping):
        issues.append(ValidationIssue("stats", "invalid_type", "Expected an object for stats."))
        return {}

    if system == "dnd5e":
        required = _DND5E_REQUIRED_STATS
        ranges = _DND5E_STAT_RANGES
    else:
        required = _COC7E_REQUIRED_STATS
        ranges = _COC7E_STAT_RANGES

    unknown = sorted(set(value.keys()) - set(required))
    for key in unknown:
        issues.append(ValidationIssue(f"stats.{key}", "unknown_field", "Unknown stat is not allowed."))

    missing = sorted(set(required) - set(value.keys()))
    for key in missing:
        issues.append(ValidationIssue(f"stats.{key}", "missing_field", "Required stat is missing."))

    stats = {}
    for key in required:
        if key not in value:
            continue
        minimum, maximum = ranges[key]
        stat_value = _validate_int_range(
            field=f"stats.{key}",
            value=value[key],
            minimum=minimum,
            maximum=maximum,
            issues=issues,
        )
        if stat_value is not None:
            stats[key] = stat_value
    return stats
```

**Step 6: Run tests to verify existing CoC tests pass**

Run: `pytest tests/test_character_card.py -v`
Expected: All 4 existing tests PASS

**Step 7: Commit**

```bash
git add src/homunculus/character_card.py tests/test_character_card.py
git commit -m "feat: add system field to CharacterCard with per-system stat validation"
```

---

### Task 3: Add D&D 5e validation tests

**Files:**
- Modify: `tests/test_character_card.py`

**Step 1: Add D&D 5e test helper**

```python
def _valid_dnd5e_payload():
    return {
        "system": "dnd5e",
        "name": "Elara",
        "description": "A half-elf ranger with keen eyes.",
        "personality": "Quiet and observant.",
        "background": "Outlander who grew up in the wild.",
        "stats": {
            "STR": 16, "DEX": 14, "CON": 12,
            "INT": 10, "WIS": 13, "CHA": 8,
            "AC": 18, "HP": 45,
            "proficiency_bonus": 3, "level": 5,
        },
        "skills": {"Athletics": 6, "Survival": 5},
        "inventory": ["Longsword", "Shield", "Explorer's Pack"],
    }
```

**Step 2: Add test cases**

```python
def test_parse_valid_dnd5e_card(self):
    card = parse_character_card(_valid_dnd5e_payload())
    self.assertEqual(card.system, "dnd5e")
    self.assertEqual(card.name, "Elara")
    self.assertEqual(card.stats["STR"], 16)
    self.assertEqual(card.stats["level"], 5)

def test_dnd5e_rejects_coc_stats(self):
    payload = _valid_dnd5e_payload()
    payload["stats"] = {
        "STR": 65, "CON": 70, "DEX": 55, "INT": 50,
        "POW": 60, "APP": 40, "SIZ": 75, "EDU": 45,
        "HP": 14, "SAN": 52, "MP": 12,
    }
    with self.assertRaises(CharacterCardValidationError) as ctx:
        parse_character_card(payload)
    codes = {i.code for i in ctx.exception.issues}
    self.assertIn("unknown_field", codes)
    self.assertIn("missing_field", codes)

def test_dnd5e_stat_range_validation(self):
    payload = _valid_dnd5e_payload()
    payload["stats"]["STR"] = 0   # below min 1
    payload["stats"]["HP"] = 1000  # above max 999
    with self.assertRaises(CharacterCardValidationError) as ctx:
        parse_character_card(payload)
    fields = {i.field for i in ctx.exception.issues}
    self.assertIn("stats.STR", fields)
    self.assertIn("stats.HP", fields)

def test_unsupported_system_rejected(self):
    payload = _valid_card_payload()
    payload["system"] = "pathfinder2e"
    with self.assertRaises(CharacterCardValidationError) as ctx:
        parse_character_card(payload)
    self.assertEqual(ctx.exception.issues[0].code, "unsupported_system")

def test_missing_system_defaults_to_coc7e(self):
    payload = _valid_card_payload()
    del payload["system"]
    with self.assertWarns(DeprecationWarning):
        card = parse_character_card(payload)
    self.assertEqual(card.system, "coc7e")
    self.assertEqual(card.name, "Kovach")
```

**Step 3: Run all tests**

Run: `pytest tests/test_character_card.py -v`
Expected: All tests PASS (4 existing + 5 new)

**Step 4: Commit**

```bash
git add tests/test_character_card.py
git commit -m "test: add D&D 5e validation and system field edge case tests"
```

---

### Task 4: Update example character card and bootstrap template

**Files:**
- Modify: `examples/kovach/character-card.json`
- Modify: `src/homunculus/ops/bootstrap.py:72-95` (`_character_card_template`)

**Step 1: Add `"system"` to Kovach example**

Add `"system": "coc7e"` as first field in `examples/kovach/character-card.json`.

**Step 2: Update bootstrap template**

In `_character_card_template()`, add `"system": "coc7e"` as first field:

```python
def _character_card_template(npc_name: str) -> str:
    return (
        "{\n"
        "  \"system\": \"coc7e\",\n"
        f"  \"name\": \"{npc_name}\",\n"
        ...
    )
```

**Step 3: Run bootstrap tests to confirm nothing broke**

Run: `pytest tests/test_agent_bootstrap.py -v`
Expected: All 4 tests PASS

**Step 4: Run full test suite**

Run: `pytest -m "not integration and not smoke" --maxfail=1`
Expected: All tests PASS

**Step 5: Run lint**

Run: `ruff check .`
Expected: No errors

**Step 6: Commit**

```bash
git add examples/kovach/character-card.json src/homunculus/ops/bootstrap.py
git commit -m "chore: add system field to example card and bootstrap template"
```
