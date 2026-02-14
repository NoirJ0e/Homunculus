from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.discord.reply_formatter import ReplyFormatter, ReplyTemplateSettings


class ReplyFormatterTests(unittest.TestCase):
    def test_formats_in_character_reply(self) -> None:
        formatter = ReplyFormatter()
        self.assertEqual(
            formatter.format_reply(npc_name="Kovach", response_text="Stay behind me."),
            "**Kovach:** Stay behind me.",
        )

    def test_trims_name_and_content(self) -> None:
        formatter = ReplyFormatter()
        self.assertEqual(
            formatter.format_reply(npc_name="  Kovach ", response_text="  Move now.  "),
            "**Kovach:** Move now.",
        )

    def test_falls_back_to_generic_speaker(self) -> None:
        formatter = ReplyFormatter()
        self.assertEqual(
            formatter.format_reply(npc_name=" ", response_text="Unknown source."),
            "**NPC:** Unknown source.",
        )

    def test_optional_ooc_notice_is_appended(self) -> None:
        formatter = ReplyFormatter(
            ReplyTemplateSettings(include_ooc_notice=True, ooc_notice="Roleplay simulation.")
        )
        self.assertEqual(
            formatter.format_reply(npc_name="Kovach", response_text="We leave now."),
            "**Kovach:** We leave now.\n\n_OOC: Roleplay simulation._",
        )

    def test_empty_ooc_notice_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ReplyTemplateSettings(include_ooc_notice=True, ooc_notice=" ")


if __name__ == "__main__":
    unittest.main()
