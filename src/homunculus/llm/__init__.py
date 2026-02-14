"""LLM client abstractions and adapters."""

from homunculus.llm.client import LlmClient, LlmClientError, LlmRequest, LlmResponse, build_llm_client

from .anthropic_adapter import AnthropicClientAdapter
from .base import LLMClient
from .config import model_config_from_mapping
from .errors import (
    InvalidModelConfigError,
    LLMError,
    MissingAPIKeyError,
    ProviderSDKMissingError,
    UnsupportedProviderError,
)
from .factory import create_llm_client
from .service import complete_prompt
from .types import CompletionResult, ModelConfig

__all__ = [
    "AnthropicClientAdapter",
    "CompletionResult",
    "InvalidModelConfigError",
    "LLMClient",
    "LLMError",
    "LlmClient",
    "LlmClientError",
    "LlmRequest",
    "LlmResponse",
    "MissingAPIKeyError",
    "ModelConfig",
    "ProviderSDKMissingError",
    "UnsupportedProviderError",
    "build_llm_client",
    "complete_prompt",
    "create_llm_client",
    "model_config_from_mapping",
]
