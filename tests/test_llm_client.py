from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.config.settings import SettingsError, load_settings
from homunculus.llm.client import LlmClientError, LlmRequest, build_llm_client


class _FakeTransport:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def send_messages(self, *, api_key, payload, timeout_seconds):
        self.calls.append(
            {"api_key": api_key, "payload": dict(payload), "timeout_seconds": timeout_seconds}
        )
        return self.response


class LlmClientTests(unittest.IsolatedAsyncioTestCase):
    def _settings(self):
        return load_settings(
            environ={
                "HOMUNCULUS_AGENT_NPC_NAME": "kovach",
                "HOMUNCULUS_AGENT_CHARACTER_CARD_PATH": "./agents/kovach/card.json",
                "HOMUNCULUS_AGENT_QMD_INDEX": "kovach",
                "HOMUNCULUS_DISCORD_CHANNEL_ID": "123456789",
                "HOMUNCULUS_MODEL_NAME": "claude-sonnet-4-5-20250929",
                "HOMUNCULUS_MODEL_MAX_TOKENS": "321",
                "HOMUNCULUS_MODEL_TEMPERATURE": "0.4",
                "HOMUNCULUS_MODEL_TIMEOUT_SECONDS": "9.5",
                "HOMUNCULUS_MODEL_API_KEY_ENV": "ANTHROPIC_KEY",
            }
        )

    async def test_client_uses_model_config_defaults(self):
        transport = _FakeTransport(
            {
                "content": [{"type": "text", "text": "Hello traveler."}],
                "usage": {"input_tokens": 20, "output_tokens": 8},
                "stop_reason": "end_turn",
                "model": "claude-sonnet-4-5-20250929",
            }
        )
        client = build_llm_client(
            self._settings(),
            environ={"ANTHROPIC_KEY": "secret-key"},
            anthropic_transport=transport,
        )
        response = await client.complete(
            LlmRequest(system_prompt="You are npc.", user_prompt="Hi there.")
        )

        self.assertEqual(response.text, "Hello traveler.")
        self.assertEqual(response.input_tokens, 20)
        self.assertEqual(response.output_tokens, 8)
        self.assertEqual(response.stop_reason, "end_turn")

        self.assertEqual(len(transport.calls), 1)
        call = transport.calls[0]
        self.assertEqual(call["api_key"], "secret-key")
        self.assertEqual(call["timeout_seconds"], 9.5)
        self.assertEqual(call["payload"]["model"], "claude-sonnet-4-5-20250929")
        self.assertEqual(call["payload"]["max_tokens"], 321)
        self.assertEqual(call["payload"]["temperature"], 0.4)

    async def test_request_can_override_generation_parameters(self):
        transport = _FakeTransport(
            {
                "content": [{"type": "text", "text": "Override response"}],
                "usage": {"input_tokens": 10, "output_tokens": 4},
                "model": "claude-sonnet-4-5-20250929",
            }
        )
        client = build_llm_client(
            self._settings(),
            environ={"ANTHROPIC_KEY": "secret-key"},
            anthropic_transport=transport,
        )
        await client.complete(
            LlmRequest(
                system_prompt="sys",
                user_prompt="usr",
                max_tokens=77,
                temperature=0.9,
            )
        )

        payload = transport.calls[0]["payload"]
        self.assertEqual(payload["max_tokens"], 77)
        self.assertEqual(payload["temperature"], 0.9)

    def test_build_client_requires_api_key_env(self):
        with self.assertRaises(SettingsError):
            build_llm_client(self._settings(), environ={}, anthropic_transport=_FakeTransport({}))

    async def test_response_without_text_raises_error(self):
        transport = _FakeTransport({"content": [{"type": "tool_use"}]})
        client = build_llm_client(
            self._settings(),
            environ={"ANTHROPIC_KEY": "secret-key"},
            anthropic_transport=transport,
        )

        with self.assertRaises(LlmClientError):
            await client.complete(LlmRequest(system_prompt="sys", user_prompt="usr"))

    async def test_success_log_contains_token_and_cost_metrics(self):
        transport = _FakeTransport(
            {
                "content": [{"type": "text", "text": "metrics"}],
                "usage": {"input_tokens": 25, "output_tokens": 10},
                "model": "claude-sonnet-4-5-20250929",
            }
        )
        client = build_llm_client(
            self._settings(),
            environ={"ANTHROPIC_KEY": "secret-key"},
            anthropic_transport=transport,
        )

        with self.assertLogs("homunculus.llm.client", level="INFO") as logs:
            await client.complete(LlmRequest(system_prompt="sys", user_prompt="usr"))

        self.assertTrue(any("llm_completion_success" in line for line in logs.output), logs.output)
        self.assertTrue(any("input_tokens=25" in line for line in logs.output), logs.output)
        self.assertTrue(any("output_tokens=10" in line for line in logs.output), logs.output)
        self.assertTrue(any("estimated_cost_usd=" in line for line in logs.output), logs.output)


if __name__ == "__main__":
    unittest.main()
