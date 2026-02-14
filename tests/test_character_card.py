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


class CharacterCardTests(unittest.TestCase):
    def test_parse_valid_character_card(self):
        card = parse_character_card(_valid_card_payload())

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


if __name__ == "__main__":
    unittest.main()
