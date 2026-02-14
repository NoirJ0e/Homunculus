from __future__ import annotations

import unittest

from homunculus.llm import InvalidModelConfigError, model_config_from_mapping


class ModelConfigFromMappingTests(unittest.TestCase):
    def test_builds_model_config_with_defaults(self) -> None:
        config = model_config_from_mapping(
            {
                "provider": "anthropic",
                "model": "claude-sonnet-4-5-20250929",
            }
        )

        self.assertEqual(config.provider, "anthropic")
        self.assertEqual(config.model, "claude-sonnet-4-5-20250929")
        self.assertEqual(config.api_key_env, "ANTHROPIC_API_KEY")
        self.assertEqual(config.max_tokens, 500)
        self.assertEqual(config.temperature, 0.7)

    def test_builds_model_config_with_custom_values(self) -> None:
        config = model_config_from_mapping(
            {
                "provider": "anthropic",
                "model": "claude-haiku-4-5-20251001",
                "api_key_env": "NPC_ANTHROPIC_KEY",
                "max_tokens": 128,
                "temperature": 0.1,
            }
        )

        self.assertEqual(config.api_key_env, "NPC_ANTHROPIC_KEY")
        self.assertEqual(config.max_tokens, 128)
        self.assertEqual(config.temperature, 0.1)

    def test_raises_for_missing_provider(self) -> None:
        with self.assertRaises(InvalidModelConfigError):
            model_config_from_mapping({"model": "claude-sonnet-4-5-20250929"})

    def test_raises_for_invalid_max_tokens(self) -> None:
        with self.assertRaises(InvalidModelConfigError):
            model_config_from_mapping(
                {
                    "provider": "anthropic",
                    "model": "claude-sonnet-4-5-20250929",
                    "max_tokens": 0,
                }
            )

    def test_raises_for_invalid_temperature(self) -> None:
        with self.assertRaises(InvalidModelConfigError):
            model_config_from_mapping(
                {
                    "provider": "anthropic",
                    "model": "claude-sonnet-4-5-20250929",
                    "temperature": "warm",
                }
            )


if __name__ == "__main__":
    unittest.main()

