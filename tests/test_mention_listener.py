from __future__ import annotations

import unittest
from dataclasses import dataclass, field
from typing import List

from homunculus.discord.mention_listener import (
    MentionListener,
    MentionRouter,
    MentionRouterConfig,
)


@dataclass
class StubUser:
    id: int
    bot: bool = False


@dataclass
class StubChannel:
    id: int


@dataclass
class StubMessage:
    author: StubUser
    channel: StubChannel
    content: str = ""
    mentions: List[StubUser] = field(default_factory=list)


class MentionRouterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.router = MentionRouter(MentionRouterConfig(channel_id=12345))

    def test_dispatches_for_configured_channel_and_direct_mention(self) -> None:
        message = StubMessage(
            author=StubUser(id=1, bot=False),
            channel=StubChannel(id=12345),
            mentions=[StubUser(id=99, bot=True)],
        )

        self.assertTrue(self.router.should_dispatch(message=message, bot_user_id=99))

    def test_rejects_when_message_not_in_configured_channel(self) -> None:
        message = StubMessage(
            author=StubUser(id=1, bot=False),
            channel=StubChannel(id=777),
            mentions=[StubUser(id=99, bot=True)],
        )

        self.assertFalse(self.router.should_dispatch(message=message, bot_user_id=99))

    def test_rejects_when_bot_not_mentioned(self) -> None:
        message = StubMessage(
            author=StubUser(id=1, bot=False),
            channel=StubChannel(id=12345),
            mentions=[StubUser(id=17, bot=False)],
        )

        self.assertFalse(self.router.should_dispatch(message=message, bot_user_id=99))

    def test_rejects_bot_authors_by_default(self) -> None:
        message = StubMessage(
            author=StubUser(id=22, bot=True),
            channel=StubChannel(id=12345),
            mentions=[StubUser(id=99, bot=True)],
        )

        self.assertFalse(self.router.should_dispatch(message=message, bot_user_id=99))

    def test_accepts_raw_mention_pattern(self) -> None:
        message = StubMessage(
            author=StubUser(id=1, bot=False),
            channel=StubChannel(id=12345),
            content="hello <@99>",
        )

        self.assertTrue(self.router.should_dispatch(message=message, bot_user_id=99))

    def test_accepts_raw_nickname_mention_pattern(self) -> None:
        message = StubMessage(
            author=StubUser(id=1, bot=False),
            channel=StubChannel(id=12345),
            content="hello <@!99>",
        )

        self.assertTrue(self.router.should_dispatch(message=message, bot_user_id=99))

    def test_rejects_when_bot_user_id_not_ready(self) -> None:
        message = StubMessage(
            author=StubUser(id=1, bot=False),
            channel=StubChannel(id=12345),
            mentions=[StubUser(id=99, bot=True)],
        )

        self.assertFalse(self.router.should_dispatch(message=message, bot_user_id=None))

    def test_allows_bot_authors_when_configured(self) -> None:
        router = MentionRouter(
            MentionRouterConfig(channel_id=12345, ignore_bot_authors=False)
        )
        message = StubMessage(
            author=StubUser(id=22, bot=True),
            channel=StubChannel(id=12345),
            mentions=[StubUser(id=99, bot=True)],
        )

        self.assertTrue(router.should_dispatch(message=message, bot_user_id=99))

    def test_rejects_non_positive_channel_id(self) -> None:
        with self.assertRaises(ValueError):
            MentionRouter(MentionRouterConfig(channel_id=0))


class MentionListenerTest(unittest.IsolatedAsyncioTestCase):
    async def test_calls_handler_when_router_matches(self) -> None:
        router = MentionRouter(MentionRouterConfig(channel_id=12345))
        handled_messages: List[StubMessage] = []

        async def handler(message: StubMessage) -> None:
            handled_messages.append(message)

        listener = MentionListener(
            router=router,
            bot_user_id_provider=lambda: 99,
            mention_handler=handler,
        )
        message = StubMessage(
            author=StubUser(id=1, bot=False),
            channel=StubChannel(id=12345),
            mentions=[StubUser(id=99, bot=True)],
        )

        result = await listener.handle_message(message)
        self.assertTrue(result)
        self.assertEqual([message], handled_messages)

    async def test_skips_handler_when_router_does_not_match(self) -> None:
        router = MentionRouter(MentionRouterConfig(channel_id=12345))
        handled_messages: List[StubMessage] = []

        async def handler(message: StubMessage) -> None:
            handled_messages.append(message)

        listener = MentionListener(
            router=router,
            bot_user_id_provider=lambda: 99,
            mention_handler=handler,
        )
        message = StubMessage(
            author=StubUser(id=1, bot=False),
            channel=StubChannel(id=777),
            mentions=[StubUser(id=99, bot=True)],
        )

        result = await listener.handle_message(message)
        self.assertFalse(result)
        self.assertEqual([], handled_messages)
