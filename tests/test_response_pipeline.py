from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.character_card import parse_character_card
from homunculus.discord.mention_listener import MentionListener
from homunculus.discord.recent_messages import RecentMessageCollector
from homunculus.llm.client import LlmClientError, LlmRequest, LlmResponse
from homunculus.memory.qmd_adapter import MemoryRecord, RetrievalError, RetrievalResult
from homunculus.pipeline.response_pipeline import ResponsePipeline
from homunculus.prompt.builder import PromptBuilder


@dataclass
class _IncomingMessage:
    channel_id: int
    author_id: int
    author_is_bot: bool
    mentioned_user_ids: list


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


class _HistoryProvider:
    def __init__(self, messages):
        self.messages = messages

    async def get_recent_messages(self, limit: int):
        return self.messages[:limit]


class _MemoryRetriever:
    def __init__(self, result: RetrievalResult):
        self.result = result
        self.queries = []

    async def retrieve(self, query: str, *, npc_name=None, top_k=None):
        self.queries.append((query, npc_name, top_k))
        return self.result


class _LlmClient:
    def __init__(self, text: str = "reply", should_fail: bool = False):
        self.text = text
        self.should_fail = should_fail
        self.requests = []

    async def complete(self, request: LlmRequest):
        self.requests.append(request)
        if self.should_fail:
            raise LlmClientError("synthetic failure")
        return LlmResponse(
            text=self.text,
            model="claude",
            stop_reason="end_turn",
            input_tokens=100,
            output_tokens=20,
        )


class _Sender:
    def __init__(self):
        self.messages = []

    async def send_message(self, content: str):
        self.messages.append(content)


class _Extractor:
    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail
        self.calls = []

    def schedule_extraction(
        self,
        *,
        recent_messages,
        response_text,
        npc_name,
        memory_namespace=None,
    ):
        if self.should_fail:
            raise RuntimeError("schedule failed")
        self.calls.append((tuple(recent_messages), response_text, npc_name, memory_namespace))


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


def _provider():
    return _HistoryProvider(
        [
            _SourceMessage(
                message_id=1,
                channel_id=200,
                author_id=11,
                author_name="joe",
                author_is_bot=False,
                content="Where were you last night?",
                created_at=datetime(2026, 2, 14, 12, 0, tzinfo=timezone.utc),
                mentioned_user_ids=[999],
            ),
            _SourceMessage(
                message_id=2,
                channel_id=200,
                author_id=12,
                author_name="kp",
                author_is_bot=False,
                content="We are near the old church.",
                created_at=datetime(2026, 2, 14, 12, 1, tzinfo=timezone.utc),
                mentioned_user_ids=[],
            ),
        ]
    )


class ResponsePipelineTests(unittest.IsolatedAsyncioTestCase):
    def _pipeline(self, *, retriever, llm_client, extractor=None):
        return ResponsePipeline(
            listener=MentionListener(target_channel_id=200, bot_user_id=999),
            history_collector=RecentMessageCollector(default_limit=25),
            memory_retriever=retriever,
            prompt_builder=PromptBuilder(token_budget=500),
            llm_client=llm_client,
            memory_extractor=extractor,
        )

    async def test_triggered_message_runs_full_pipeline_and_sends_reply(self):
        retriever = _MemoryRetriever(
            RetrievalResult(
                records=(MemoryRecord(text="You met Joe before.", source="MEMORY.md", score=0.8, mode="query"),),
                mode="query",
                used_fallback=False,
                error=None,
            )
        )
        llm = _LlmClient(text="I was at the shop.")
        sender = _Sender()
        pipeline = self._pipeline(retriever=retriever, llm_client=llm)

        outcome = await pipeline.on_message(
            message=_IncomingMessage(
                channel_id=200,
                author_id=100,
                author_is_bot=False,
                mentioned_user_ids=[999],
            ),
            history_provider=_provider(),
            sender=sender,
            character_card=_card(),
            skill_rules_excerpt="CoC excerpt",
        )

        self.assertTrue(outcome.handled)
        self.assertTrue(outcome.sent)
        self.assertEqual(outcome.retrieval_mode, "query")
        self.assertIsNone(outcome.error_type)
        self.assertEqual(sender.messages, ["**Kovach:** I was at the shop."])
        self.assertEqual(len(retriever.queries), 1)
        self.assertEqual(len(llm.requests), 1)

    async def test_unmatched_message_is_ignored(self):
        retriever = _MemoryRetriever(
            RetrievalResult(records=(), mode=None, used_fallback=False, error=None)
        )
        llm = _LlmClient()
        sender = _Sender()
        pipeline = self._pipeline(retriever=retriever, llm_client=llm)

        outcome = await pipeline.on_message(
            message=_IncomingMessage(
                channel_id=200,
                author_id=100,
                author_is_bot=False,
                mentioned_user_ids=[],
            ),
            history_provider=_provider(),
            sender=sender,
            character_card=_card(),
            skill_rules_excerpt="",
        )

        self.assertFalse(outcome.handled)
        self.assertFalse(outcome.sent)
        self.assertEqual(sender.messages, [])
        self.assertEqual(len(retriever.queries), 0)
        self.assertEqual(len(llm.requests), 0)

    async def test_memory_failure_does_not_block_reply(self):
        retriever = _MemoryRetriever(
            RetrievalResult(
                records=(),
                mode=None,
                used_fallback=True,
                error=RetrievalError(type="both_failed", message="failed"),
            )
        )
        llm = _LlmClient(text="Fallback reply.")
        sender = _Sender()
        pipeline = self._pipeline(retriever=retriever, llm_client=llm)

        outcome = await pipeline.on_message(
            message=_IncomingMessage(
                channel_id=200,
                author_id=100,
                author_is_bot=False,
                mentioned_user_ids=[999],
            ),
            history_provider=_provider(),
            sender=sender,
            character_card=_card(),
            skill_rules_excerpt="",
        )

        self.assertTrue(outcome.handled)
        self.assertTrue(outcome.sent)
        self.assertEqual(outcome.retrieval_error_type, "both_failed")
        self.assertEqual(sender.messages, ["**Kovach:** Fallback reply."])

    async def test_llm_failure_returns_controlled_outcome(self):
        retriever = _MemoryRetriever(
            RetrievalResult(records=(), mode="search", used_fallback=True, error=None)
        )
        llm = _LlmClient(should_fail=True)
        sender = _Sender()
        pipeline = self._pipeline(retriever=retriever, llm_client=llm)

        outcome = await pipeline.on_message(
            message=_IncomingMessage(
                channel_id=200,
                author_id=100,
                author_is_bot=False,
                mentioned_user_ids=[999],
            ),
            history_provider=_provider(),
            sender=sender,
            character_card=_card(),
            skill_rules_excerpt="",
        )

        self.assertTrue(outcome.handled)
        self.assertFalse(outcome.sent)
        self.assertEqual(outcome.error_type, "LlmClientError")
        self.assertEqual(sender.messages, [])

    async def test_memory_extraction_schedule_failure_does_not_block_reply(self):
        retriever = _MemoryRetriever(
            RetrievalResult(records=(), mode="query", used_fallback=False, error=None)
        )
        llm = _LlmClient(text="Reply still sent.")
        sender = _Sender()
        extractor = _Extractor(should_fail=True)
        pipeline = self._pipeline(retriever=retriever, llm_client=llm, extractor=extractor)

        outcome = await pipeline.on_message(
            message=_IncomingMessage(
                channel_id=200,
                author_id=100,
                author_is_bot=False,
                mentioned_user_ids=[999],
            ),
            history_provider=_provider(),
            sender=sender,
            character_card=_card(),
            skill_rules_excerpt="",
        )

        self.assertTrue(outcome.handled)
        self.assertTrue(outcome.sent)
        self.assertEqual(sender.messages, ["**Kovach:** Reply still sent."])

    async def test_ruleset_can_supply_skill_excerpt_when_not_provided(self):
        retriever = _MemoryRetriever(
            RetrievalResult(records=(), mode="query", used_fallback=False, error=None)
        )
        llm = _LlmClient(text="Reply from ruleset.")
        sender = _Sender()
        pipeline = self._pipeline(retriever=retriever, llm_client=llm)

        outcome = await pipeline.on_message(
            message=_IncomingMessage(
                channel_id=200,
                author_id=100,
                author_is_bot=False,
                mentioned_user_ids=[999],
            ),
            history_provider=_provider(),
            sender=sender,
            character_card=_card(),
            skill_ruleset="coc7e",
        )

        self.assertTrue(outcome.sent)
        self.assertEqual(sender.messages, ["**Kovach:** Reply from ruleset."])
        self.assertEqual(len(llm.requests), 1)
        self.assertIn("CoC 7e Quick Excerpt", llm.requests[0].system_prompt)

    async def test_invalid_ruleset_logs_warning_and_continues(self):
        retriever = _MemoryRetriever(
            RetrievalResult(records=(), mode="query", used_fallback=False, error=None)
        )
        llm = _LlmClient(text="Reply after invalid ruleset.")
        sender = _Sender()
        pipeline = self._pipeline(retriever=retriever, llm_client=llm)

        with self.assertLogs("homunculus.pipeline.response", level="WARNING") as logs:
            outcome = await pipeline.on_message(
                message=_IncomingMessage(
                    channel_id=200,
                    author_id=100,
                    author_is_bot=False,
                    mentioned_user_ids=[999],
                ),
                history_provider=_provider(),
                sender=sender,
                character_card=_card(),
                skill_ruleset="invalid-ruleset",
            )

        self.assertTrue(outcome.sent)
        self.assertEqual(sender.messages, ["**Kovach:** Reply after invalid ruleset."])
        self.assertTrue(
            any("skill_excerpt_load_failed" in line for line in logs.output),
            logs.output,
        )

    async def test_success_log_contains_llm_token_and_cost_metrics(self):
        retriever = _MemoryRetriever(
            RetrievalResult(records=(), mode="query", used_fallback=False, error=None)
        )
        llm = _LlmClient(text="Observe metrics.")
        sender = _Sender()
        pipeline = self._pipeline(retriever=retriever, llm_client=llm)

        with self.assertLogs("homunculus.pipeline.response", level="INFO") as logs:
            outcome = await pipeline.on_message(
                message=_IncomingMessage(
                    channel_id=200,
                    author_id=100,
                    author_is_bot=False,
                    mentioned_user_ids=[999],
                ),
                history_provider=_provider(),
                sender=sender,
                character_card=_card(),
                skill_rules_excerpt="",
            )

        self.assertTrue(outcome.sent)
        self.assertTrue(any("response_pipeline_success" in line for line in logs.output), logs.output)
        self.assertTrue(any("llm_input_tokens=100" in line for line in logs.output), logs.output)
        self.assertTrue(any("llm_output_tokens=20" in line for line in logs.output), logs.output)
        self.assertTrue(any("llm_estimated_cost_usd=" in line for line in logs.output), logs.output)


if __name__ == "__main__":
    unittest.main()
