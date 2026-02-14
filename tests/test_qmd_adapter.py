import asyncio
from dataclasses import dataclass
from pathlib import Path
import unittest
from unittest.mock import patch

from homunculus.memory.qmd_adapter import QmdAdapter, QmdAdapterSettings


@dataclass
class ProcessSpec:
    stdout: bytes
    stderr: bytes = b""
    returncode: int = 0
    delay_seconds: float = 0.0


class FakeProcess:
    def __init__(self, spec: ProcessSpec) -> None:
        self.returncode = spec.returncode
        self._stdout = spec.stdout
        self._stderr = spec.stderr
        self._delay_seconds = spec.delay_seconds
        self.killed = False

    async def communicate(self) -> tuple[bytes, bytes]:
        if self._delay_seconds > 0:
            await asyncio.sleep(self._delay_seconds)
        return (self._stdout, self._stderr)

    def kill(self) -> None:
        self.killed = True


def _make_spawn(specs: list[ProcessSpec], calls: list[tuple[tuple[object, ...], dict[str, object]]]):
    pending_specs = list(specs)

    async def _spawn(*args: object, **kwargs: object) -> FakeProcess:
        calls.append((args, kwargs))
        spec = pending_specs.pop(0)
        return FakeProcess(spec)

    return _spawn


class QmdAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_retrieve_uses_query_with_npc_xdg_env(self) -> None:
        calls: list[tuple[tuple[object, ...], dict[str, object]]] = []
        query_payload = b'[{"text":"alpha","source":"memory/2026-02-14.md","score":0.8}]'
        spawn = _make_spawn([ProcessSpec(stdout=query_payload)], calls)

        with patch("homunculus.memory.qmd_adapter.asyncio.create_subprocess_exec", new=spawn):
            adapter = QmdAdapter(
                QmdAdapterSettings(
                    top_k=3,
                    timeout_seconds=0.5,
                    home_dir=Path("/tmp/homunculus"),
                )
            )
            result = await adapter.retrieve("kovach", "remember this")

        self.assertEqual(result.mode, "query")
        self.assertIsNone(result.error)
        self.assertEqual(len(result.items), 1)
        self.assertEqual(result.items[0].text, "alpha")
        self.assertEqual(result.items[0].source, "memory/2026-02-14.md")
        self.assertEqual(result.items[0].score, 0.8)
        self.assertEqual(result.items[0].mode, "query")

        args, kwargs = calls[0]
        self.assertEqual(args, ("qmd", "query", "--json", "-n", "3", "remember this"))
        env = kwargs["env"]
        self.assertIsInstance(env, dict)
        self.assertEqual(env["XDG_CONFIG_HOME"], "/tmp/homunculus/agents/kovach/qmd/xdg-config")
        self.assertEqual(env["XDG_CACHE_HOME"], "/tmp/homunculus/agents/kovach/qmd/xdg-cache")

    async def test_retrieve_timeout_falls_back_to_search(self) -> None:
        calls: list[tuple[tuple[object, ...], dict[str, object]]] = []
        search_payload = b'{"results":[{"content":"fallback","file":"MEMORY.md","relevance":"0.33"}]}'
        spawn = _make_spawn(
            [
                ProcessSpec(stdout=b"[]", delay_seconds=0.05),
                ProcessSpec(stdout=search_payload),
            ],
            calls,
        )

        with patch("homunculus.memory.qmd_adapter.asyncio.create_subprocess_exec", new=spawn):
            adapter = QmdAdapter(
                QmdAdapterSettings(
                    top_k=2,
                    timeout_seconds=0.01,
                    home_dir=Path("/tmp/homunculus"),
                )
            )
            result = await adapter.retrieve("kovach", "long running query")

        self.assertEqual(result.mode, "search")
        self.assertIsNone(result.error)
        self.assertEqual(len(result.items), 1)
        self.assertEqual(result.items[0].text, "fallback")
        self.assertEqual(result.items[0].source, "MEMORY.md")
        self.assertEqual(result.items[0].score, 0.33)
        self.assertEqual(result.items[0].mode, "search")
        self.assertEqual(calls[0][0][1], "query")
        self.assertEqual(calls[1][0][1], "search")

    async def test_retrieve_returns_controlled_error_when_both_fail(self) -> None:
        calls: list[tuple[tuple[object, ...], dict[str, object]]] = []
        spawn = _make_spawn(
            [
                ProcessSpec(stdout=b"", stderr=b"query failed", returncode=2),
                ProcessSpec(stdout=b"", stderr=b"search failed", returncode=1),
            ],
            calls,
        )

        with patch("homunculus.memory.qmd_adapter.asyncio.create_subprocess_exec", new=spawn):
            adapter = QmdAdapter(QmdAdapterSettings(home_dir=Path("/tmp/homunculus")))
            result = await adapter.retrieve("kovach", "x" * 2048)

        self.assertEqual(result.mode, "none")
        self.assertEqual(result.items, ())
        self.assertIsNotNone(result.error)
        assert result.error is not None
        self.assertEqual(result.error.code, "qmd_both_failed")
        self.assertEqual(result.error.query_error_type, "non_zero_exit")
        self.assertEqual(result.error.fallback_error_type, "non_zero_exit")

        # Query text is capped before command execution.
        capped_query = calls[0][0][-1]
        self.assertIsInstance(capped_query, str)
        self.assertEqual(len(capped_query), adapter._settings.max_query_chars)
