"""Discord client service wrapping discord.py."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Protocol, Sequence
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

    def __init__(self, channel: "discord.TextChannel") -> None:
        self._channel = channel

    async def send_message(self, content: str) -> None:
        await self._channel.send(content)


class DiscordClientService:
    """Discord bot service that bridges discord.py events to Homunculus pipeline."""

    def __init__(
        self,
        *,
        bot_token: str,
        target_channel_id: int,
        on_message_handler: OnMessageHandler,
        on_ready_callback: Optional[callable] = None,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        if discord is None:
            raise RuntimeError(
                "discord.py is not installed. Install with: pip install discord.py"
            )

        self._bot_token = bot_token
        self._target_channel_id = target_channel_id
        self._handler = on_message_handler
        self._on_ready_callback = on_ready_callback
        self._logger = logger or logging.getLogger("homunculus.discord.client")

        intents = discord.Intents.default()
        intents.message_content = True
        intents.messages = True
        intents.guilds = True
        intents.guild_messages = True
        
        self._logger.info(f"Intents: message_content={intents.message_content}, messages={intents.messages}, guilds={intents.guilds}")
        
        self._client = discord.Client(intents=intents)

        self._ready_event = asyncio.Event()
        self._target_channel: Optional[discord.TextChannel] = None
        self._task: Optional[asyncio.Task] = None

        # Register event handlers using decorator syntax
        self._logger.info("Registering Discord event handlers...")
        
        @self._client.event
        async def on_ready():
            self._logger.info("EVENT: on_ready triggered!")
            await self._on_ready()

        @self._client.event
        async def on_message(message):
            self._logger.info(f"EVENT: on_message from={message.author} channel={message.channel.id}")
            await self._on_message(message)
        
        self._logger.info("Discord event handlers registered")

    async def start(self) -> None:
        """Start the Discord client in the background."""
        self._task = asyncio.create_task(self._client.start(self._bot_token))
        await self._ready_event.wait()
        self._logger.info(
            "Discord client ready: bot_user_id=%s target_channel_id=%s",
            self._client.user.id if self._client.user else None,
            self._target_channel_id,
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
        print(f"[DEBUG] _on_ready triggered! Bot user: {self._client.user}")
        self._logger.info("Discord client connected as %s", self._client.user)
        
        # Fetch target channel
        channel = self._client.get_channel(self._target_channel_id)
        if channel is None:
            self._logger.error(
                "Target channel %s not found or bot lacks access.",
                self._target_channel_id,
            )
        elif not isinstance(channel, discord.TextChannel):
            self._logger.error(
                "Target channel %s is not a text channel.",
                self._target_channel_id,
            )
        else:
            self._target_channel = channel
            self._logger.info("Target channel acquired: %s", channel.name)
        
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
            self._logger.info(
                f"_on_message: channel={message.channel.id}, author={message.author}, "
                f"content='{message.content}', mentions={[u.id for u in message.mentions]}, "
                f"role_mentions={[r.id for r in message.role_mentions]}, "
                f"raw_mentions={message.raw_mentions}"
            )
            
            if self._target_channel is None:
                self._logger.warning("Target channel not set, ignoring message")
                return

            self._logger.info(f"Converting message to internal format...")
            
            # Collect user mentions + role mentions (for bots that have same-named roles)
            mentioned_ids = set(user.id for user in message.mentions)
            
            # If bot has a same-named role, role mentions should also trigger
            # Check if any role mentions match the bot's username pattern
            if message.role_mentions:
                bot_user = self._client.user
                if bot_user:
                    for role in message.role_mentions:
                        # If role name matches bot name, treat as bot mention
                        if role.name == bot_user.name or role.name == bot_user.display_name:
                            mentioned_ids.add(bot_user.id)
                            self._logger.info(f"Role mention '{role.name}' treated as bot mention")
            
            # Convert discord.Message to our internal format
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

            self._logger.info(f"Creating providers...")
            # Create providers for this message
            history_provider = DiscordHistoryProvider(self._target_channel)
            sender = DiscordChannelSender(self._target_channel)

            self._logger.info(f"Invoking handler...")
            # Invoke handler
            await self._handler.handle(
                message=internal_message,
                history_provider=history_provider,
                sender=sender,
            )
            self._logger.info("Handler completed successfully")
        except Exception as e:
            self._logger.exception(f"Message handler failed: {e}")
