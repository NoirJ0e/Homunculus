"""Idempotent bootstrap of ~/.homunculus/agents/<npc> directory trees."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
import re


_NPC_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")


@dataclass(frozen=True)
class BootstrapResult:
    npc_name: str
    agent_root: Path
    created_dirs: tuple[Path, ...]
    created_files: tuple[Path, ...]


def bootstrap_agents(data_home: Path, npc_names: Iterable[str]) -> tuple[BootstrapResult, ...]:
    results = []
    for npc_name in npc_names:
        results.append(bootstrap_agent(data_home, npc_name))
    return tuple(results)


def bootstrap_agent(data_home: Path, npc_name: str) -> BootstrapResult:
    normalized_name = _normalize_npc_name(npc_name)
    root = data_home.expanduser() / "agents" / normalized_name

    required_dirs = (
        root / "memory" / "memory",
        root / "qmd" / "xdg-config",
        root / "qmd" / "xdg-cache",
    )
    created_dirs: list[Path] = []
    for directory in required_dirs:
        if not directory.exists():
            directory.mkdir(parents=True, exist_ok=True)
            created_dirs.append(directory)
        else:
            directory.mkdir(parents=True, exist_ok=True)

    required_files = (
        (root / "memory" / "MEMORY.md", "# MEMORY\n\n"),
        (root / "character-card.json", _character_card_template(normalized_name)),
    )
    created_files: list[Path] = []
    for path, content in required_files:
        if _write_file_if_missing_atomic(path, content):
            created_files.append(path)

    return BootstrapResult(
        npc_name=normalized_name,
        agent_root=root,
        created_dirs=tuple(created_dirs),
        created_files=tuple(created_files),
    )


def _normalize_npc_name(value: str) -> str:
    normalized = value.strip().lower()
    if not normalized:
        raise ValueError("npc_name is required.")
    if not _NPC_NAME_PATTERN.fullmatch(normalized):
        raise ValueError("npc_name must match [a-z0-9][a-z0-9_-]{1,63}.")
    return normalized


def _character_card_template(npc_name: str) -> str:
    return (
        "{\n"
        f"  \"name\": \"{npc_name}\",\n"
        "  \"description\": \"\",\n"
        "  \"personality\": \"\",\n"
        "  \"background\": \"\",\n"
        "  \"stats\": {\n"
        "    \"STR\": 50,\n"
        "    \"CON\": 50,\n"
        "    \"DEX\": 50,\n"
        "    \"INT\": 50,\n"
        "    \"POW\": 50,\n"
        "    \"APP\": 50,\n"
        "    \"SIZ\": 50,\n"
        "    \"EDU\": 50,\n"
        "    \"HP\": 10,\n"
        "    \"SAN\": 50,\n"
        "    \"MP\": 10\n"
        "  },\n"
        "  \"skills\": {},\n"
        "  \"inventory\": []\n"
        "}\n"
    )


def _write_file_if_missing_atomic(path: Path, content: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x", encoding="utf-8") as handle:
            handle.write(content)
    except FileExistsError:
        return False
    return True
