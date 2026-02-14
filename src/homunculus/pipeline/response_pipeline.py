"""End-to-end mention-to-reply response pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Optional, Protocol, Sequence
import logging

from homunculus.character_card import CharacterCard
from homunculus.discord.mention_listener import MentionListener, MessageLike
from homunculus.discord.recent_messages import (
    ChannelHistoryProvider,
    RecentMessage,
    RecentMessageCollector,
)
from homunculus.llm.client import LlmClient, LlmClientError, LlmRequest
from homunculus.memory.qmd_adapter import RetrievalResult
from homunculus.prompt.builder import PromptBuilder


class MemoryRetriever(Protocol):
    async def retrieve(
        self,
        query: str,
        *,
        npc_name: Optional[str] = None,
        top_k: Optional[int] = None,
    ) -> RetrievalResult:
        ...


class ChannelSender(Protocol):
    async def send_message(self, content: str) -> None:
        ...


class MemoryExtractionScheduler(Protocol):
    def schedule_extraction(
        self,
        *,
        recent_messages: Sequence[RecentMessage],
        response_text: str,
        npc_name: str,
    ) -> object:
        ...


SceneQueryBuilder = Callable[[Sequence[RecentMessage]], str]


@dataclass(frozen=True)
class PipelineOutcome:
    handled: bool
    sent: bool
    retrieval_mode: Optional[str]
    retrieval_error_type: Optional[str]
    prompt_tokens: int
    error_type: Optional[str]


class ResponsePipeline:
    """Coordinates retrieval, generation, and send steps for mention triggers."""

    def __init__(
        self,
        *,
        listener: MentionListener,
        history_collector: RecentMessageCollector,
        memory_retriever: MemoryRetriever,
        prompt_builder: PromptBuilder,
        llm_client: LlmClient,
        memory_extractor: MemoryExtractionScheduler | None = None,
        scene_query_builder: SceneQueryBuilder | None = None,
        history_limit: int = 25,
        logger: logging.Logger | None = None,
    ) -> None:
        if history_limit <= 0:
            raise ValueError("history_limit must be a positive integer.")

        self._listener = listener
        self._history_collector = history_collector
        self._memory_retriever = memory_retriever
        self._prompt_builder = prompt_builder
        self._llm_client = llm_client
        self._memory_extractor = memory_extractor
        self._scene_query_builder = scene_query_builder or _default_scene_query_builder
        self._history_limit = history_limit
        self._logger = logger or logging.getLogger("homunculus.pipeline.response")

    async def on_message(
        self,
        *,
        message: MessageLike,
        history_provider: ChannelHistoryProvider,
        sender: ChannelSender,
        character_card: CharacterCard,
        skill_rules_excerpt: str,
        npc_name: Optional[str] = None,
    ) -> PipelineOutcome:
        if not self._listener.should_respond(message):
            return PipelineOutcome(
                handled=False,
                sent=False,
                retrieval_mode=None,
                retrieval_error_type=None,
                prompt_tokens=0,
                error_type=None,
            )

        try:
            recent_messages = await self._history_collector.collect(
                history_provider,
                limit=self._history_limit,
            )
        except Exception as exc:  # pragma: no cover - defensive guard
            self._logger.exception("history_collection_failed")
            return PipelineOutcome(
                handled=True,
                sent=False,
                retrieval_mode=None,
                retrieval_error_type=None,
                prompt_tokens=0,
                error_type=exc.__class__.__name__,
            )

        retrieval = await self._retrieve_memories(recent_messages=recent_messages, npc_name=npc_name)
        memories = retrieval.records if retrieval.error is None else ()
        retrieval_error_type = retrieval.error.type if retrieval.error is not None else None

        prompt = self._prompt_builder.build(
            character_card=character_card,
            skill_rules_excerpt=skill_rules_excerpt,
            memories=memories,
            recent_messages=recent_messages,
        )

        try:
            response = await self._llm_client.complete(
                LlmRequest(
                    system_prompt=prompt.system_prompt,
                    user_prompt=prompt.user_prompt,
                )
            )
        except LlmClientError as exc:
            self._logger.warning("llm_completion_failed error_type=%s", exc.__class__.__name__)
            return PipelineOutcome(
                handled=True,
                sent=False,
                retrieval_mode=retrieval.mode,
                retrieval_error_type=retrieval_error_type,
                prompt_tokens=prompt.estimated_input_tokens,
                error_type=exc.__class__.__name__,
            )

        try:
            await sender.send_message(response.text)
        except Exception as exc:  # pragma: no cover - defensive guard
            self._logger.exception("send_message_failed")
            return PipelineOutcome(
                handled=True,
                sent=False,
                retrieval_mode=retrieval.mode,
                retrieval_error_type=retrieval_error_type,
                prompt_tokens=prompt.estimated_input_tokens,
                error_type=exc.__class__.__name__,
            )

        if self._memory_extractor is not None:
            try:
                self._memory_extractor.schedule_extraction(
                    recent_messages=recent_messages,
                    response_text=response.text,
                    npc_name=(npc_name or character_card.name),
                )
            except Exception as exc:  # pragma: no cover - defensive guard
                self._logger.warning(
                    "memory_extraction_schedule_failed error_type=%s",
                    exc.__class__.__name__,
                )

        self._logger.info(
            "response_pipeline_success retrieval_mode=%s retrieval_error_type=%s prompt_tokens=%s",
            retrieval.mode,
            retrieval_error_type,
            prompt.estimated_input_tokens,
        )
        return PipelineOutcome(
            handled=True,
            sent=True,
            retrieval_mode=retrieval.mode,
            retrieval_error_type=retrieval_error_type,
            prompt_tokens=prompt.estimated_input_tokens,
            error_type=None,
        )

    async def _retrieve_memories(
        self,
        *,
        recent_messages: Sequence[RecentMessage],
        npc_name: Optional[str],
    ) -> RetrievalResult:
        query = self._scene_query_builder(recent_messages)
        return await self._memory_retriever.retrieve(query, npc_name=npc_name)


def _default_scene_query_builder(recent_messages: Sequence[RecentMessage]) -> str:
    if not recent_messages:
        return "recent ttrpg conversation context"

    selected = recent_messages[-5:]
    parts = [message.content.strip() for message in selected if message.content.strip()]
    query = " | ".join(parts).strip()
    if len(query) > 280:
        return query[:280].rstrip()
    return query if query else "recent ttrpg conversation context"
