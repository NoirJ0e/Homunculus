from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.character_card import parse_character_card
from homunculus.discord.message_handler import DiscordMessageHandler, MultiChannelMessageHandler


@dataclass
class _Message:
    message_id: int
    channel_id: int
    author_id: int
    author_is_bot: bool
    mentioned_user_ids: list[int]


class _Sender:
    def __init__(self) -> None:
        self.reactions: list[tuple[int, str]] = []
        self.started = 0
        self.stopped = 0

    async def send_message(self, _content: str) -> None:
        return None

    async def add_reaction(self, message_id: int, emoji: str) -> None:
        self.reactions.append((message_id, emoji))

    async def start_typing(self) -> None:
        self.started += 1

    async def stop_typing(self) -> None:
        self.stopped += 1


class _Pipeline:
    def __init__(self) -> None:
        self.calls = []

    async def on_message(self, **kwargs):
        self.calls.append(kwargs)
        return type(
            "PipelineOutcome",
            (),
            {"handled": True, "sent": True, "error_type": None},
        )()


class _HistoryProvider:
    async def get_recent_messages(self, _limit: int):
        return []


def _card():
    return parse_character_card(
        {
            "name": "Kovach",
            "description": "A scarred veteran.",
            "personality": "Cautious and loyal.",
            "background": "Runs a small store after the war.",
            "stats": {
                "STR": 65,
                "CON": 70,
                "DEX": 55,
                "INT": 50,
                "POW": 60,
                "APP": 40,
                "SIZ": 75,
                "EDU": 45,
                "HP": 14,
                "SAN": 52,
                "MP": 12,
            },
            "skills": {"Brawl": 60},
            "inventory": ["Revolver"],
        }
    )


class _RoutingHandler:
    def __init__(self) -> None:
        self.calls: list[int] = []

    async def handle(self, *, message, history_provider, sender) -> None:
        _ = history_provider
        _ = sender
        self.calls.append(message.channel_id)


class MessageHandlerTests(unittest.IsolatedAsyncioTestCase):
    async def test_discord_message_handler_passes_memory_namespace(self):
        pipeline = _Pipeline()
        handler = DiscordMessageHandler(
            character_card=_card(),
            pipeline=pipeline,
            memory_namespace="kovach-campaign-a",
        )

        sender = _Sender()
        await handler.handle(
            message=_Message(
                message_id=42,
                channel_id=200,
                author_id=100,
                author_is_bot=False,
                mentioned_user_ids=[999],
            ),
            history_provider=_HistoryProvider(),
            sender=sender,
        )

        self.assertEqual(sender.reactions, [(42, "✅")])
        self.assertEqual(sender.started, 1)
        self.assertEqual(sender.stopped, 1)
        self.assertEqual(len(pipeline.calls), 1)
        self.assertEqual(pipeline.calls[0]["npc_name"], "Kovach")
        self.assertEqual(pipeline.calls[0]["memory_namespace"], "kovach-campaign-a")

    async def test_multi_channel_handler_routes_by_channel_id(self):
        handler_a = _RoutingHandler()
        handler_b = _RoutingHandler()
        router = MultiChannelMessageHandler(
            handlers_by_channel={
                200: handler_a,
                201: handler_b,
            }
        )

        await router.handle(
            message=_Message(
                message_id=1,
                channel_id=201,
                author_id=100,
                author_is_bot=False,
                mentioned_user_ids=[],
            ),
            history_provider=_HistoryProvider(),
            sender=_Sender(),
        )

        self.assertEqual(handler_a.calls, [])
        self.assertEqual(handler_b.calls, [201])

    async def test_multi_channel_handler_ignores_unknown_channel(self):
        handler_a = _RoutingHandler()
        router = MultiChannelMessageHandler(
            handlers_by_channel={
                200: handler_a,
            }
        )

        with self.assertLogs("homunculus.discord.multi_handler", level="WARNING") as logs:
            await router.handle(
                message=_Message(
                    message_id=2,
                    channel_id=999,
                    author_id=101,
                    author_is_bot=False,
                    mentioned_user_ids=[],
                ),
                history_provider=_HistoryProvider(),
                sender=_Sender(),
            )

        self.assertEqual(handler_a.calls, [])
        self.assertTrue(
            any("unconfigured channel_id=999" in line for line in logs.output),
            logs.output,
        )


if __name__ == "__main__":
    unittest.main()
