"""Recent message collection for prompt context."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, Sequence, Tuple


class SourceMessage(Protocol):
    """Message contract expected by the collector."""

    message_id: int
    channel_id: int
    author_id: int
    author_name: str
    author_is_bot: bool
    content: str
    created_at: datetime
    mentioned_user_ids: Sequence[int]


class ChannelHistoryProvider(Protocol):
    """Async source used to fetch recent channel messages."""

    async def get_recent_messages(self, limit: int) -> Sequence[SourceMessage]:
        ...


@dataclass(frozen=True)
class RecentMessage:
    message_id: int
    channel_id: int
    author_id: int
    author_name: str
    role: str
    content: str
    created_at: datetime
    mentioned_user_ids: Tuple[int, ...]


@dataclass(frozen=True)
class RecentMessageCollector:
    """Collects and normalizes the channel context window."""

    default_limit: int = 25

    def __post_init__(self) -> None:
        if self.default_limit <= 0:
            raise ValueError("default_limit must be a positive integer.")

    async def collect(
        self,
        provider: ChannelHistoryProvider,
        *,
        limit: int | None = None,
    ) -> Tuple[RecentMessage, ...]:
        effective_limit = self.default_limit if limit is None else limit
        if effective_limit <= 0:
            raise ValueError("limit must be a positive integer.")

        raw_messages = await provider.get_recent_messages(effective_limit)
        ordered = sorted(
            raw_messages,
            key=lambda message: (message.created_at, message.message_id),
        )
        window = ordered[-effective_limit:]
        normalized = []
        for message in window:
            normalized.append(
                RecentMessage(
                    message_id=message.message_id,
                    channel_id=message.channel_id,
                    author_id=message.author_id,
                    author_name=message.author_name,
                    role="assistant" if message.author_is_bot else "user",
                    content=message.content,
                    created_at=message.created_at,
                    mentioned_user_ids=tuple(sorted(set(message.mentioned_user_ids))),
                )
            )
        return tuple(normalized)
