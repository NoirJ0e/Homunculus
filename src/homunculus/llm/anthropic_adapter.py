from __future__ import annotations

import os
from typing import Any, Callable

from .base import LLMClient
from .errors import MissingAPIKeyError, ProviderSDKMissingError, UnsupportedProviderError
from .types import CompletionResult, ModelConfig


class AnthropicClientAdapter(LLMClient):
    def __init__(
        self,
        client: Any | None = None,
        client_factory: Callable[..., Any] | None = None,
        get_env: Callable[[str], str | None] = os.getenv,
    ) -> None:
        self._client = client
        self._client_factory = client_factory or self._default_client_factory
        self._get_env = get_env

    async def complete(self, prompt: str, model_config: ModelConfig) -> CompletionResult:
        if model_config.provider.lower() != "anthropic":
            raise UnsupportedProviderError(
                f"Unsupported provider '{model_config.provider}' for AnthropicClientAdapter."
            )

        client = self._client or self._build_client(model_config)
        response = await client.messages.create(
            model=model_config.model,
            max_tokens=model_config.max_tokens,
            temperature=model_config.temperature,
            messages=[{"role": "user", "content": prompt}],
        )

        usage = getattr(response, "usage", None)
        return CompletionResult(
            text=self._extract_text(response),
            model=model_config.model,
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )

    def _build_client(self, model_config: ModelConfig) -> Any:
        api_key = self._get_env(model_config.api_key_env)
        if not api_key:
            raise MissingAPIKeyError(
                f"Missing Anthropic API key in environment variable '{model_config.api_key_env}'."
            )
        self._client = self._client_factory(api_key=api_key)
        return self._client

    @staticmethod
    def _default_client_factory(*, api_key: str) -> Any:
        try:
            from anthropic import AsyncAnthropic
        except ImportError as exc:
            raise ProviderSDKMissingError(
                "anthropic SDK is required to use AnthropicClientAdapter."
            ) from exc
        return AsyncAnthropic(api_key=api_key)

    @staticmethod
    def _extract_text(response: Any) -> str:
        content = getattr(response, "content", None)
        if not content:
            return ""

        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    parts.append(block["text"])
                continue

            if getattr(block, "type", None) == "text":
                text = getattr(block, "text", None)
                if isinstance(text, str):
                    parts.append(text)

        return "".join(parts)
