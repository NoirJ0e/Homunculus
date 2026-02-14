"""Mention filtering and listener orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Protocol, Sequence


class MessageLike(Protocol):
    """Minimal message contract used by mention filtering logic."""

    channel_id: int
    author_id: int
    author_is_bot: bool
    mentioned_user_ids: Sequence[int]


MentionHandler = Callable[[MessageLike], Awaitable[None]]


@dataclass(frozen=True)
class MentionListener:
    """Filters messages to only the target channel + bot mention trigger."""

    target_channel_id: int
    bot_user_id: int

    def __post_init__(self) -> None:
        if self.target_channel_id <= 0:
            raise ValueError("target_channel_id must be a positive integer.")
        if self.bot_user_id <= 0:
            raise ValueError("bot_user_id must be a positive integer.")

    def should_respond(self, message: MessageLike) -> bool:
        if message.channel_id != self.target_channel_id:
            return False
        if message.author_is_bot:
            return False
        if message.author_id == self.bot_user_id:
            return False
        return self.bot_user_id in set(message.mentioned_user_ids)

    async def handle_if_triggered(self, message: MessageLike, handler: MentionHandler) -> bool:
        if not self.should_respond(message):
            return False

        await handler(message)
        return True
