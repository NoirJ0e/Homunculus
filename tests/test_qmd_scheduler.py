from __future__ import annotations

import asyncio
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.config.settings import load_settings
from homunculus.memory.scheduler import QmdIndexScheduler, _CommandResult


class QmdIndexSchedulerTests(unittest.IsolatedAsyncioTestCase):
    def _settings(self):
        return load_settings(
            environ={
                "HOMUNCULUS_AGENT_NPC_NAME": "kovach",
                "HOMUNCULUS_AGENT_CHARACTER_CARD_PATH": "./agents/kovach/card.json",
                "HOMUNCULUS_AGENT_QMD_INDEX": "kovach",
                "HOMUNCULUS_DISCORD_CHANNEL_ID": "123456789",
                "HOMUNCULUS_MODEL_NAME": "claude-sonnet-4-5-20250929",
                "HOMUNCULUS_RUNTIME_DATA_HOME": "/tmp/homunculus-data",
                "HOMUNCULUS_MEMORY_UPDATE_INTERVAL_SECONDS": "0.001",
                "HOMUNCULUS_MEMORY_UPDATE_TIMEOUT_SECONDS": "6.0",
            }
        )

    async def test_run_once_executes_update_then_embed(self):
        calls = []

        async def _runner(args, env, timeout):
            calls.append((tuple(args), dict(env), timeout))
            return _CommandResult(returncode=0, timed_out=False, latency_ms=5)

        scheduler = QmdIndexScheduler(settings=self._settings(), command_runner=_runner)
        ok = await scheduler.run_once()

        self.assertTrue(ok)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0], ("qmd", "update"))
        self.assertEqual(calls[1][0], ("qmd", "embed"))
        self.assertEqual(calls[0][2], 6.0)
        self.assertTrue(calls[0][1]["XDG_CONFIG_HOME"].endswith("/agents/kovach/qmd/xdg-config"))

    async def test_run_once_handles_transient_failure(self):
        calls = []

        async def _runner(args, _env, _timeout):
            calls.append(tuple(args))
            return _CommandResult(returncode=1, timed_out=False, latency_ms=3)

        scheduler = QmdIndexScheduler(settings=self._settings(), command_runner=_runner)
        ok = await scheduler.run_once()

        self.assertFalse(ok)
        self.assertEqual(calls, [("qmd", "update")])

    async def test_run_forever_stops_on_stop_event(self):
        stop_event = asyncio.Event()
        calls = []

        async def _runner(args, _env, _timeout):
            calls.append(tuple(args))
            if len(calls) >= 4:
                stop_event.set()
            return _CommandResult(returncode=0, timed_out=False, latency_ms=1)

        scheduler = QmdIndexScheduler(settings=self._settings(), command_runner=_runner)
        await scheduler.run_forever(stop_event)

        self.assertGreaterEqual(len(calls), 4)


if __name__ == "__main__":
    unittest.main()
