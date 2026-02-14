from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Awaitable, Callable, Optional, Protocol, Sequence

if TYPE_CHECKING:
    import discord


class UserLike(Protocol):
    id: int
    bot: bool


class ChannelLike(Protocol):
    id: int


class MessageLike(Protocol):
    author: UserLike
    channel: ChannelLike
    content: str
    mentions: Sequence[UserLike]


MentionHandler = Callable[[MessageLike], Awaitable[None]]
BotUserIdProvider = Callable[[], Optional[int]]


@dataclass(frozen=True)
class MentionRouterConfig:
    channel_id: int
    ignore_bot_authors: bool = True


class MentionRouter:
    """Decides whether a Discord message should trigger NPC handling."""

    def __init__(self, config: MentionRouterConfig) -> None:
        if config.channel_id <= 0:
            raise ValueError("channel_id must be a positive integer")
        self._config = config

    def should_dispatch(self, message: MessageLike, bot_user_id: Optional[int]) -> bool:
        if bot_user_id is None:
            return False

        if self._config.ignore_bot_authors and message.author.bot:
            return False

        if message.channel.id != self._config.channel_id:
            return False

        return self._is_bot_mentioned(message=message, bot_user_id=bot_user_id)

    @staticmethod
    def _is_bot_mentioned(message: MessageLike, bot_user_id: int) -> bool:
        for mentioned_user in getattr(message, "mentions", ()):
            if getattr(mentioned_user, "id", None) == bot_user_id:
                return True

        content = getattr(message, "content", "") or ""
        return f"<@{bot_user_id}>" in content or f"<@!{bot_user_id}>" in content


class MentionListener:
    """Routes message events to a mention handler when routing rules pass."""

    def __init__(
        self,
        router: MentionRouter,
        bot_user_id_provider: BotUserIdProvider,
        mention_handler: MentionHandler,
    ) -> None:
        self._router = router
        self._bot_user_id_provider = bot_user_id_provider
        self._mention_handler = mention_handler

    async def handle_message(self, message: MessageLike) -> bool:
        bot_user_id = self._bot_user_id_provider()
        if not self._router.should_dispatch(message=message, bot_user_id=bot_user_id):
            return False

        await self._mention_handler(message)
        return True


def create_discord_client(
    *,
    channel_id: int,
    mention_handler: MentionHandler,
    intents: Optional["discord.Intents"] = None,
) -> "discord.Client":
    import discord

    router = MentionRouter(MentionRouterConfig(channel_id=channel_id))
    selected_intents = intents if intents is not None else discord.Intents.default()
    if intents is None:
        selected_intents.message_content = True

    class HomunculusDiscordClient(discord.Client):
        async def on_message(self, message: "discord.Message") -> None:
            await listener.handle_message(message)

    client = HomunculusDiscordClient(intents=selected_intents)
    listener = MentionListener(
        router=router,
        bot_user_id_provider=lambda: None if client.user is None else int(client.user.id),
        mention_handler=mention_handler,
    )
    return client


def run_discord_client(client: "discord.Client", token: str) -> None:
    # discord.py handles gateway reconnects when reconnect=True.
    client.run(token, reconnect=True)

