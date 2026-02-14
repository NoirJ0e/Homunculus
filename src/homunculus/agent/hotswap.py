"""NPC identity hot-swap with archive isolation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Protocol
import shutil


@dataclass(frozen=True)
class AgentIdentity:
    npc_name: str
    character_card_path: Path
    qmd_index: str

    def __post_init__(self) -> None:
        if not self.npc_name.strip():
            raise ValueError("npc_name cannot be empty.")
        if not self.qmd_index.strip():
            raise ValueError("qmd_index cannot be empty.")
        if not str(self.character_card_path):
            raise ValueError("character_card_path cannot be empty.")


class IdentityRefreshHook(Protocol):
    async def refresh_identity(self, *, display_name: str) -> None:
        ...


@dataclass(frozen=True)
class HotSwapResult:
    old_identity: AgentIdentity
    new_identity: AgentIdentity
    archive_dir: Optional[Path]
    new_agent_root: Path


class HotSwapError(RuntimeError):
    """Raised when hot-swap cannot complete safely."""


class AgentIdentityManager:
    """Manages NPC identity swaps without cross-memory leakage."""

    def __init__(
        self,
        *,
        data_home: Path,
        initial_identity: AgentIdentity,
        identity_hook: Optional[IdentityRefreshHook] = None,
    ) -> None:
        self._data_home = data_home.expanduser()
        self._current_identity = initial_identity
        self._identity_hook = identity_hook

    @property
    def current_identity(self) -> AgentIdentity:
        return self._current_identity

    async def hot_swap(self, new_identity: AgentIdentity) -> HotSwapResult:
        old_identity = self._current_identity
        old_root = self._agent_root(old_identity.npc_name)
        new_root = self._agent_root(new_identity.npc_name)

        archive_dir = self._archive_old_agent_root(old_identity, old_root)
        self._bootstrap_new_agent_root(new_root)

        if self._identity_hook is not None:
            try:
                await self._identity_hook.refresh_identity(display_name=new_identity.npc_name)
            except Exception as exc:
                raise HotSwapError(
                    f"Identity refresh hook failed: {exc.__class__.__name__}"
                ) from exc

        self._current_identity = new_identity
        return HotSwapResult(
            old_identity=old_identity,
            new_identity=new_identity,
            archive_dir=archive_dir,
            new_agent_root=new_root,
        )

    def _archive_old_agent_root(self, old_identity: AgentIdentity, old_root: Path) -> Optional[Path]:
        if not old_root.exists():
            return None

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        archive_dir = self._data_home / "archive" / f"{old_identity.npc_name}-{timestamp}"
        archive_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_root), str(archive_dir))
        return archive_dir

    def _bootstrap_new_agent_root(self, root: Path) -> None:
        memory_root = root / "memory"
        daily_memory_root = memory_root / "memory"
        qmd_config = root / "qmd" / "xdg-config"
        qmd_cache = root / "qmd" / "xdg-cache"

        daily_memory_root.mkdir(parents=True, exist_ok=True)
        qmd_config.mkdir(parents=True, exist_ok=True)
        qmd_cache.mkdir(parents=True, exist_ok=True)

        curated_memory = memory_root / "MEMORY.md"
        if not curated_memory.exists():
            curated_memory.write_text("# MEMORY\n\n", encoding="utf-8")

    def _agent_root(self, npc_name: str) -> Path:
        return self._data_home / "agents" / npc_name.strip()
