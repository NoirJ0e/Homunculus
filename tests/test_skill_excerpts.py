from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.skills import SkillExcerptError, list_supported_rulesets, load_skill_excerpt


class SkillExcerptTests(unittest.TestCase):
    def test_supported_rulesets_are_stable(self) -> None:
        self.assertEqual(list_supported_rulesets(), ("coc7e", "dnd5e"))

    def test_load_coc7e_excerpt(self) -> None:
        excerpt = load_skill_excerpt("coc7e")
        self.assertIn("CoC 7e Quick Excerpt", excerpt)

    def test_load_dnd5e_excerpt(self) -> None:
        excerpt = load_skill_excerpt("dnd5e")
        self.assertIn("DnD 5e Quick Excerpt", excerpt)

    def test_invalid_ruleset_returns_controlled_error(self) -> None:
        with self.assertRaises(SkillExcerptError):
            load_skill_excerpt("pf2e")

    def test_excerpt_is_capped_when_max_chars_is_small(self) -> None:
        excerpt = load_skill_excerpt("coc7e", max_chars=32)
        self.assertTrue(excerpt.endswith("..."))
        self.assertLessEqual(len(excerpt), 35)

    def test_non_positive_max_chars_is_rejected(self) -> None:
        with self.assertRaises(SkillExcerptError):
            load_skill_excerpt("coc7e", max_chars=0)


if __name__ == "__main__":
    unittest.main()
