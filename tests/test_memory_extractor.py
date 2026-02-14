from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.config.settings import load_settings
from homunculus.discord.recent_messages import RecentMessage
from homunculus.llm.client import LlmClientError, LlmRequest, LlmResponse
from homunculus.memory.extractor import MemoryExtractor


class _LlmClient:
    def __init__(self, *, text=""):
        self.text = text
        self.should_fail = False
        self.requests = []

    async def complete(self, request: LlmRequest):
        self.requests.append(request)
        if self.should_fail:
            raise LlmClientError("synthetic failure")
        return LlmResponse(
            text=self.text,
            model="claude",
            stop_reason="end_turn",
            input_tokens=10,
            output_tokens=5,
        )


def _message() -> RecentMessage:
    return RecentMessage(
        message_id=1,
        channel_id=100,
        author_id=101,
        author_name="joe",
        role="user",
        content="Remember the church clue.",
        created_at=datetime(2026, 2, 14, 10, 0, tzinfo=timezone.utc),
        mentioned_user_ids=(999,),
    )


class MemoryExtractorTests(unittest.IsolatedAsyncioTestCase):
    def _settings(self, data_home: str):
        return load_settings(
            environ={
                "HOMUNCULUS_AGENT_NPC_NAME": "kovach",
                "HOMUNCULUS_AGENT_CHARACTER_CARD_PATH": "./agents/kovach/card.json",
                "HOMUNCULUS_AGENT_QMD_INDEX": "kovach",
                "HOMUNCULUS_DISCORD_CHANNEL_ID": "123456789",
                "HOMUNCULUS_MODEL_NAME": "claude-sonnet-4-5-20250929",
                "HOMUNCULUS_RUNTIME_DATA_HOME": data_home,
            }
        )

    async def test_extract_and_append_writes_daily_markdown(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            llm = _LlmClient(text="- Knows Joe\n- Saw suspicious lights")
            extractor = MemoryExtractor(
                settings=self._settings(temp_dir),
                llm_client=llm,
                now_provider=lambda: datetime(2026, 2, 14, 12, 34, tzinfo=timezone.utc),
            )

            ok = await extractor.extract_and_append(
                recent_messages=[_message()],
                response_text="I saw strange lights by the church.",
                npc_name="kovach",
            )

            self.assertTrue(ok)
            memory_file = (
                Path(temp_dir)
                / "agents"
                / "kovach"
                / "memory"
                / "memory"
                / "2026-02-14.md"
            )
            self.assertTrue(memory_file.exists())
            text = memory_file.read_text(encoding="utf-8")
            self.assertIn("- Knows Joe", text)
            self.assertIn("2026-02-14T12:34:00+00:00", text)

    async def test_extract_failure_is_captured(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            llm = _LlmClient(text="")
            llm.should_fail = True
            extractor = MemoryExtractor(
                settings=self._settings(temp_dir),
                llm_client=llm,
            )

            ok = await extractor.extract_and_append(
                recent_messages=[_message()],
                response_text="response",
                npc_name="kovach",
            )

            self.assertFalse(ok)

    async def test_schedule_extraction_runs_async(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            llm = _LlmClient(text="- Durable fact")
            extractor = MemoryExtractor(
                settings=self._settings(temp_dir),
                llm_client=llm,
            )

            task = extractor.schedule_extraction(
                recent_messages=[_message()],
                response_text="response",
                npc_name="kovach",
            )
            result = await task

            self.assertTrue(result)
            self.assertEqual(len(llm.requests), 1)


if __name__ == "__main__":
    unittest.main()
