from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelConfig:
    provider: str
    model: str
    api_key_env: str = "ANTHROPIC_API_KEY"
    max_tokens: int = 500
    temperature: float = 0.7


@dataclass(frozen=True)
class CompletionResult:
    text: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
