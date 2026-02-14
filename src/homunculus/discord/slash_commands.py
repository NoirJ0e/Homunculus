"""Slash command UX handlers with validation and user-facing errors."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Protocol
import re


@dataclass(frozen=True)
class CommandResponse:
    content: str
    ephemeral: bool = True


@dataclass(frozen=True)
class NpcStatus:
    npc_name: str
    channel_id: int
    model_name: str
    skill_ruleset: str
    qmd_index: str


class NpcCommandService(Protocol):
    async def get_status(self) -> NpcStatus:
        ...

    async def reload_npc(self) -> str:
        ...

    async def swap_npc(self, *, npc_name: str, character_card_path: Optional[Path]) -> str:
        ...


class CommandValidationError(ValueError):
    """Raised when command input is invalid."""


def format_command_error(exc: Exception) -> str:
    if isinstance(exc, CommandValidationError):
        return f"Validation error: {exc}"
    return (
        "Command failed: internal runtime error. "
        "Please retry or inspect service logs."
    )


class NpcSlashCommandHandler:
    """Backend-facing handlers for /npc status, /npc reload, and /npc swap."""

    _NPC_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")

    def __init__(self, service: NpcCommandService) -> None:
        self._service = service

    async def status(self) -> CommandResponse:
        try:
            status = await self._service.get_status()
            return CommandResponse(
                content=(
                    "NPC status\n"
                    f"- npc: {status.npc_name}\n"
                    f"- channel_id: {status.channel_id}\n"
                    f"- model: {status.model_name}\n"
                    f"- ruleset: {status.skill_ruleset}\n"
                    f"- qmd_index: {status.qmd_index}"
                )
            )
        except Exception as exc:
            return CommandResponse(content=format_command_error(exc))

    async def reload(self) -> CommandResponse:
        try:
            details = await self._service.reload_npc()
            return CommandResponse(content=f"Reload complete: {details}")
        except Exception as exc:
            return CommandResponse(content=format_command_error(exc))

    async def swap(self, *, npc_name: str, character_card_path: Optional[str] = None) -> CommandResponse:
        try:
            validated_npc_name = self._validate_npc_name(npc_name)
            validated_card_path = self._validate_character_card_path(character_card_path)
            details = await self._service.swap_npc(
                npc_name=validated_npc_name,
                character_card_path=validated_card_path,
            )
            return CommandResponse(content=f"Swap complete: {details}")
        except Exception as exc:
            return CommandResponse(content=format_command_error(exc))

    def _validate_npc_name(self, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise CommandValidationError("npc_name is required.")
        if not self._NPC_NAME_PATTERN.fullmatch(normalized):
            raise CommandValidationError(
                "npc_name must match [a-z0-9][a-z0-9_-]{1,63}."
            )
        return normalized

    @staticmethod
    def _validate_character_card_path(value: Optional[str]) -> Optional[Path]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise CommandValidationError("character_card_path cannot be empty.")
        path = Path(normalized).expanduser()
        if path.suffix.lower() != ".json":
            raise CommandValidationError("character_card_path must reference a .json file.")
        return path
