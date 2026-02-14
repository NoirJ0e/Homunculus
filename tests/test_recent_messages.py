from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.discord.recent_messages import RecentMessageCollector


@dataclass
class _SourceMessage:
    message_id: int
    channel_id: int
    author_id: int
    author_name: str
    author_is_bot: bool
    content: str
    created_at: datetime
    mentioned_user_ids: list


class _Provider:
    def __init__(self, messages):
        self._messages = messages
        self.requested_limits = []

    async def get_recent_messages(self, limit: int):
        self.requested_limits.append(limit)
        return list(self._messages)


def _make_message(idx: int, *, is_bot: bool = False, ts: datetime | None = None):
    if ts is None:
        ts = datetime(2026, 2, 14, 9, 0, tzinfo=timezone.utc) + timedelta(minutes=idx)
    return _SourceMessage(
        message_id=idx,
        channel_id=200,
        author_id=1000 + idx,
        author_name=f"user-{idx}",
        author_is_bot=is_bot,
        content=f"message-{idx}",
        created_at=ts,
        mentioned_user_ids=[999, 555, 999],
    )


class RecentMessageCollectorTests(unittest.IsolatedAsyncioTestCase):
    async def test_collect_enforces_default_limit(self):
        collector = RecentMessageCollector(default_limit=3)
        provider = _Provider([_make_message(i) for i in range(1, 10)])

        result = await collector.collect(provider)

        self.assertEqual(provider.requested_limits, [3])
        self.assertEqual([item.message_id for item in result], [7, 8, 9])

    async def test_collect_uses_explicit_limit_override(self):
        collector = RecentMessageCollector(default_limit=25)
        provider = _Provider([_make_message(i) for i in range(1, 10)])

        result = await collector.collect(provider, limit=2)

        self.assertEqual(provider.requested_limits, [2])
        self.assertEqual([item.message_id for item in result], [8, 9])

    async def test_collect_orders_deterministically(self):
        base = datetime(2026, 2, 14, 9, 0, tzinfo=timezone.utc)
        provider = _Provider(
            [
                _make_message(4, ts=base + timedelta(minutes=2)),
                _make_message(2, ts=base + timedelta(minutes=1)),
                _make_message(3, ts=base + timedelta(minutes=1)),
                _make_message(1, ts=base),
            ]
        )
        collector = RecentMessageCollector(default_limit=10)

        result = await collector.collect(provider)

        self.assertEqual([item.message_id for item in result], [1, 2, 3, 4])

    async def test_collect_sets_role_and_normalizes_mentions(self):
        provider = _Provider([_make_message(1), _make_message(2, is_bot=True)])
        collector = RecentMessageCollector(default_limit=10)

        result = await collector.collect(provider)

        self.assertEqual(result[0].role, "user")
        self.assertEqual(result[1].role, "assistant")
        self.assertEqual(result[0].mentioned_user_ids, (555, 999))

    async def test_collect_rejects_invalid_limit(self):
        collector = RecentMessageCollector(default_limit=25)
        provider = _Provider([])

        with self.assertRaises(ValueError):
            await collector.collect(provider, limit=0)


if __name__ == "__main__":
    unittest.main()
