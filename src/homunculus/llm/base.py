from __future__ import annotations

from abc import ABC, abstractmethod

from .types import CompletionResult, ModelConfig


class LLMClient(ABC):
    @abstractmethod
    async def complete(self, prompt: str, model_config: ModelConfig) -> CompletionResult:
        """Generate a completion for the given prompt."""

