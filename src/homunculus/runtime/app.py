"""Runtime lifecycle wiring for Homunculus."""

from __future__ import annotations

from typing import Optional, Protocol, Sequence
import asyncio
import logging
import signal

from homunculus.config.settings import AppSettings


class RuntimeService(Protocol):
    """Small lifecycle contract used by the runtime host."""

    async def start(self) -> None:
        ...

    async def stop(self) -> None:
        ...


class IdleService:
    """Placeholder service until concrete adapters are integrated."""

    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger

    async def start(self) -> None:
        self._logger.debug("Idle service started.")

    async def stop(self) -> None:
        self._logger.debug("Idle service stopped.")


class RuntimeApp:
    """Application host with deterministic startup and shutdown ordering."""

    def __init__(
        self,
        settings: AppSettings,
        services: Optional[Sequence[RuntimeService]] = None,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self.settings = settings
        self.logger = logger or logging.getLogger("homunculus.runtime")
        self._services = list(services) if services is not None else [IdleService(self.logger)]
        self._started = False

    async def start(self) -> None:
        if self._started:
            return

        for service in self._services:
            await service.start()

        self._started = True

    async def stop(self) -> None:
        if not self._started:
            return

        for service in reversed(self._services):
            try:
                await service.stop()
            except Exception:
                self.logger.exception("Service shutdown failed.")

        self._started = False

    async def run(self, shutdown_event: Optional[asyncio.Event] = None) -> None:
        stop_event = shutdown_event or asyncio.Event()
        added_signals = self._install_signal_handlers(stop_event)

        await self.start()
        self.logger.info(
            "Runtime started for NPC '%s' (channel_id=%s).",
            self.settings.agent.npc_name,
            self.settings.discord.channel_id,
        )

        try:
            await stop_event.wait()
        finally:
            self.logger.info("Runtime shutdown requested.")
            await self.stop()
            self._remove_signal_handlers(added_signals)

    @staticmethod
    def _install_signal_handlers(stop_event: asyncio.Event) -> Sequence[signal.Signals]:
        loop = asyncio.get_running_loop()
        added = []

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop_event.set)
                added.append(sig)
            except (NotImplementedError, RuntimeError):
                # Signal handlers may be unsupported on some environments.
                break

        return added

    @staticmethod
    def _remove_signal_handlers(signals_to_remove: Sequence[signal.Signals]) -> None:
        loop = asyncio.get_running_loop()

        for sig in signals_to_remove:
            try:
                loop.remove_signal_handler(sig)
            except (NotImplementedError, RuntimeError):
                break


def configure_logging(log_level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


async def run_runtime(settings: AppSettings, shutdown_event: Optional[asyncio.Event] = None) -> None:
    configure_logging(settings.runtime.log_level)
    app = RuntimeApp(settings=settings)
    await app.run(shutdown_event=shutdown_event)
