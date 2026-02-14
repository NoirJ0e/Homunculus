from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.discord.slash_commands import (
    CommandValidationError,
    NpcSlashCommandHandler,
    NpcStatus,
    format_command_error,
)


class _FakeService:
    def __init__(self) -> None:
        self.swap_calls: list[tuple[str, Path | None]] = []
        self.status_error: Exception | None = None
        self.reload_error: Exception | None = None
        self.swap_error: Exception | None = None

    async def get_status(self) -> NpcStatus:
        if self.status_error is not None:
            raise self.status_error
        return NpcStatus(
            npc_name="kovach",
            channel_id=12345,
            model_name="claude-sonnet-4-5-20250929",
            skill_ruleset="coc7e",
            qmd_index="kovach",
        )

    async def reload_npc(self) -> str:
        if self.reload_error is not None:
            raise self.reload_error
        return "character-card reloaded"

    async def swap_npc(self, *, npc_name: str, character_card_path: Path | None) -> str:
        if self.swap_error is not None:
            raise self.swap_error
        self.swap_calls.append((npc_name, character_card_path))
        return f"npc={npc_name}"


class SlashCommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_status_renders_summary(self) -> None:
        service = _FakeService()
        handler = NpcSlashCommandHandler(service)

        response = await handler.status()

        self.assertIn("NPC status", response.content)
        self.assertIn("npc: kovach", response.content)
        self.assertIn("model: claude-sonnet-4-5-20250929", response.content)

    async def test_reload_renders_success_message(self) -> None:
        service = _FakeService()
        handler = NpcSlashCommandHandler(service)

        response = await handler.reload()

        self.assertEqual(response.content, "Reload complete: character-card reloaded")

    async def test_swap_validates_and_calls_service(self) -> None:
        service = _FakeService()
        handler = NpcSlashCommandHandler(service)

        response = await handler.swap(
            npc_name="Eliza",
            character_card_path="./agents/eliza/card.json",
        )

        self.assertEqual(response.content, "Swap complete: npc=eliza")
        self.assertEqual(len(service.swap_calls), 1)
        npc_name, card_path = service.swap_calls[0]
        self.assertEqual(npc_name, "eliza")
        self.assertEqual(card_path, Path("./agents/eliza/card.json"))

    async def test_swap_rejects_invalid_npc_name(self) -> None:
        service = _FakeService()
        handler = NpcSlashCommandHandler(service)

        response = await handler.swap(npc_name="BAD NAME")

        self.assertIn("Validation error:", response.content)
        self.assertIn("npc_name must match", response.content)

    async def test_swap_rejects_non_json_card_path(self) -> None:
        service = _FakeService()
        handler = NpcSlashCommandHandler(service)

        response = await handler.swap(npc_name="eliza", character_card_path="./card.txt")

        self.assertIn("Validation error:", response.content)
        self.assertIn(".json", response.content)

    async def test_runtime_failures_are_safely_formatted(self) -> None:
        service = _FakeService()
        service.swap_error = RuntimeError("boom")
        handler = NpcSlashCommandHandler(service)

        response = await handler.swap(npc_name="eliza", character_card_path="./card.json")

        self.assertEqual(
            response.content,
            "Command failed: internal runtime error. Please retry or inspect service logs.",
        )


class CommandErrorFormattingTests(unittest.TestCase):
    def test_validation_error_formatter(self) -> None:
        message = format_command_error(CommandValidationError("bad"))
        self.assertEqual(message, "Validation error: bad")

    def test_generic_error_formatter(self) -> None:
        message = format_command_error(RuntimeError("boom"))
        self.assertEqual(
            message,
            "Command failed: internal runtime error. Please retry or inspect service logs.",
        )


if __name__ == "__main__":
    unittest.main()
