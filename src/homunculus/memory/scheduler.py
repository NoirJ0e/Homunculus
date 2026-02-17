"""Periodic qmd update/embed scheduler."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Mapping, Optional, Sequence
import asyncio
import logging
import os
import time

from homunculus.config.settings import AppSettings


@dataclass(frozen=True)
class _CommandResult:
    returncode: int
    timed_out: bool
    latency_ms: int


CommandRunner = Callable[[Sequence[str], Mapping[str, str], float], Awaitable[_CommandResult]]


class QmdIndexScheduler:
    """Runs periodic `qmd update` + `qmd embed` cycles."""

    def __init__(
        self,
        *,
        settings: AppSettings,
        namespace: Optional[str] = None,
        logger: Optional[logging.Logger] = None,
        command_runner: Optional[CommandRunner] = None,
        environ: Optional[Mapping[str, str]] = None,
    ) -> None:
        self._settings = settings
        normalized_namespace = namespace.strip() if namespace is not None else None
        self._namespace = normalized_namespace or None
        self._logger = logger or logging.getLogger("homunculus.memory.scheduler")
        self._command_runner = command_runner or _run_command
        self._environ = dict(environ) if environ is not None else dict(os.environ)

    async def run_once(self, *, npc_name: Optional[str] = None) -> bool:
        name = (
            self._namespace
            or npc_name
            or self._settings.agent.qmd_index
            or self._settings.agent.npc_name
        ).strip()
        if not name:
            self._logger.warning("qmd_index_cycle_skipped reason=empty_npc_name")
            return False

        env = self._build_env(name)
        timeout = self._settings.memory.update_timeout_seconds
        for step in ("update", "embed"):
            args = (self._settings.memory.qmd_binary, step)
            result = await self._command_runner(args, env, timeout)

            if result.timed_out:
                self._logger.warning(
                    "qmd_index_step_failed step=%s error_type=timeout latency_ms=%s",
                    step,
                    result.latency_ms,
                )
                return False
            if result.returncode != 0:
                self._logger.warning(
                    "qmd_index_step_failed step=%s error_type=non_zero_exit latency_ms=%s",
                    step,
                    result.latency_ms,
                )
                return False
        self._logger.info("qmd_index_cycle_success npc_name=%s", name)
        return True

    async def run_forever(self, stop_event: asyncio.Event, *, npc_name: Optional[str] = None) -> None:
        interval = self._settings.memory.update_interval_seconds
        while not stop_event.is_set():
            await self.run_once(npc_name=npc_name)
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
            except asyncio.TimeoutError:
                continue

    def _build_env(self, npc_name: str) -> Mapping[str, str]:
        qmd_root = self._settings.namespace_root(npc_name) / "qmd"
        env = dict(self._environ)
        env["XDG_CONFIG_HOME"] = str(qmd_root / "xdg-config")
        env["XDG_CACHE_HOME"] = str(qmd_root / "xdg-cache")
        return env


async def _run_command(
    args: Sequence[str],
    env: Mapping[str, str],
    timeout_seconds: float,
) -> _CommandResult:
    started = time.perf_counter()
    process = await asyncio.create_subprocess_exec(
        *args,
        env=dict(env),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
        timed_out = False
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        latency_ms = int((time.perf_counter() - started) * 1000)
        return _CommandResult(returncode=-1, timed_out=True, latency_ms=latency_ms)

    latency_ms = int((time.perf_counter() - started) * 1000)
    return _CommandResult(
        returncode=process.returncode,
        timed_out=timed_out,
        latency_ms=latency_ms,
    )
