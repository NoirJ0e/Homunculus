"""Runtime lifecycle wiring for Homunculus."""

from __future__ import annotations

from typing import Optional, Protocol
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


class RuntimeApp:
    """Application host with deterministic startup and shutdown ordering."""

    def __init__(
        self,
        settings: AppSettings,
        services: Optional[list[RuntimeService]] = None,
        background_tasks: Optional[list[asyncio.Task]] = None,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self.settings = settings
        self.logger = logger or logging.getLogger("homunculus.runtime")
        self._services = services or []
        self._background_tasks = background_tasks or []
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

        # Cancel background tasks
        for task in self._background_tasks:
            if not task.done():
                task.cancel()
        
        # Wait for tasks to finish with timeout
        if self._background_tasks:
            await asyncio.wait(
                self._background_tasks,
                timeout=5.0,
                return_when=asyncio.ALL_COMPLETED,
            )

        # Stop services in reverse order
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
            "Runtime started for bot '%s' (channels=%s).",
            self.settings.agent.bot_name,
            self.settings.discord.channel_ids,
        )

        try:
            await stop_event.wait()
        finally:
            self.logger.info("Runtime shutdown requested.")
            await self.stop()
            self._remove_signal_handlers(added_signals)

    @staticmethod
    def _install_signal_handlers(stop_event: asyncio.Event) -> list[signal.Signals]:
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
    def _remove_signal_handlers(signals_to_remove: list[signal.Signals]) -> None:
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
    from homunculus.runtime.factory import create_discord_service
    
    configure_logging(settings.runtime.log_level)
    logger = logging.getLogger("homunculus.runtime")
    
    # Create Discord service and background tasks
    discord_service, scheduler_task = await create_discord_service(settings, logger=logger)
    
    # Build runtime app
    app = RuntimeApp(
        settings=settings,
        services=[discord_service],
        background_tasks=[scheduler_task],
        logger=logger,
    )
    
    await app.run(shutdown_event=shutdown_event)
