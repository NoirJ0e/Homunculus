from __future__ import annotations

import os
from typing import Any, Callable

from .base import LLMClient
from .errors import MissingAPIKeyError, ProviderSDKMissingError, UnsupportedProviderError
from .types import CompletionResult, ModelConfig


class OpenAIClientAdapter(LLMClient):
    """
    Adapter for OpenAI-compatible endpoints (including OpenClaw's /v1/chat/completions).
    
    Supports:
    - base_url: Custom API endpoint (e.g., http://127.0.0.1:18789/v1)
    - Standard OpenAI SDK interface
    """

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
        if model_config.provider.lower() not in ("openai", "openclaw"):
            raise UnsupportedProviderError(
                f"Unsupported provider '{model_config.provider}' for OpenAIClientAdapter."
            )

        client = self._client or self._build_client(model_config)
        response = await client.chat.completions.create(
            model=model_config.model,
            max_tokens=model_config.max_tokens,
            temperature=model_config.temperature,
            messages=[{"role": "user", "content": prompt}],
        )

        usage = getattr(response, "usage", None)
        choice = response.choices[0] if response.choices else None
        message = choice.message if choice else None
        text = message.content if message else ""

        return CompletionResult(
            text=text or "",
            model=model_config.model,
            input_tokens=getattr(usage, "prompt_tokens", None) if usage else None,
            output_tokens=getattr(usage, "completion_tokens", None) if usage else None,
        )

    def _build_client(self, model_config: ModelConfig) -> Any:
        api_key = self._get_env(model_config.api_key_env)
        if not api_key:
            raise MissingAPIKeyError(
                f"Missing API key in environment variable '{model_config.api_key_env}'."
            )

        # Support custom base_url for OpenClaw and other compatible endpoints
        base_url = getattr(model_config, "base_url", None)
        kwargs = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url

        self._client = self._client_factory(**kwargs)
        return self._client

    @staticmethod
    def _default_client_factory(**kwargs: Any) -> Any:
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:
            raise ProviderSDKMissingError(
                "openai SDK is required to use OpenAIClientAdapter."
            ) from exc
        return AsyncOpenAI(**kwargs)
