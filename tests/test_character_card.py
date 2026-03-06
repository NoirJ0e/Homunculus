import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.character_card import (
    CharacterCardValidationError,
    load_character_card,
    parse_character_card,
)


def _valid_card_payload():
    return {
        "system": "coc7e",
        "name": "Kovach",
        "description": "A quiet veteran with an old scar over his left eye.",
        "personality": "Cautious and loyal.",
        "background": "Retired soldier now running a small store.",
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
        "skills": {
            "Firearms (Handgun)": 55,
            "Brawl": 60,
            "Spot Hidden": 45,
        },
        "inventory": ["Old revolver", "Military canteen", "Worn coat"],
    }


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


class CharacterCardTests(unittest.TestCase):
    def test_parse_valid_character_card(self):
        card = parse_character_card(_valid_card_payload())

        self.assertEqual(card.system, "coc7e")
        self.assertEqual(card.name, "Kovach")
        self.assertEqual(card.stats["STR"], 65)
        self.assertEqual(card.skills["Brawl"], 60)
        self.assertEqual(card.inventory, ("Old revolver", "Military canteen", "Worn coat"))

    def test_validation_error_contains_deterministic_issues(self):
        payload = _valid_card_payload()
        payload["name"] = ""
        payload["stats"]["STR"] = 110
        payload["stats"]["XX"] = 1
        payload["inventory"][1] = ""
        payload["unexpected"] = True
        del payload["background"]

        with self.assertRaises(CharacterCardValidationError) as ctx:
            parse_character_card(payload)

        issues = [(item.field, item.code) for item in ctx.exception.issues]
        self.assertEqual(
            issues,
            [
                ("background", "missing_field"),
                ("inventory[1]", "empty_string"),
                ("name", "empty_string"),
                ("stats.STR", "out_of_range"),
                ("stats.XX", "unknown_field"),
                ("unexpected", "unknown_field"),
            ],
        )

    def test_load_character_card_reports_invalid_json(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "card.json"
            path.write_text("{invalid-json", encoding="utf-8")

            with self.assertRaises(CharacterCardValidationError) as ctx:
                load_character_card(path)

            self.assertEqual(ctx.exception.issues[0].code, "invalid_json")

    def test_load_character_card_from_file(self):
        payload = _valid_card_payload()
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "card.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            card = load_character_card(path)

        self.assertEqual(card.name, "Kovach")
        self.assertEqual(card.stats["HP"], 14)

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


if __name__ == "__main__":
    unittest.main()
