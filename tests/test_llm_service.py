from __future__ import annotations

import unittest
from unittest.mock import patch

from homunculus.llm import CompletionResult, ModelConfig, complete_prompt
from homunculus.llm.base import LLMClient


class _RecordingClient(LLMClient):
    def __init__(self) -> None:
        self.calls: list[tuple[str, ModelConfig]] = []

    async def complete(self, prompt: str, model_config: ModelConfig) -> CompletionResult:
        self.calls.append((prompt, model_config))
        return CompletionResult(text="ok", model=model_config.model)


class CompletePromptTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_injected_client_when_provided(self) -> None:
        config = ModelConfig(provider="anthropic", model="claude-sonnet-4-5-20250929")
        client = _RecordingClient()

        result = await complete_prompt("hello", config, client=client)

        self.assertEqual(result.text, "ok")
        self.assertEqual(result.model, config.model)
        self.assertEqual(client.calls, [("hello", config)])

    async def test_uses_factory_when_client_not_provided(self) -> None:
        config = ModelConfig(provider="anthropic", model="claude-sonnet-4-5-20250929")
        factory_client = _RecordingClient()

        with patch("homunculus.llm.service.create_llm_client", return_value=factory_client):
            result = await complete_prompt("hello", config)

        self.assertEqual(result.text, "ok")
        self.assertEqual(factory_client.calls, [("hello", config)])


if __name__ == "__main__":
    unittest.main()

