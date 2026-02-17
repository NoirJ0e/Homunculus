"""Discord client service wrapping discord.py."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Optional, Protocol, Sequence
import asyncio
import logging

try:
    import discord
except ImportError:
    discord = None  # type: ignore


class MessageLike(Protocol):
    """Minimal message contract for pipeline trigger logic."""

    channel_id: int
    author_id: int
    author_is_bot: bool
    mentioned_user_ids: Sequence[int]


class SourceMessage(Protocol):
    """Message contract for recent history collection."""

    message_id: int
    channel_id: int
    author_id: int
    author_name: str
    author_is_bot: bool
    content: str
    created_at: datetime
    mentioned_user_ids: Sequence[int]


class ChannelSender(Protocol):
    """Protocol for sending messages to Discord."""

    async def send_message(self, content: str) -> None:
        ...
    
    async def add_reaction(self, message_id: int, emoji: str) -> None:
        """Add a reaction emoji to a message."""
        ...
    
    async def start_typing(self) -> None:
        """Start typing indicator in the channel."""
        ...
    
    async def stop_typing(self) -> None:
        """Stop typing indicator (no-op, handled by context manager)."""
        ...


class OnMessageHandler(Protocol):
    """Handler invoked on each incoming message."""

    async def handle(
        self,
        *,
        message: MessageLike,
        history_provider: "DiscordHistoryProvider",
        sender: ChannelSender,
    ) -> None:
        ...


@dataclass(frozen=True)
class DiscordMessage:
    """Adapter from discord.Message to our internal protocols."""

    message_id: int
    channel_id: int
    author_id: int
    author_name: str
    author_is_bot: bool
    content: str
    created_at: datetime
    mentioned_user_ids: tuple[int, ...]


class DiscordHistoryProvider:
    """Provides recent channel history via discord.py."""

    def __init__(self, channel: "discord.TextChannel") -> None:
        self._channel = channel

    async def get_recent_messages(self, limit: int) -> Sequence[DiscordMessage]:
        messages = []
        async for msg in self._channel.history(limit=limit):
            messages.append(
                DiscordMessage(
                    message_id=msg.id,
                    channel_id=msg.channel.id,
                    author_id=msg.author.id,
                    author_name=msg.author.display_name,
                    author_is_bot=msg.author.bot,
                    content=msg.content,
                    created_at=msg.created_at,
                    mentioned_user_ids=tuple(user.id for user in msg.mentions),
                )
            )
        return messages


class DiscordChannelSender:
    """Sends messages to a Discord channel."""

    def __init__(self, channel: "discord.TextChannel", logger: Optional[logging.Logger] = None) -> None:
        self._channel = channel
        self._logger = logger or logging.getLogger("homunculus.discord.sender")
        self._typing_task: Optional[asyncio.Task] = None

    async def send_message(self, content: str) -> None:
        await self._channel.send(content)
    
    async def add_reaction(self, message_id: int, emoji: str) -> None:
        """Add a reaction emoji to a message."""
        try:
            message = await self._channel.fetch_message(message_id)
            await message.add_reaction(emoji)
        except Exception as e:
            self._logger.warning(f"Failed to add reaction: {e}")
    
    async def start_typing(self) -> None:
        """Start typing indicator in the channel."""
        # Discord typing indicator lasts ~10 seconds, we need to keep refreshing
        async def _keep_typing():
            while True:
                async with self._channel.typing():
                    await asyncio.sleep(8)  # Refresh every 8 seconds
        
        if self._typing_task is None or self._typing_task.done():
            self._typing_task = asyncio.create_task(_keep_typing())
    
    async def stop_typing(self) -> None:
        """Stop typing indicator."""
        if self._typing_task is not None and not self._typing_task.done():
            self._typing_task.cancel()
            try:
                await self._typing_task
            except asyncio.CancelledError:
                pass
            self._typing_task = None


class DiscordClientService:
    """Discord bot service that bridges discord.py events to Homunculus pipeline."""

    def __init__(
        self,
        *,
        bot_token: str,
        target_channel_id: Optional[int] = None,
        target_channel_ids: Optional[Sequence[int]] = None,
        on_message_handler: OnMessageHandler,
        on_ready_callback: Optional[Callable[[int], None]] = None,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        if discord is None:
            raise RuntimeError(
                "discord.py is not installed. Install with: pip install discord.py"
            )

        self._bot_token = bot_token
        normalized_channel_ids = []
        if target_channel_ids:
            normalized_channel_ids.extend(target_channel_ids)
        if target_channel_id is not None:
            normalized_channel_ids.append(target_channel_id)
        if not normalized_channel_ids:
            raise ValueError("At least one target channel ID is required.")

        validated_channel_ids = set()
        for channel_id in normalized_channel_ids:
            if int(channel_id) <= 0:
                raise ValueError("target_channel_ids must contain positive integers.")
            validated_channel_ids.add(int(channel_id))

        self._target_channel_ids = frozenset(validated_channel_ids)
        self._handler = on_message_handler
        self._on_ready_callback = on_ready_callback
        self._logger = logger or logging.getLogger("homunculus.discord.client")

        intents = discord.Intents.default()
        intents.message_content = True
        intents.messages = True
        intents.guilds = True
        intents.guild_messages = True
        
        self._logger.info(
            "Intents: message_content=%s, messages=%s, guilds=%s",
            intents.message_content,
            intents.messages,
            intents.guilds,
        )
        
        self._client = discord.Client(intents=intents)

        self._ready_event = asyncio.Event()
        self._target_channels: dict[int, discord.TextChannel] = {}
        self._task: Optional[asyncio.Task] = None

        # Register event handlers using decorator syntax
        self._logger.info("Registering Discord event handlers...")
        
        @self._client.event
        async def on_ready():
            await self._on_ready()

        @self._client.event
        async def on_message(message):
            await self._on_message(message)

    async def start(self) -> None:
        """Start the Discord client in the background."""
        self._task = asyncio.create_task(self._client.start(self._bot_token))
        await self._ready_event.wait()
        self._logger.info(
            "Discord client ready: bot_user_id=%s target_channel_ids=%s",
            self._client.user.id if self._client.user else None,
            sorted(self._target_channel_ids),
        )

    async def stop(self) -> None:
        """Stop the Discord client gracefully."""
        await self._client.close()
        if self._task is not None:
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _on_ready(self) -> None:
        """Called when the bot successfully connects to Discord."""
        self._logger.info("Discord client connected as %s", self._client.user)

        for channel_id in sorted(self._target_channel_ids):
            channel = self._client.get_channel(channel_id)
            if channel is None:
                self._logger.error(
                    "Target channel %s not found or bot lacks access.",
                    channel_id,
                )
                continue
            if not isinstance(channel, discord.TextChannel):
                self._logger.error(
                    "Target channel %s is not a text channel.",
                    channel_id,
                )
                continue
            self._target_channels[channel_id] = channel
            self._logger.info("Target channel acquired: id=%s name=%s", channel_id, channel.name)
        
        # Invoke ready callback with bot user ID
        if self._on_ready_callback is not None and self._client.user is not None:
            try:
                self._on_ready_callback(self._client.user.id)
            except Exception:
                self._logger.exception("on_ready_callback failed")

        self._ready_event.set()

    async def _on_message(self, message: discord.Message) -> None:
        """Handle incoming Discord messages."""
        try:
            if message.channel.id not in self._target_channel_ids:
                return

            # Collect user mentions + role mentions (for bots that have same-named roles)
            mentioned_ids = set(user.id for user in message.mentions)
            if message.role_mentions:
                bot_user = self._client.user
                if bot_user:
                    for role in message.role_mentions:
                        if role.name == bot_user.name or role.name == bot_user.display_name:
                            mentioned_ids.add(bot_user.id)

            internal_message = DiscordMessage(
                message_id=message.id,
                channel_id=message.channel.id,
                author_id=message.author.id,
                author_name=message.author.display_name,
                author_is_bot=message.author.bot,
                content=message.content,
                created_at=message.created_at,
                mentioned_user_ids=tuple(mentioned_ids),
            )

            channel = self._target_channels.get(message.channel.id)
            if channel is None and isinstance(message.channel, discord.TextChannel):
                channel = message.channel
                self._target_channels[message.channel.id] = channel
            if channel is None:
                self._logger.warning(
                    "Skipping message for target channel_id=%s because channel is unavailable.",
                    message.channel.id,
                )
                return

            history_provider = DiscordHistoryProvider(channel)
            sender = DiscordChannelSender(channel, logger=self._logger)

            await self._handler.handle(
                message=internal_message,
                history_provider=history_provider,
                sender=sender,
            )
        except Exception:
            self._logger.exception("Message handler failed")
