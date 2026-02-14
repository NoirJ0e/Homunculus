"""Load prompt-ready skill ruleset excerpts from static files."""

from __future__ import annotations

from pathlib import Path


_EXCERPT_DIR = Path(__file__).resolve().parent / "excerpts"
_SUPPORTED_RULESETS = ("coc7e", "dnd5e")


class SkillExcerptError(ValueError):
    """Raised when a skill ruleset excerpt cannot be loaded."""


def list_supported_rulesets() -> tuple[str, ...]:
    return _SUPPORTED_RULESETS


def load_skill_excerpt(ruleset: str, *, max_chars: int = 2400) -> str:
    normalized = ruleset.strip().lower()
    if normalized not in _SUPPORTED_RULESETS:
        allowed = ", ".join(_SUPPORTED_RULESETS)
        raise SkillExcerptError(f"Unsupported skill ruleset '{ruleset}'. Expected one of: {allowed}.")
    if max_chars <= 0:
        raise SkillExcerptError("max_chars must be a positive integer.")

    excerpt_path = _EXCERPT_DIR / f"{normalized}.md"
    try:
        text = excerpt_path.read_text(encoding="utf-8").strip()
    except FileNotFoundError as exc:
        raise SkillExcerptError(
            f"Missing excerpt file for ruleset '{normalized}': {excerpt_path}"
        ) from exc

    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "..."
