import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.config.settings import SettingsError, load_settings, resolve_env_secret


class SettingsLoaderTests(unittest.TestCase):
    def _minimal_env(self):
        return {
            "HOMUNCULUS_AGENT_NPC_NAME": "kovach",
            "HOMUNCULUS_AGENT_CHARACTER_CARD_PATH": "./agents/kovach/card.json",
            "HOMUNCULUS_AGENT_QMD_INDEX": "kovach",
            "HOMUNCULUS_DISCORD_CHANNEL_ID": "123456789",
            "HOMUNCULUS_MODEL_NAME": "claude-sonnet-4-5-20250929",
        }

    def test_loads_required_settings_from_environment(self):
        settings = load_settings(environ=self._minimal_env())

        self.assertEqual(settings.agent.npc_name, "kovach")
        self.assertEqual(settings.agent.qmd_index, "kovach")
        self.assertEqual(settings.discord.channel_id, 123456789)
        self.assertEqual(settings.model.provider, "anthropic")
        self.assertEqual(settings.discord.history_size, 25)

    def test_environment_overrides_config_file(self):
        config = {
            "agent": {
                "npc_name": "file_npc",
                "character_card_path": "./card.json",
                "qmd_index": "file_qmd",
            },
            "discord": {"channel_id": 100},
            "model": {"name": "claude-sonnet-4-5-20250929"},
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")

            settings = load_settings(
                config_path=config_path,
                environ={"HOMUNCULUS_DISCORD_CHANNEL_ID": "222"},
            )

        self.assertEqual(settings.discord.channel_id, 222)
        self.assertEqual(settings.agent.npc_name, "file_npc")

    def test_invalid_integer_raises_settings_error(self):
        env = self._minimal_env()
        env["HOMUNCULUS_DISCORD_CHANNEL_ID"] = "not-an-int"

        with self.assertRaises(SettingsError):
            load_settings(environ=env)

    def test_missing_required_setting_raises_settings_error(self):
        env = self._minimal_env()
        del env["HOMUNCULUS_MODEL_NAME"]

        with self.assertRaises(SettingsError):
            load_settings(environ=env)

    def test_resolve_env_secret(self):
        secret = resolve_env_secret("DISCORD_BOT_TOKEN", {"DISCORD_BOT_TOKEN": "token"})
        self.assertEqual(secret, "token")


if __name__ == "__main__":
    unittest.main()
