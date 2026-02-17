"""Message handler bridge between Discord client and response pipeline."""

from __future__ import annotations

from typing import Mapping, Optional, Protocol
import logging

from homunculus.character_card import CharacterCard
from homunculus.discord.client import ChannelSender, MessageLike
from homunculus.pipeline.response_pipeline import ResponsePipeline


class DiscordMessageHandler:
    """Bridges Discord messages to the response pipeline."""

    def __init__(
        self,
        *,
        character_card: CharacterCard,
        pipeline: ResponsePipeline,
        skill_ruleset: str = "coc7e",
        memory_namespace: Optional[str] = None,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self._character_card = character_card
        self._pipeline = pipeline
        self._skill_ruleset = skill_ruleset
        self._memory_namespace = memory_namespace.strip() if memory_namespace else None
        self._logger = logger or logging.getLogger("homunculus.discord.handler")

    async def handle(
        self,
        *,
        message: MessageLike,
        history_provider: "DiscordHistoryProvider",
        sender: ChannelSender,
    ) -> None:
        """Handle a Discord message through the response pipeline."""
        self._logger.info(
            f"DiscordMessageHandler.handle called: channel={message.channel_id}, "
            f"author_id={message.author_id}, is_bot={message.author_is_bot}, "
            f"mentions={message.mentioned_user_ids}"
        )
        
        # Add checkmark reaction to acknowledge receipt
        message_id = getattr(message, "message_id", None)
        if message_id is not None:
            await sender.add_reaction(message_id, "✅")
        
        # Start typing indicator
        await sender.start_typing()
        
        try:
            outcome = await self._pipeline.on_message(
                message=message,
                history_provider=history_provider,
                sender=sender,
                character_card=self._character_card,
                skill_ruleset=self._skill_ruleset,
                npc_name=self._character_card.name,
                memory_namespace=self._memory_namespace,
            )

            self._logger.info(
                f"Pipeline outcome: handled={outcome.handled}, sent={outcome.sent}, error={outcome.error_type}"
            )
            
            if outcome.handled:
                self._logger.debug(
                    "Message handled: message_id=%s sent=%s error=%s",
                    message_id,
                    outcome.sent,
                    outcome.error_type,
                )
        finally:
            # Always stop typing when done
            await sender.stop_typing()


class RoutedMessageHandler(Protocol):
    async def handle(
        self,
        *,
        message: MessageLike,
        history_provider: "DiscordHistoryProvider",
        sender: ChannelSender,
    ) -> None:
        ...


class MultiChannelMessageHandler:
    """Routes incoming Discord messages to a channel-specific handler."""

    def __init__(
        self,
        *,
        handlers_by_channel: Mapping[int, RoutedMessageHandler],
        logger: Optional[logging.Logger] = None,
    ) -> None:
        if not handlers_by_channel:
            raise ValueError("handlers_by_channel cannot be empty.")
        self._handlers_by_channel = dict(handlers_by_channel)
        self._logger = logger or logging.getLogger("homunculus.discord.multi_handler")

    async def handle(
        self,
        *,
        message: MessageLike,
        history_provider: "DiscordHistoryProvider",
        sender: ChannelSender,
    ) -> None:
        handler = self._handlers_by_channel.get(message.channel_id)
        if handler is None:
            self._logger.warning(
                "Message received for unconfigured channel_id=%s",
                message.channel_id,
            )
            return
        await handler.handle(
            message=message,
            history_provider=history_provider,
            sender=sender,
        )
