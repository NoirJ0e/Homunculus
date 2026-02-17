"""Factory for wiring up the complete Homunculus runtime."""

from __future__ import annotations

from typing import Optional
import asyncio
import logging

from homunculus.agent.hotswap import AgentIdentity, AgentIdentityManager
from homunculus.character_card import load_character_card
from homunculus.config.settings import AppSettings, resolve_env_secret
from homunculus.discord.client import DiscordClientService
from homunculus.discord.mention_listener import MentionListener
from homunculus.discord.message_handler import (
    DiscordMessageHandler,
    MultiChannelMessageHandler,
)
from homunculus.discord.recent_messages import RecentMessageCollector
from homunculus.discord.reply_formatter import ReplyFormatter
from homunculus.llm.client import build_llm_client
from homunculus.memory.extractor import MemoryExtractor
from homunculus.memory.qmd_adapter import QmdAdapter
from homunculus.memory.scheduler import QmdIndexScheduler
from homunculus.pipeline.response_pipeline import ResponsePipeline
from homunculus.prompt.builder import PromptBuilder


async def create_discord_service(
    settings: AppSettings,
    *,
    logger: Optional[logging.Logger] = None,
) -> tuple[DiscordClientService, asyncio.Task]:
    """Create a fully wired Discord client service with background tasks."""

    _logger = logger or logging.getLogger("homunculus.factory")

    # Create shared LLM client
    llm_client = build_llm_client(settings, logger=_logger)
    prompt_builder = PromptBuilder(token_budget=2000)
    history_collector = RecentMessageCollector(default_limit=settings.discord.history_size)
    reply_formatter = ReplyFormatter()

    mention_listeners: list[MentionListener] = []
    handlers_by_channel: dict[int, DiscordMessageHandler] = {}
    schedulers_by_namespace: dict[str, QmdIndexScheduler] = {}

    for channel in settings.discord.channels:
        _logger.info(
            "Loading character card for channel_id=%s from %s",
            channel.channel_id,
            channel.character_card_path,
        )
        character_card = load_character_card(channel.character_card_path)
        mention_listener = MentionListener(
            target_channel_id=channel.channel_id,
            bot_user_id=0,
        )
        mention_listeners.append(mention_listener)

        qmd_adapter = QmdAdapter(
            settings,
            namespace=channel.memory_namespace,
            logger=_logger,
        )
        memory_extractor = MemoryExtractor(
            settings=settings,
            llm_client=llm_client,
            namespace=channel.memory_namespace,
            logger=_logger,
        )
        pipeline = ResponsePipeline(
            listener=mention_listener,
            history_collector=history_collector,
            memory_retriever=qmd_adapter,
            prompt_builder=prompt_builder,
            llm_client=llm_client,
            memory_extractor=memory_extractor,
            reply_formatter=reply_formatter,
            history_limit=settings.discord.history_size,
            logger=_logger,
        )
        handlers_by_channel[channel.channel_id] = DiscordMessageHandler(
            character_card=character_card,
            pipeline=pipeline,
            skill_ruleset=channel.skill_ruleset,
            memory_namespace=channel.memory_namespace,
            logger=_logger,
        )

        if channel.memory_namespace not in schedulers_by_namespace:
            _bootstrap_namespace_storage(
                settings=settings,
                namespace=channel.memory_namespace,
            )
            schedulers_by_namespace[channel.memory_namespace] = QmdIndexScheduler(
                settings=settings,
                namespace=channel.memory_namespace,
                logger=_logger,
            )

    message_handler = MultiChannelMessageHandler(
        handlers_by_channel=handlers_by_channel,
        logger=_logger,
    )

    # Resolve Discord bot token
    bot_token = resolve_env_secret(settings.discord.bot_token_env)

    def update_bot_user_id(bot_user_id: int) -> None:
        for listener in mention_listeners:
            listener.update_bot_user_id(bot_user_id)
        _logger.info(
            "Updated mention listener bot_user_id=%s channels=%s",
            bot_user_id,
            len(mention_listeners),
        )

    # Create Discord client service
    discord_service = DiscordClientService(
        bot_token=bot_token,
        target_channel_ids=settings.discord.channel_ids,
        on_message_handler=message_handler,
        on_ready_callback=update_bot_user_id,
        logger=_logger,
    )

    stop_event = asyncio.Event()
    schedulers = tuple(schedulers_by_namespace.values())
    scheduler_task = asyncio.create_task(
        _run_schedulers(schedulers=schedulers, stop_event=stop_event)
    )
    _logger.info(
        "QMD index schedulers started in background namespaces=%s",
        sorted(schedulers_by_namespace.keys()),
    )

    return discord_service, scheduler_task


async def _run_schedulers(
    *,
    schedulers: tuple[QmdIndexScheduler, ...],
    stop_event: asyncio.Event,
) -> None:
    await asyncio.gather(*(scheduler.run_forever(stop_event) for scheduler in schedulers))


def _bootstrap_namespace_storage(*, settings: AppSettings, namespace: str) -> None:
    root = settings.namespace_root(namespace)
    required_dirs = (
        root / "memory" / "memory",
        root / "qmd" / "xdg-config",
        root / "qmd" / "xdg-cache",
    )
    for directory in required_dirs:
        directory.mkdir(parents=True, exist_ok=True)

    memory_file = root / "memory" / "MEMORY.md"
    if not memory_file.exists():
        memory_file.write_text("# MEMORY\n\n", encoding="utf-8")


def create_hotswap_manager(
    settings: AppSettings,
    *,
    logger: Optional[logging.Logger] = None,
) -> AgentIdentityManager:
    """Create hot-swap manager for NPC identity changes."""
    _logger = logger or logging.getLogger("homunculus.factory")
    _logger.debug("Creating hotswap manager for npc_name=%s", settings.agent.npc_name)

    return AgentIdentityManager(
        data_home=settings.runtime.data_home,
        initial_identity=AgentIdentity(
            npc_name=settings.agent.npc_name,
            character_card_path=settings.agent.character_card_path,
            qmd_index=settings.agent.qmd_index,
        ),
    )
