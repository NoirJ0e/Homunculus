from __future__ import annotations


class LLMError(Exception):
    """Base error for LLM provider failures."""


class UnsupportedProviderError(LLMError):
    """Raised when a provider is not supported by a client or factory."""


class MissingAPIKeyError(LLMError):
    """Raised when a required API key env var is missing."""


class ProviderSDKMissingError(LLMError):
    """Raised when the provider SDK is not installed."""


class InvalidModelConfigError(LLMError):
    """Raised when model configuration payload is invalid."""
