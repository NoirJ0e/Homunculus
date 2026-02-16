from __future__ import annotations

from .anthropic_adapter import AnthropicClientAdapter
from .openai_adapter import OpenAIClientAdapter
from .base import LLMClient
from .errors import UnsupportedProviderError
from .types import ModelConfig


def create_llm_client(model_config: ModelConfig) -> LLMClient:
    provider = model_config.provider.lower()
    if provider == "anthropic":
        return AnthropicClientAdapter()
    if provider in ("openai", "openclaw"):
        return OpenAIClientAdapter()
    raise UnsupportedProviderError(f"Unsupported provider '{model_config.provider}'.")
