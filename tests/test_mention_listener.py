import asyncio
from dataclasses import dataclass
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.discord.mention_listener import MentionListener


@dataclass
class _Message:
    channel_id: int
    author_id: int
    author_is_bot: bool
    mentioned_user_ids: list


class MentionListenerTests(unittest.IsolatedAsyncioTestCase):
    def test_should_respond_only_when_mentioned_in_target_channel(self):
        listener = MentionListener(target_channel_id=200, bot_user_id=999)

        self.assertFalse(
            listener.should_respond(
                _Message(
                    channel_id=201,
                    author_id=100,
                    author_is_bot=False,
                    mentioned_user_ids=[999],
                )
            )
        )
        self.assertFalse(
            listener.should_respond(
                _Message(
                    channel_id=200,
                    author_id=100,
                    author_is_bot=False,
                    mentioned_user_ids=[123],
                )
            )
        )
        self.assertTrue(
            listener.should_respond(
                _Message(
                    channel_id=200,
                    author_id=100,
                    author_is_bot=False,
                    mentioned_user_ids=[999, 123],
                )
            )
        )

    def test_should_not_respond_to_bot_or_self_messages(self):
        listener = MentionListener(target_channel_id=200, bot_user_id=999)

        self.assertFalse(
            listener.should_respond(
                _Message(
                    channel_id=200,
                    author_id=100,
                    author_is_bot=True,
                    mentioned_user_ids=[999],
                )
            )
        )
        self.assertFalse(
            listener.should_respond(
                _Message(
                    channel_id=200,
                    author_id=999,
                    author_is_bot=False,
                    mentioned_user_ids=[999],
                )
            )
        )

    async def test_handle_if_triggered_calls_handler_once(self):
        listener = MentionListener(target_channel_id=200, bot_user_id=999)
        message = _Message(
            channel_id=200,
            author_id=100,
            author_is_bot=False,
            mentioned_user_ids=[999],
        )

        calls = []

        async def _handler(msg):
            calls.append(msg.author_id)

        handled = await listener.handle_if_triggered(message, _handler)

        self.assertTrue(handled)
        self.assertEqual(calls, [100])

    async def test_handle_if_triggered_skips_unmatched_message(self):
        listener = MentionListener(target_channel_id=200, bot_user_id=999)
        message = _Message(
            channel_id=200,
            author_id=100,
            author_is_bot=False,
            mentioned_user_ids=[],
        )

        event = asyncio.Event()

        async def _handler(_msg):
            event.set()

        handled = await listener.handle_if_triggered(message, _handler)

        self.assertFalse(handled)
        self.assertFalse(event.is_set())


if __name__ == "__main__":
    unittest.main()
