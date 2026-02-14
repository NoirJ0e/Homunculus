"""Asynchronous memory extraction and persistence."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional, Sequence
import asyncio
import logging

from homunculus.config.settings import AppSettings
from homunculus.discord.recent_messages import RecentMessage
from homunculus.llm.client import LlmClient, LlmRequest


class MemoryExtractor:
    """Fire-and-forget memory extraction to append markdown memory logs."""

    def __init__(
        self,
        *,
        settings: AppSettings,
        llm_client: LlmClient,
        logger: Optional[logging.Logger] = None,
        now_provider: Optional[Callable[[], datetime]] = None,
    ) -> None:
        self._settings = settings
        self._llm_client = llm_client
        self._logger = logger or logging.getLogger("homunculus.memory.extractor")
        self._now_provider = now_provider or (lambda: datetime.now(timezone.utc))

    def schedule_extraction(
        self,
        *,
        recent_messages: Sequence[RecentMessage],
        response_text: str,
        npc_name: str,
    ) -> asyncio.Task:
        return asyncio.create_task(
            self.extract_and_append(
                recent_messages=recent_messages,
                response_text=response_text,
                npc_name=npc_name,
            )
        )

    async def extract_and_append(
        self,
        *,
        recent_messages: Sequence[RecentMessage],
        response_text: str,
        npc_name: str,
    ) -> bool:
        if not npc_name.strip():
            self._logger.warning("memory_extraction_skipped reason=empty_npc_name")
            return False

        prompt = _build_extraction_user_prompt(
            recent_messages=recent_messages,
            response_text=response_text,
            npc_name=npc_name,
        )
        try:
            extraction = await self._llm_client.complete(
                LlmRequest(
                    system_prompt=_MEMORY_EXTRACTION_SYSTEM_PROMPT,
                    user_prompt=prompt,
                    max_tokens=220,
                    temperature=0.0,
                )
            )
            facts = extraction.text.strip()
            if not facts:
                self._logger.info("memory_extraction_skipped reason=empty_facts")
                return False

            timestamp = self._now_provider()
            path = _daily_memory_path(self._settings.runtime.data_home, npc_name, timestamp)
            path.parent.mkdir(parents=True, exist_ok=True)

            entry = f"\n## {timestamp.isoformat()}\n{facts}\n"
            with path.open("a", encoding="utf-8") as handle:
                handle.write(entry)

            self._logger.info("memory_extraction_success path=%s", path)
            return True
        except Exception as exc:
            self._logger.warning(
                "memory_extraction_failed error_type=%s",
                exc.__class__.__name__,
            )
            return False


_MEMORY_EXTRACTION_SYSTEM_PROMPT = (
    "Extract durable NPC-specific memory facts from the conversation. "
    "Return concise markdown bullet points only. "
    "Do not include transient chatter, tool text, or formatting outside markdown bullets."
)


def _build_extraction_user_prompt(
    *,
    recent_messages: Sequence[RecentMessage],
    response_text: str,
    npc_name: str,
) -> str:
    lines = [f"NPC: {npc_name}", "", "Recent conversation:"]
    for message in recent_messages[-8:]:
        lines.append(f"- [{message.role}][{message.author_name}] {message.content}")
    lines.extend(
        [
            "",
            "NPC response:",
            response_text.strip(),
            "",
            "Extract durable memory facts about this NPC as markdown bullet points.",
        ]
    )
    return "\n".join(lines).strip()


def _daily_memory_path(data_home: Path, npc_name: str, now: datetime) -> Path:
    safe_npc = npc_name.strip()
    filename = f"{now.date().isoformat()}.md"
    return data_home / "agents" / safe_npc / "memory" / "memory" / filename
