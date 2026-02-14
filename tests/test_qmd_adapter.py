from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.config.settings import load_settings
from homunculus.memory.qmd_adapter import QmdAdapter, _CommandResult


class QmdAdapterTests(unittest.IsolatedAsyncioTestCase):
    def _settings(self):
        return load_settings(
            environ={
                "HOMUNCULUS_AGENT_NPC_NAME": "kovach",
                "HOMUNCULUS_AGENT_CHARACTER_CARD_PATH": "./agents/kovach/card.json",
                "HOMUNCULUS_AGENT_QMD_INDEX": "kovach",
                "HOMUNCULUS_DISCORD_CHANNEL_ID": "123456789",
                "HOMUNCULUS_MODEL_NAME": "claude-sonnet-4-5-20250929",
                "HOMUNCULUS_MEMORY_TOP_K": "7",
                "HOMUNCULUS_MEMORY_QUERY_TIMEOUT_SECONDS": "4.5",
                "HOMUNCULUS_MEMORY_FALLBACK_TIMEOUT_SECONDS": "2.5",
                "HOMUNCULUS_RUNTIME_DATA_HOME": "/tmp/homunculus-data",
            }
        )

    async def test_query_success_uses_query_mode_and_normalizes_record(self):
        calls = []

        async def _runner(args, env, timeout):
            calls.append((tuple(args), dict(env), timeout))
            return _CommandResult(
                returncode=0,
                stdout='[{"text":"fact","score":"0.9"}]',
                stderr="",
                timed_out=False,
                latency_ms=12,
            )

        adapter = QmdAdapter(settings=self._settings(), command_runner=_runner)
        result = await adapter.retrieve("recent scene summary")

        self.assertIsNone(result.error)
        self.assertEqual(result.mode, "query")
        self.assertFalse(result.used_fallback)
        self.assertEqual(len(result.records), 1)
        self.assertEqual(result.records[0].text, "fact")
        self.assertEqual(result.records[0].source, "unknown")
        self.assertAlmostEqual(result.records[0].score, 0.9)
        self.assertEqual(result.records[0].mode, "query")

        self.assertEqual(len(calls), 1)
        args, env, timeout = calls[0]
        self.assertEqual(args[0], "qmd")
        self.assertEqual(args[1], "query")
        self.assertEqual(args[2:5], ("--json", "-n", "7"))
        self.assertEqual(timeout, 4.5)
        self.assertTrue(env["XDG_CONFIG_HOME"].endswith("/agents/kovach/qmd/xdg-config"))
        self.assertTrue(env["XDG_CACHE_HOME"].endswith("/agents/kovach/qmd/xdg-cache"))

    async def test_timeout_falls_back_to_search_mode(self):
        calls = []

        async def _runner(args, env, timeout):
            calls.append((tuple(args), timeout))
            if args[1] == "query":
                return _CommandResult(
                    returncode=-1,
                    stdout="",
                    stderr="",
                    timed_out=True,
                    latency_ms=101,
                )
            return _CommandResult(
                returncode=0,
                stdout='{"results":[{"content":"fallback-memory","source":"MEMORY.md","score":0.4}]}',
                stderr="",
                timed_out=False,
                latency_ms=20,
            )

        adapter = QmdAdapter(settings=self._settings(), command_runner=_runner)
        result = await adapter.retrieve("who did we meet yesterday")

        self.assertIsNone(result.error)
        self.assertEqual(result.mode, "search")
        self.assertTrue(result.used_fallback)
        self.assertEqual(result.records[0].text, "fallback-memory")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0][1], "query")
        self.assertEqual(calls[0][1], 4.5)
        self.assertEqual(calls[1][0][1], "search")
        self.assertEqual(calls[1][1], 2.5)

    async def test_returns_controlled_error_when_both_modes_fail(self):
        async def _runner(args, _env, _timeout):
            if args[1] == "query":
                return _CommandResult(
                    returncode=1,
                    stdout="",
                    stderr="failure",
                    timed_out=False,
                    latency_ms=11,
                )
            return _CommandResult(
                returncode=-1,
                stdout="",
                stderr="",
                timed_out=True,
                latency_ms=22,
            )

        adapter = QmdAdapter(settings=self._settings(), command_runner=_runner)
        result = await adapter.retrieve("critical question")

        self.assertEqual(result.records, ())
        self.assertIsNone(result.mode)
        self.assertTrue(result.used_fallback)
        self.assertIsNotNone(result.error)
        self.assertEqual(result.error.type, "both_failed")
        self.assertEqual(result.error.query_error_type, "non_zero_exit")
        self.assertEqual(result.error.fallback_error_type, "timeout")

    async def test_query_is_capped_before_execution(self):
        captured_query = {"value": ""}

        async def _runner(args, _env, _timeout):
            captured_query["value"] = args[-1]
            return _CommandResult(
                returncode=0,
                stdout="[]",
                stderr="",
                timed_out=False,
                latency_ms=5,
            )

        adapter = QmdAdapter(
            settings=self._settings(),
            command_runner=_runner,
            max_query_chars=10,
        )
        result = await adapter.retrieve("abcdefghijklmno")

        self.assertIsNone(result.error)
        self.assertEqual(captured_query["value"], "abcdefghij")


if __name__ == "__main__":
    unittest.main()
