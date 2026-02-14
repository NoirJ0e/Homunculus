"""CharacterCard schema and validation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence, Tuple
import json


_REQUIRED_TOP_LEVEL_FIELDS = (
    "name",
    "description",
    "personality",
    "background",
    "stats",
    "skills",
    "inventory",
)
_REQUIRED_STATS_FIELDS = (
    "STR",
    "CON",
    "DEX",
    "INT",
    "POW",
    "APP",
    "SIZ",
    "EDU",
    "HP",
    "SAN",
    "MP",
)


@dataclass(frozen=True)
class ValidationIssue:
    field: str
    code: str
    message: str


class CharacterCardValidationError(ValueError):
    """Raised when character card validation fails."""

    def __init__(self, issues: Sequence[ValidationIssue]):
        normalized = tuple(sorted(issues, key=lambda item: (item.field, item.code, item.message)))
        if not normalized:
            raise ValueError("CharacterCardValidationError requires at least one issue.")

        self.issues: Tuple[ValidationIssue, ...] = normalized
        formatted = "; ".join(
            f"{issue.field}: {issue.message} (code={issue.code})" for issue in self.issues
        )
        super().__init__(f"CharacterCard validation failed: {formatted}")


@dataclass(frozen=True)
class CharacterCard:
    name: str
    description: str
    personality: str
    background: str
    stats: Mapping[str, int]
    skills: Mapping[str, int]
    inventory: Tuple[str, ...]


def load_character_card(path: Path) -> CharacterCard:
    resolved = path.expanduser()
    if not resolved.exists():
        raise CharacterCardValidationError(
            [ValidationIssue("file", "not_found", f"Character card file does not exist: {resolved}")]
        )

    try:
        with resolved.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except json.JSONDecodeError as exc:
        raise CharacterCardValidationError(
            [ValidationIssue("file", "invalid_json", f"Character card is not valid JSON: {resolved}")]
        ) from exc

    return parse_character_card(payload)


def parse_character_card(payload: Any) -> CharacterCard:
    issues = []
    if not isinstance(payload, Mapping):
        raise CharacterCardValidationError(
            [ValidationIssue("$", "invalid_type", "Character card root must be an object.")]
        )

    unknown_fields = sorted(set(payload.keys()) - set(_REQUIRED_TOP_LEVEL_FIELDS))
    for field in unknown_fields:
        issues.append(ValidationIssue(field, "unknown_field", "Unknown field is not allowed."))

    missing_fields = sorted(set(_REQUIRED_TOP_LEVEL_FIELDS) - set(payload.keys()))
    for field in missing_fields:
        issues.append(ValidationIssue(field, "missing_field", "Required field is missing."))

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

    stats = _validate_stats(payload.get("stats"), issues) if "stats" in payload else {}
    skills = _validate_skills(payload.get("skills"), issues) if "skills" in payload else {}
    inventory = _validate_inventory(payload.get("inventory"), issues) if "inventory" in payload else ()

    if issues:
        raise CharacterCardValidationError(issues)

    return CharacterCard(
        name=name,
        description=description,
        personality=personality,
        background=background,
        stats=stats,
        skills=skills,
        inventory=inventory,
    )


def _validate_non_empty_string(field: str, value: Any, issues: list) -> str:
    if not isinstance(value, str):
        issues.append(ValidationIssue(field, "invalid_type", "Expected a string value."))
        return ""

    normalized = value.strip()
    if not normalized:
        issues.append(ValidationIssue(field, "empty_string", "Value cannot be empty."))
        return ""

    return normalized


def _validate_stats(value: Any, issues: list) -> Mapping[str, int]:
    if not isinstance(value, Mapping):
        issues.append(ValidationIssue("stats", "invalid_type", "Expected an object for stats."))
        return {}

    unknown = sorted(set(value.keys()) - set(_REQUIRED_STATS_FIELDS))
    for key in unknown:
        issues.append(ValidationIssue(f"stats.{key}", "unknown_field", "Unknown stat is not allowed."))

    missing = sorted(set(_REQUIRED_STATS_FIELDS) - set(value.keys()))
    for key in missing:
        issues.append(ValidationIssue(f"stats.{key}", "missing_field", "Required stat is missing."))

    stats = {}
    for key in _REQUIRED_STATS_FIELDS:
        if key not in value:
            continue
        stat_value = _validate_int_range(
            field=f"stats.{key}",
            value=value[key],
            minimum=0,
            maximum=100,
            issues=issues,
        )
        if stat_value is not None:
            stats[key] = stat_value
    return stats


def _validate_skills(value: Any, issues: list) -> Mapping[str, int]:
    if not isinstance(value, Mapping):
        issues.append(ValidationIssue("skills", "invalid_type", "Expected an object for skills."))
        return {}

    skills = {}
    for raw_key in sorted(value.keys(), key=lambda item: str(item)):
        key = _normalize_skill_key(raw_key, issues)
        if key is None:
            continue

        skill_value = _validate_int_range(
            field=f"skills.{key}",
            value=value[raw_key],
            minimum=0,
            maximum=100,
            issues=issues,
        )
        if skill_value is not None:
            skills[key] = skill_value
    return skills


def _normalize_skill_key(value: Any, issues: list) -> str | None:
    if not isinstance(value, str):
        issues.append(
            ValidationIssue("skills", "invalid_key_type", "Skill keys must be non-empty strings.")
        )
        return None

    normalized = value.strip()
    if not normalized:
        issues.append(
            ValidationIssue("skills", "empty_key", "Skill keys must be non-empty strings.")
        )
        return None

    return normalized


def _validate_inventory(value: Any, issues: list) -> Tuple[str, ...]:
    if not isinstance(value, list):
        issues.append(ValidationIssue("inventory", "invalid_type", "Expected a list for inventory."))
        return ()

    inventory = []
    for idx, item in enumerate(value):
        field = f"inventory[{idx}]"
        if not isinstance(item, str):
            issues.append(ValidationIssue(field, "invalid_type", "Inventory item must be a string."))
            continue

        normalized = item.strip()
        if not normalized:
            issues.append(ValidationIssue(field, "empty_string", "Inventory item cannot be empty."))
            continue
        inventory.append(normalized)
    return tuple(inventory)


def _validate_int_range(
    *,
    field: str,
    value: Any,
    minimum: int,
    maximum: int,
    issues: list,
) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        issues.append(ValidationIssue(field, "invalid_type", "Expected an integer value."))
        return None

    if value < minimum or value > maximum:
        issues.append(
            ValidationIssue(
                field,
                "out_of_range",
                f"Expected value between {minimum} and {maximum}.",
            )
        )
        return None

    return value
