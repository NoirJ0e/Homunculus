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
from homunculus.discord.reply_formatter import ReplyFormatter
from homunculus.llm.client import LlmClient, LlmClientError, LlmRequest
from homunculus.memory.qmd_adapter import RetrievalResult
from homunculus.observability import estimate_completion_cost_usd
from homunculus.prompt.builder import PromptBuilder
from homunculus.skills import SkillExcerptError, load_skill_excerpt


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
        memory_namespace: Optional[str] = None,
    ) -> object:
        ...


class ReplyFormatterLike(Protocol):
    def format_reply(self, *, npc_name: str, response_text: str) -> str:
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
        reply_formatter: ReplyFormatterLike | None = None,
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
        self._reply_formatter = reply_formatter or ReplyFormatter()
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
        skill_rules_excerpt: str = "",
        skill_ruleset: Optional[str] = None,
        npc_name: Optional[str] = None,
        memory_namespace: Optional[str] = None,
    ) -> PipelineOutcome:
        should_respond = self._listener.should_respond(message)
        self._logger.info(
            f"MentionListener check: should_respond={should_respond}, "
            f"target_channel={self._listener.target_channel_id}, msg_channel={message.channel_id}, "
            f"bot_user_id={self._listener.bot_user_id}, author_id={message.author_id}, "
            f"author_is_bot={message.author_is_bot}, mentions={message.mentioned_user_ids}"
        )
        
        if not should_respond:
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

        retrieval = await self._retrieve_memories(
            recent_messages=recent_messages,
            npc_name=npc_name,
            memory_namespace=memory_namespace,
        )
        memories = retrieval.records if retrieval.error is None else ()
        retrieval_error_type = retrieval.error.type if retrieval.error is not None else None

        effective_skill_rules_excerpt = skill_rules_excerpt
        if not effective_skill_rules_excerpt.strip() and skill_ruleset is not None:
            try:
                effective_skill_rules_excerpt = load_skill_excerpt(skill_ruleset)
            except SkillExcerptError as exc:
                self._logger.warning(
                    "skill_excerpt_load_failed ruleset=%s error_type=%s",
                    skill_ruleset,
                    exc.__class__.__name__,
                )
                effective_skill_rules_excerpt = ""

        prompt = self._prompt_builder.build(
            character_card=character_card,
            skill_rules_excerpt=effective_skill_rules_excerpt,
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
            self._logger.exception(f"llm_completion_failed: {exc}")
            return PipelineOutcome(
                handled=True,
                sent=False,
                retrieval_mode=retrieval.mode,
                retrieval_error_type=retrieval_error_type,
                prompt_tokens=prompt.estimated_input_tokens,
                error_type=exc.__class__.__name__,
            )

        try:
            response_text = self._reply_formatter.format_reply(
                npc_name=(npc_name or character_card.name),
                response_text=response.text,
            )
            await sender.send_message(response_text)
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
                    memory_namespace=memory_namespace,
                )
            except Exception as exc:  # pragma: no cover - defensive guard
                self._logger.warning(
                    "memory_extraction_schedule_failed error_type=%s",
                    exc.__class__.__name__,
                )

        estimated_cost_usd = estimate_completion_cost_usd(
            model=response.model,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
        )
        self._logger.info(
            "response_pipeline_success retrieval_mode=%s retrieval_error_type=%s prompt_tokens=%s llm_model=%s llm_input_tokens=%s llm_output_tokens=%s llm_estimated_cost_usd=%s",
            retrieval.mode,
            retrieval_error_type,
            prompt.estimated_input_tokens,
            response.model,
            response.input_tokens,
            response.output_tokens,
            estimated_cost_usd,
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
        memory_namespace: Optional[str],
    ) -> RetrievalResult:
        query = self._scene_query_builder(recent_messages)
        return await self._memory_retriever.retrieve(
            query,
            npc_name=(memory_namespace or npc_name),
        )


def _default_scene_query_builder(recent_messages: Sequence[RecentMessage]) -> str:
    if not recent_messages:
        return "recent ttrpg conversation context"

    selected = recent_messages[-5:]
    parts = [message.content.strip() for message in selected if message.content.strip()]
    query = " | ".join(parts).strip()
    if len(query) > 280:
        return query[:280].rstrip()
    return query if query else "recent ttrpg conversation context"
