"""Factory for wiring up the complete Homunculus runtime."""

from __future__ import annotations

from typing import Optional
import asyncio
import logging

from homunculus.agent.hotswap import AgentIdentityManager
from homunculus.character_card import load_character_card
from homunculus.config.settings import AppSettings, resolve_env_secret
from homunculus.discord.client import DiscordClientService
from homunculus.discord.mention_listener import MentionListener
from homunculus.discord.message_handler import DiscordMessageHandler
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
    
    # Load character card
    _logger.info("Loading character card from %s", settings.agent.character_card_path)
    character_card = load_character_card(settings.agent.character_card_path)
    
    # Create LLM client (needed by both extractor and pipeline)
    llm_client = build_llm_client(settings, logger=_logger)
    
    # Create memory components
    qmd_adapter = QmdAdapter(settings, logger=_logger)
    memory_extractor = MemoryExtractor(
        settings=settings,
        llm_client=llm_client,
        logger=_logger,
    )
    qmd_scheduler = QmdIndexScheduler(
        settings=settings,
        logger=_logger,
    )
    
    # Create prompt builder
    prompt_builder = PromptBuilder(token_budget=2000)
    
    # Create pipeline components
    mention_listener = MentionListener(
        target_channel_id=settings.discord.channel_id,
        bot_user_id=0,  # Will be updated after Discord connects
    )
    history_collector = RecentMessageCollector(
        default_limit=settings.discord.history_size
    )
    reply_formatter = ReplyFormatter()
    
    # Create response pipeline
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
    
    # Create message handler
    message_handler = DiscordMessageHandler(
        character_card=character_card,
        pipeline=pipeline,
        skill_ruleset=settings.agent.skill_ruleset,
        logger=_logger,
    )
    
    # Resolve Discord bot token
    bot_token = resolve_env_secret(settings.discord.bot_token_env)
    
    # Create callback to update bot_user_id when Discord connects
    def update_bot_user_id(bot_user_id: int) -> None:
        mention_listener.update_bot_user_id(bot_user_id)
        _logger.info("Updated mention listener bot_user_id=%s", bot_user_id)
    
    # Create Discord client service
    discord_service = DiscordClientService(
        bot_token=bot_token,
        target_channel_id=settings.discord.channel_id,
        on_message_handler=message_handler,
        on_ready_callback=update_bot_user_id,
        logger=_logger,
    )
    
    # Start memory maintenance scheduler in background
    stop_event = asyncio.Event()
    scheduler_task = asyncio.create_task(
        qmd_scheduler.run_forever(stop_event, npc_name=settings.agent.npc_name)
    )
    _logger.info("QMD index scheduler started in background.")
    
    return discord_service, scheduler_task


def create_hotswap_manager(
    settings: AppSettings,
    *,
    logger: Optional[logging.Logger] = None,
) -> AgentIdentityManager:
    """Create hot-swap manager for NPC identity changes."""
    _logger = logger or logging.getLogger("homunculus.factory")
    
    return AgentIdentityManager(
        data_home=settings.runtime.data_home,
        logger=_logger,
    )
