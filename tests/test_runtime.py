import asyncio
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.config.settings import load_settings
from homunculus.runtime.app import RuntimeApp


class _ProbeService:
    def __init__(self):
        self.started = 0
        self.stopped = 0

    async def start(self):
        self.started += 1

    async def stop(self):
        self.stopped += 1


class RuntimeAppTests(unittest.IsolatedAsyncioTestCase):
    def _settings(self):
        return load_settings(
            environ={
                "HOMUNCULUS_AGENT_NPC_NAME": "kovach",
                "HOMUNCULUS_AGENT_CHARACTER_CARD_PATH": "./agents/kovach/card.json",
                "HOMUNCULUS_AGENT_QMD_INDEX": "kovach",
                "HOMUNCULUS_DISCORD_CHANNEL_ID": "123456789",
                "HOMUNCULUS_MODEL_NAME": "claude-sonnet-4-5-20250929",
                "HOMUNCULUS_RUNTIME_LOG_LEVEL": "DEBUG",
            }
        )

    async def test_run_starts_and_stops_services_once(self):
        probe = _ProbeService()
        app = RuntimeApp(settings=self._settings(), services=[probe])

        stop_event = asyncio.Event()
        stop_event.set()

        await app.run(shutdown_event=stop_event)

        self.assertEqual(probe.started, 1)
        self.assertEqual(probe.stopped, 1)


if __name__ == "__main__":
    unittest.main()
