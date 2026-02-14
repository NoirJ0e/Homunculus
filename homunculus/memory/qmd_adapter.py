from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


RetrievalMode = Literal["query", "search", "none"]


@dataclass(frozen=True)
class QmdAdapterSettings:
    qmd_binary: str = "qmd"
    top_k: int = 10
    timeout_seconds: float = 4.0
    max_query_chars: int = 512
    home_dir: Path = field(default_factory=lambda: Path("~/.homunculus").expanduser())

    def __post_init__(self) -> None:
        if self.top_k <= 0:
            raise ValueError("top_k must be > 0")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be > 0")
        if self.max_query_chars <= 0:
            raise ValueError("max_query_chars must be > 0")


@dataclass(frozen=True)
class RetrievalItem:
    text: str
    source: str
    score: float
    mode: Literal["query", "search"]


@dataclass(frozen=True)
class RetrievalError:
    code: str
    message: str
    query_error_type: str | None = None
    fallback_error_type: str | None = None


@dataclass(frozen=True)
class RetrievalResult:
    items: tuple[RetrievalItem, ...]
    mode: RetrievalMode
    error: RetrievalError | None = None


@dataclass(frozen=True)
class _CommandResult:
    ok: bool
    mode: Literal["query", "search"]
    stdout: str
    stderr: str
    error_type: str | None
    latency_ms: int


class QmdAdapter:
    def __init__(self, settings: QmdAdapterSettings, logger: logging.Logger | None = None) -> None:
        self._settings = settings
        self._logger = logger or logging.getLogger(__name__)

    async def retrieve(self, npc_name: str, query: str) -> RetrievalResult:
        try:
            safe_query = self._cap_query(query)
            if not safe_query:
                return RetrievalResult(
                    items=(),
                    mode="none",
                    error=RetrievalError(
                        code="empty_query",
                        message="query is empty after normalization",
                    ),
                )

            env = self._build_env(npc_name)
            query_result = await self._run_command("query", safe_query, env)
            if query_result.ok:
                items = self._normalize_items(query_result.stdout, "query")
                self._logger.info(
                    "qmd_retrieval mode=query status=success latency_ms=%s count=%s",
                    query_result.latency_ms,
                    len(items),
                )
                return RetrievalResult(items=items, mode="query")

            self._logger.warning(
                "qmd_retrieval mode=query status=failed latency_ms=%s error_type=%s",
                query_result.latency_ms,
                query_result.error_type,
            )

            fallback_result = await self._run_command("search", safe_query, env)
            if fallback_result.ok:
                items = self._normalize_items(fallback_result.stdout, "search")
                self._logger.info(
                    "qmd_retrieval mode=search status=success latency_ms=%s count=%s",
                    fallback_result.latency_ms,
                    len(items),
                )
                return RetrievalResult(items=items, mode="search")

            self._logger.error(
                "qmd_retrieval mode=none status=failed query_error_type=%s fallback_error_type=%s",
                query_result.error_type,
                fallback_result.error_type,
            )
            return RetrievalResult(
                items=(),
                mode="none",
                error=RetrievalError(
                    code="qmd_both_failed",
                    message="qmd query and qmd search both failed",
                    query_error_type=query_result.error_type,
                    fallback_error_type=fallback_result.error_type,
                ),
            )
        except Exception as exc:  # pragma: no cover - defensive fallback
            self._logger.exception("qmd_retrieval mode=none status=failed error_type=unexpected")
            return RetrievalResult(
                items=(),
                mode="none",
                error=RetrievalError(
                    code="unexpected_error",
                    message=str(exc),
                ),
            )

    async def _run_command(
        self,
        mode: Literal["query", "search"],
        query: str,
        env: dict[str, str],
    ) -> _CommandResult:
        start = time.monotonic()
        try:
            process = await asyncio.create_subprocess_exec(
                self._settings.qmd_binary,
                mode,
                "--json",
                "-n",
                str(self._settings.top_k),
                query,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        except FileNotFoundError:
            return _CommandResult(
                ok=False,
                mode=mode,
                stdout="",
                stderr="qmd binary not found",
                error_type="spawn_error",
                latency_ms=self._elapsed_ms(start),
            )
        except OSError as exc:
            return _CommandResult(
                ok=False,
                mode=mode,
                stdout="",
                stderr=str(exc),
                error_type="spawn_error",
                latency_ms=self._elapsed_ms(start),
            )

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=self._settings.timeout_seconds,
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()
            return _CommandResult(
                ok=False,
                mode=mode,
                stdout="",
                stderr="timeout",
                error_type="timeout",
                latency_ms=self._elapsed_ms(start),
            )

        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")
        if process.returncode != 0:
            return _CommandResult(
                ok=False,
                mode=mode,
                stdout=stdout,
                stderr=stderr,
                error_type="non_zero_exit",
                latency_ms=self._elapsed_ms(start),
            )
        try:
            self._normalize_items(stdout, mode)
        except ValueError:
            return _CommandResult(
                ok=False,
                mode=mode,
                stdout=stdout,
                stderr=stderr,
                error_type="invalid_json",
                latency_ms=self._elapsed_ms(start),
            )
        return _CommandResult(
            ok=True,
            mode=mode,
            stdout=stdout,
            stderr=stderr,
            error_type=None,
            latency_ms=self._elapsed_ms(start),
        )

    def _build_env(self, npc_name: str) -> dict[str, str]:
        qmd_root = self._settings.home_dir / "agents" / npc_name / "qmd"
        env = os.environ.copy()
        env["XDG_CONFIG_HOME"] = str(qmd_root / "xdg-config")
        env["XDG_CACHE_HOME"] = str(qmd_root / "xdg-cache")
        return env

    def _cap_query(self, query: str) -> str:
        return query.strip()[: self._settings.max_query_chars]

    @staticmethod
    def _elapsed_ms(start: float) -> int:
        return int((time.monotonic() - start) * 1000)

    def _normalize_items(
        self,
        payload: str,
        mode: Literal["query", "search"],
    ) -> tuple[RetrievalItem, ...]:
        parsed = json.loads(payload)
        raw_items = self._extract_raw_items(parsed)
        normalized: list[RetrievalItem] = []
        for row in raw_items:
            if not isinstance(row, dict):
                continue
            normalized.append(
                RetrievalItem(
                    text=self._extract_text(row),
                    source=self._extract_source(row),
                    score=self._extract_score(row),
                    mode=mode,
                )
            )
        return tuple(normalized)

    @staticmethod
    def _extract_raw_items(payload: Any) -> list[Any]:
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            for key in ("results", "items", "hits", "data"):
                value = payload.get(key)
                if isinstance(value, list):
                    return value
            if any(key in payload for key in ("text", "content", "snippet", "document")):
                return [payload]
        raise ValueError("unsupported qmd payload")

    @staticmethod
    def _extract_text(row: dict[str, Any]) -> str:
        for key in ("text", "content", "snippet"):
            value = row.get(key)
            if isinstance(value, str) and value:
                return value

        document = row.get("document")
        if isinstance(document, str) and document:
            return document
        if isinstance(document, dict):
            nested_text = document.get("text")
            if isinstance(nested_text, str) and nested_text:
                return nested_text
        return ""

    @staticmethod
    def _extract_source(row: dict[str, Any]) -> str:
        for key in ("source", "path", "file", "uri", "id"):
            value = row.get(key)
            if isinstance(value, str) and value:
                return value
        return "unknown"

    @staticmethod
    def _extract_score(row: dict[str, Any]) -> float:
        for key in ("score", "relevance", "rerank_score", "similarity"):
            value = row.get(key)
            if isinstance(value, (int, float)):
                return float(value)
            if isinstance(value, str):
                try:
                    return float(value)
                except ValueError:
                    continue
        return 0.0
