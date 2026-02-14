from __future__ import annotations

from .base import LLMClient
from .factory import create_llm_client
from .types import CompletionResult, ModelConfig


async def complete_prompt(
    prompt: str,
    model_config: ModelConfig,
    client: LLMClient | None = None,
) -> CompletionResult:
    llm_client = client or create_llm_client(model_config)
    return await llm_client.complete(prompt, model_config)

