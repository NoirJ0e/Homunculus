from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.character_card import parse_character_card
from homunculus.discord.recent_messages import RecentMessage
from homunculus.memory.qmd_adapter import MemoryRecord
from homunculus.prompt.builder import PromptBuilder


def _card():
    return parse_character_card(
        {
            "name": "Kovach",
            "description": "A scarred veteran.",
            "personality": "Cautious and loyal.",
            "background": "Runs a small store after the war.",
            "stats": {
                "STR": 65,
                "CON": 70,
                "DEX": 55,
                "INT": 50,
                "POW": 60,
                "APP": 40,
                "SIZ": 75,
                "EDU": 45,
                "HP": 14,
                "SAN": 52,
                "MP": 12,
            },
            "skills": {"Brawl": 60},
            "inventory": ["Revolver", "Canteen"],
        }
    )


def _message(idx: int) -> RecentMessage:
    return RecentMessage(
        message_id=idx,
        channel_id=100,
        author_id=idx,
        author_name=f"user-{idx}",
        role="user",
        content=f"message-content-{idx}",
        created_at=datetime(2026, 2, 14, 12, idx, tzinfo=timezone.utc),
        mentioned_user_ids=(999,),
    )


class PromptBuilderTests(unittest.TestCase):
    def test_build_contains_required_sections(self):
        builder = PromptBuilder(token_budget=2000)
        result = builder.build(
            character_card=_card(),
            skill_rules_excerpt="Rule excerpt text",
            memories=(
                MemoryRecord(text="Memory one", source="MEMORY.md", score=0.9, mode="query"),
            ),
            recent_messages=(_message(1), _message(2)),
        )

        self.assertIn("You are Kovach", result.system_prompt)
        self.assertIn("Game rules reference", result.system_prompt)
        self.assertIn("Memory highlights", result.system_prompt)
        self.assertIn("Recent conversation", result.user_prompt)
        self.assertFalse(result.was_truncated)
        self.assertEqual(result.included_memory_count, 1)
        self.assertEqual(result.included_history_count, 2)

    def test_build_enforces_budget_with_truncation(self):
        builder = PromptBuilder(token_budget=80)
        memories = tuple(
            MemoryRecord(
                text=f"memory text {i} " * 8,
                source=f"file-{i}.md",
                score=0.5,
                mode="query",
            )
            for i in range(5)
        )
        messages = tuple(_message(i) for i in range(1, 8))

        result = builder.build(
            character_card=_card(),
            skill_rules_excerpt="very long skill rules " * 40,
            memories=memories,
            recent_messages=messages,
        )

        self.assertTrue(result.was_truncated)
        self.assertLessEqual(result.estimated_input_tokens, 80)
        self.assertLess(result.included_memory_count, len(memories))
        self.assertLess(result.included_history_count, len(messages))

    def test_history_keeps_chronological_order_after_tail_selection(self):
        builder = PromptBuilder(token_budget=110)
        messages = (_message(1), _message(2), _message(3), _message(4))
        result = builder.build(
            character_card=_card(),
            skill_rules_excerpt="",
            memories=(),
            recent_messages=messages,
        )

        message_lines = [
            line
            for line in result.user_prompt.splitlines()
            if line.startswith("[user]")
        ]
        self.assertTrue(message_lines)
        self.assertEqual(message_lines, sorted(message_lines, key=lambda line: int(line.split("-")[-1])))


if __name__ == "__main__":
    unittest.main()
