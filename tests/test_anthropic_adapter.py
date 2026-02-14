from __future__ import annotations

import unittest
from dataclasses import dataclass

from homunculus.llm import (
    AnthropicClientAdapter,
    MissingAPIKeyError,
    ModelConfig,
    UnsupportedProviderError,
    create_llm_client,
)


@dataclass
class _FakeUsage:
    input_tokens: int
    output_tokens: int


@dataclass
class _FakeContentBlock:
    type: str
    text: str


class _FakeResponse:
    def __init__(self, content=None) -> None:
        self.content = content
        self.usage = _FakeUsage(input_tokens=12, output_tokens=34)


class _FakeMessages:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._response


class _FakeClient:
    def __init__(self, response: _FakeResponse) -> None:
        self.messages = _FakeMessages(response)


class AnthropicClientAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_complete_injects_model_config(self) -> None:
        fake_client = _FakeClient(
            _FakeResponse(
                content=[
                    _FakeContentBlock(type="text", text="Hello "),
                    {"type": "text", "text": "world"},
                ]
            )
        )
        adapter = AnthropicClientAdapter(client=fake_client)
        config = ModelConfig(
            provider="anthropic",
            model="claude-sonnet-4-5-20250929",
            max_tokens=321,
            temperature=0.2,
        )

        result = await adapter.complete("Test prompt", config)

        self.assertEqual(result.text, "Hello world")
        self.assertEqual(result.model, config.model)
        self.assertEqual(result.input_tokens, 12)
        self.assertEqual(result.output_tokens, 34)
        self.assertEqual(len(fake_client.messages.calls), 1)

        call = fake_client.messages.calls[0]
        self.assertEqual(call["model"], config.model)
        self.assertEqual(call["max_tokens"], config.max_tokens)
        self.assertEqual(call["temperature"], config.temperature)
        self.assertEqual(
            call["messages"],
            [{"role": "user", "content": "Test prompt"}],
        )

    async def test_complete_builds_client_with_api_key_from_config_env(self) -> None:
        captured: dict[str, str] = {}
        fake_client = _FakeClient(
            _FakeResponse(content=[_FakeContentBlock(type="text", text="ok")])
        )

        def client_factory(*, api_key: str):
            captured["api_key"] = api_key
            return fake_client

        env_values = {"NPC_ANTHROPIC_KEY": "secret-key"}
        adapter = AnthropicClientAdapter(
            client_factory=client_factory,
            get_env=env_values.get,
        )
        config = ModelConfig(
            provider="anthropic",
            model="claude-haiku-4-5-20251001",
            api_key_env="NPC_ANTHROPIC_KEY",
        )

        await adapter.complete("Ping", config)

        self.assertEqual(captured["api_key"], "secret-key")
        self.assertEqual(len(fake_client.messages.calls), 1)

    async def test_complete_rejects_non_anthropic_provider(self) -> None:
        adapter = AnthropicClientAdapter(
            client=_FakeClient(_FakeResponse(content=[{"type": "text", "text": "ok"}]))
        )
        config = ModelConfig(provider="openai", model="gpt-4o")

        with self.assertRaises(UnsupportedProviderError):
            await adapter.complete("Ping", config)

    async def test_complete_raises_on_missing_api_key(self) -> None:
        adapter = AnthropicClientAdapter(
            client_factory=lambda **_: _FakeClient(
                _FakeResponse(content=[{"type": "text", "text": "ok"}])
            )
        )
        config = ModelConfig(
            provider="anthropic",
            model="claude-haiku-4-5-20251001",
            api_key_env="MISSING_KEY",
        )

        with self.assertRaises(MissingAPIKeyError):
            await adapter.complete("Ping", config)

    def test_factory_returns_anthropic_adapter(self) -> None:
        client = create_llm_client(ModelConfig(provider="anthropic", model="x"))
        self.assertIsInstance(client, AnthropicClientAdapter)

    def test_factory_rejects_unsupported_provider(self) -> None:
        with self.assertRaises(UnsupportedProviderError):
            create_llm_client(ModelConfig(provider="unsupported", model="x"))

    def test_extract_text_returns_empty_for_missing_content(self) -> None:
        text = AnthropicClientAdapter._extract_text(_FakeResponse(content=None))
        self.assertEqual(text, "")

    def test_extract_text_ignores_non_text_blocks(self) -> None:
        response = _FakeResponse(
            content=[
                {"type": "tool_use", "id": "x"},
                _FakeContentBlock(type="text", text="hello"),
                {"type": "text", "text": " world"},
            ]
        )
        text = AnthropicClientAdapter._extract_text(response)
        self.assertEqual(text, "hello world")


if __name__ == "__main__":
    unittest.main()
