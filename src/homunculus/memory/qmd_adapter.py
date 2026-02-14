"""QMD retrieval adapter with timeout fallback."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping, Optional, Sequence, Tuple
import asyncio
import json
import logging
import os
import time

from homunculus.config.settings import AppSettings


@dataclass(frozen=True)
class MemoryRecord:
    text: str
    source: str
    score: float
    mode: str


@dataclass(frozen=True)
class RetrievalError:
    type: str
    message: str
    query_error_type: Optional[str] = None
    fallback_error_type: Optional[str] = None


@dataclass(frozen=True)
class RetrievalResult:
    records: Tuple[MemoryRecord, ...]
    mode: Optional[str]
    used_fallback: bool
    error: Optional[RetrievalError]


@dataclass(frozen=True)
class _CommandResult:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool
    latency_ms: int


CommandRunner = Callable[[Sequence[str], Mapping[str, str], float], Awaitable[_CommandResult]]


class QmdAdapter:
    """Runs qmd query with fallback to qmd search."""

    def __init__(
        self,
        settings: AppSettings,
        *,
        logger: Optional[logging.Logger] = None,
        command_runner: Optional[CommandRunner] = None,
        max_query_chars: int = 600,
        environ: Optional[Mapping[str, str]] = None,
    ) -> None:
        self._settings = settings
        self._logger = logger or logging.getLogger("homunculus.memory.qmd")
        self._command_runner = command_runner or _run_qmd_command
        self._max_query_chars = max_query_chars
        self._environ = dict(environ) if environ is not None else dict(os.environ)

    async def retrieve(
        self,
        query: str,
        *,
        npc_name: Optional[str] = None,
        top_k: Optional[int] = None,
    ) -> RetrievalResult:
        normalized_query = _normalize_query(query, max_chars=self._max_query_chars)
        if not normalized_query:
            return RetrievalResult(
                records=(),
                mode=None,
                used_fallback=False,
                error=RetrievalError(
                    type="invalid_query",
                    message="Query must contain non-whitespace characters.",
                ),
            )

        effective_npc_name = (npc_name or self._settings.agent.npc_name).strip()
        if not effective_npc_name:
            return RetrievalResult(
                records=(),
                mode=None,
                used_fallback=False,
                error=RetrievalError(type="invalid_npc_name", message="NPC name is empty."),
            )

        effective_top_k = top_k if top_k is not None else self._settings.memory.top_k
        if effective_top_k <= 0:
            return RetrievalResult(
                records=(),
                mode=None,
                used_fallback=False,
                error=RetrievalError(type="invalid_top_k", message="top_k must be > 0."),
            )

        env = self._build_env(effective_npc_name)

        query_attempt = await self._attempt(
            mode="query",
            query=normalized_query,
            top_k=effective_top_k,
            timeout_seconds=self._settings.memory.query_timeout_seconds,
            env=env,
        )
        if query_attempt.result is not None:
            self._log_success(mode="query", used_fallback=False, attempt=query_attempt)
            return query_attempt.result

        fallback_attempt = await self._attempt(
            mode="search",
            query=normalized_query,
            top_k=effective_top_k,
            timeout_seconds=self._settings.memory.fallback_timeout_seconds,
            env=env,
        )
        if fallback_attempt.result is not None:
            self._log_success(mode="search", used_fallback=True, attempt=fallback_attempt)
            return fallback_attempt.result

        self._logger.warning(
            "qmd_retrieval_failed mode=both query_error_type=%s fallback_error_type=%s",
            query_attempt.error_type,
            fallback_attempt.error_type,
        )
        return RetrievalResult(
            records=(),
            mode=None,
            used_fallback=True,
            error=RetrievalError(
                type="both_failed",
                message="Both qmd query and qmd search failed.",
                query_error_type=query_attempt.error_type,
                fallback_error_type=fallback_attempt.error_type,
            ),
        )

    async def _attempt(
        self,
        *,
        mode: str,
        query: str,
        top_k: int,
        timeout_seconds: float,
        env: Mapping[str, str],
    ) -> "_Attempt":
        args = (
            self._settings.memory.qmd_binary,
            mode,
            "--json",
            "-n",
            str(top_k),
            query,
        )
        try:
            command_result = await self._command_runner(args, env, timeout_seconds)
        except Exception as exc:  # pragma: no cover - defensive guard
            error_type = "runner_exception"
            self._logger.warning(
                "qmd_retrieval_failure mode=%s error_type=%s",
                mode,
                error_type,
            )
            return _Attempt(
                result=None,
                error_type=error_type,
                latency_ms=0,
            )

        if command_result.timed_out:
            self._logger.warning(
                "qmd_retrieval_failure mode=%s error_type=timeout latency_ms=%s",
                mode,
                command_result.latency_ms,
            )
            return _Attempt(
                result=None,
                error_type="timeout",
                latency_ms=command_result.latency_ms,
            )

        if command_result.returncode != 0:
            self._logger.warning(
                "qmd_retrieval_failure mode=%s error_type=non_zero_exit latency_ms=%s",
                mode,
                command_result.latency_ms,
            )
            return _Attempt(
                result=None,
                error_type="non_zero_exit",
                latency_ms=command_result.latency_ms,
            )

        try:
            records = _parse_records(command_result.stdout, mode=mode)
        except ValueError:
            self._logger.warning(
                "qmd_retrieval_failure mode=%s error_type=parse_error latency_ms=%s",
                mode,
                command_result.latency_ms,
            )
            return _Attempt(
                result=None,
                error_type="parse_error",
                latency_ms=command_result.latency_ms,
            )

        return _Attempt(
            result=RetrievalResult(
                records=records,
                mode=mode,
                used_fallback=(mode == "search"),
                error=None,
            ),
            error_type=None,
            latency_ms=command_result.latency_ms,
        )

    def _build_env(self, npc_name: str) -> Mapping[str, str]:
        qmd_root = self._settings.runtime.data_home / "agents" / npc_name / "qmd"
        env = dict(self._environ)
        env["XDG_CONFIG_HOME"] = str(qmd_root / "xdg-config")
        env["XDG_CACHE_HOME"] = str(qmd_root / "xdg-cache")
        return env

    def _log_success(self, *, mode: str, used_fallback: bool, attempt: "_Attempt") -> None:
        self._logger.info(
            "qmd_retrieval_success mode=%s used_fallback=%s latency_ms=%s records=%s",
            mode,
            used_fallback,
            attempt.latency_ms,
            len(attempt.result.records) if attempt.result is not None else 0,
        )


@dataclass(frozen=True)
class _Attempt:
    result: Optional[RetrievalResult]
    error_type: Optional[str]
    latency_ms: int


def _normalize_query(query: str, *, max_chars: int) -> str:
    normalized = query.strip()
    if len(normalized) <= max_chars:
        return normalized
    return normalized[:max_chars].rstrip()


def _parse_records(raw_output: str, *, mode: str) -> Tuple[MemoryRecord, ...]:
    try:
        payload = json.loads(raw_output)
    except json.JSONDecodeError as exc:
        raise ValueError("qmd output is not valid JSON") from exc

    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, Mapping):
        for key in ("results", "items", "hits", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                items = value
                break
        else:
            raise ValueError("qmd output has unsupported object shape")
    else:
        raise ValueError("qmd output has unsupported JSON shape")

    records = []
    for item in items:
        if not isinstance(item, Mapping):
            continue

        text = _pick_text(item)
        if not text:
            continue

        source = _pick_source(item)
        score = _to_float(item.get("score"))
        records.append(
            MemoryRecord(
                text=text,
                source=source,
                score=score,
                mode=mode,
            )
        )
    return tuple(records)


def _pick_text(item: Mapping[str, Any]) -> str:
    direct = _first_non_empty_str(
        item.get("text"),
        item.get("content"),
        item.get("snippet"),
        item.get("body"),
    )
    if direct:
        return direct

    document = item.get("document")
    if isinstance(document, Mapping):
        nested = _first_non_empty_str(document.get("text"), document.get("content"))
        if nested:
            return nested
    return ""


def _pick_source(item: Mapping[str, Any]) -> str:
    source = _first_non_empty_str(
        item.get("source"),
        item.get("path"),
        item.get("file"),
        item.get("file_path"),
        item.get("uri"),
    )
    return source if source else "unknown"


def _first_non_empty_str(*values: Any) -> str:
    for value in values:
        if isinstance(value, str):
            normalized = value.strip()
            if normalized:
                return normalized
    return ""


def _to_float(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return 0.0
    return 0.0


async def _run_qmd_command(
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
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout_seconds,
        )
        timed_out = False
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        latency_ms = int((time.perf_counter() - started) * 1000)
        return _CommandResult(
            returncode=-1,
            stdout="",
            stderr="",
            timed_out=True,
            latency_ms=latency_ms,
        )

    latency_ms = int((time.perf_counter() - started) * 1000)
    return _CommandResult(
        returncode=process.returncode,
        stdout=stdout_bytes.decode("utf-8", errors="replace"),
        stderr=stderr_bytes.decode("utf-8", errors="replace"),
        timed_out=timed_out,
        latency_ms=latency_ms,
    )
