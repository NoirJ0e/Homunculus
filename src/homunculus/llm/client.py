"""LLM provider abstraction and Anthropic adapter."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Protocol, Sequence
import asyncio
import json
import logging
import urllib.error
import urllib.request

from homunculus.config.settings import AppSettings, resolve_env_secret
from homunculus.observability import estimate_completion_cost_usd


@dataclass(frozen=True)
class LlmRequest:
    system_prompt: str
    user_prompt: str
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None


@dataclass(frozen=True)
class LlmResponse:
    text: str
    model: str
    stop_reason: Optional[str]
    input_tokens: int
    output_tokens: int


class LlmClientError(RuntimeError):
    """Raised for provider request/response failures."""


class LlmClient(Protocol):
    async def complete(self, request: LlmRequest) -> LlmResponse:
        ...


class AnthropicTransport(Protocol):
    async def send_messages(
        self,
        *,
        api_key: str,
        payload: Mapping[str, Any],
        timeout_seconds: float,
    ) -> Mapping[str, Any]:
        ...


class HttpAnthropicTransport:
    """Minimal HTTP transport to avoid SDK lock-in at foundation stage."""

    API_URL = "https://api.anthropic.com/v1/messages"

    async def send_messages(
        self,
        *,
        api_key: str,
        payload: Mapping[str, Any],
        timeout_seconds: float,
    ) -> Mapping[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.API_URL,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
        )

        def _do_request() -> Mapping[str, Any]:
            try:
                with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                    raw = response.read().decode("utf-8", errors="replace")
            except urllib.error.URLError as exc:
                raise LlmClientError("Anthropic request failed.") from exc

            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise LlmClientError("Anthropic response was not valid JSON.") from exc

            if not isinstance(parsed, Mapping):
                raise LlmClientError("Anthropic response has invalid structure.")
            return parsed

        return await asyncio.to_thread(_do_request)


class AnthropicClient:
    """Anthropic messages API adapter."""

    def __init__(
        self,
        *,
        model: str,
        api_key: str,
        default_max_tokens: int,
        default_temperature: float,
        timeout_seconds: float,
        transport: AnthropicTransport,
        logger: logging.Logger | None = None,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._default_max_tokens = default_max_tokens
        self._default_temperature = default_temperature
        self._timeout_seconds = timeout_seconds
        self._transport = transport
        self._logger = logger or logging.getLogger("homunculus.llm.client")

    async def complete(self, request: LlmRequest) -> LlmResponse:
        payload = {
            "model": self._model,
            "max_tokens": request.max_tokens
            if request.max_tokens is not None
            else self._default_max_tokens,
            "temperature": request.temperature
            if request.temperature is not None
            else self._default_temperature,
            "system": request.system_prompt,
            "messages": [{"role": "user", "content": request.user_prompt}],
        }

        raw = await self._transport.send_messages(
            api_key=self._api_key,
            payload=payload,
            timeout_seconds=self._timeout_seconds,
        )
        response = _parse_anthropic_response(raw)
        estimated_cost_usd = estimate_completion_cost_usd(
            model=response.model,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
        )
        self._logger.info(
            "llm_completion_success provider=anthropic model=%s input_tokens=%s output_tokens=%s estimated_cost_usd=%s",
            response.model,
            response.input_tokens,
            response.output_tokens,
            estimated_cost_usd,
        )
        return response


class OpenAIClient:
    """OpenAI-compatible chat completions API adapter (supports OpenClaw)."""

    def __init__(
        self,
        *,
        model: str,
        api_key: str,
        base_url: Optional[str],
        default_max_tokens: int,
        default_temperature: float,
        timeout_seconds: float,
        agent_id: Optional[str] = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._base_url = base_url or "https://api.openai.com/v1"
        self._default_max_tokens = default_max_tokens
        self._default_temperature = default_temperature
        self._timeout_seconds = timeout_seconds
        self._agent_id = agent_id
        self._logger = logger or logging.getLogger("homunculus.llm.client")

    async def complete(self, request: LlmRequest) -> LlmResponse:
        # OpenAI Chat Completions format
        payload = {
            "model": self._model,
            "max_tokens": request.max_tokens
            if request.max_tokens is not None
            else self._default_max_tokens,
            "temperature": request.temperature
            if request.temperature is not None
            else self._default_temperature,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.user_prompt},
            ],
        }

        api_url = f"{self._base_url.rstrip('/')}/chat/completions"
        raw = await self._send_request(api_url, payload)
        response = _parse_openai_response(raw)
        
        estimated_cost_usd = estimate_completion_cost_usd(
            model=response.model,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
        )
        self._logger.info(
            "llm_completion_success provider=openai/openclaw model=%s input_tokens=%s output_tokens=%s estimated_cost_usd=%s",
            response.model,
            response.input_tokens,
            response.output_tokens,
            estimated_cost_usd,
        )
        return response

    async def _send_request(self, url: str, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "content-type": "application/json",
            "authorization": f"Bearer {self._api_key}",
        }
        # Add OpenClaw agent routing header if specified
        if self._agent_id:
            headers["x-openclaw-agent-id"] = self._agent_id
        
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers=headers,
        )

        def _do_request() -> Mapping[str, Any]:
            try:
                with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                    raw = response.read().decode("utf-8", errors="replace")
            except urllib.error.URLError as exc:
                raise LlmClientError("OpenAI-compatible request failed.") from exc

            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise LlmClientError("OpenAI-compatible response was not valid JSON.") from exc

            if not isinstance(parsed, Mapping):
                raise LlmClientError("OpenAI-compatible response has invalid structure.")
            return parsed

        return await asyncio.to_thread(_do_request)


def build_llm_client(
    settings: AppSettings,
    *,
    environ: Optional[Mapping[str, str]] = None,
    anthropic_transport: Optional[AnthropicTransport] = None,
    logger: logging.Logger | None = None,
) -> LlmClient:
    provider = settings.model.provider
    
    if provider == "anthropic":
        api_key = resolve_env_secret(settings.model.api_key_env, environ)
        transport = anthropic_transport or HttpAnthropicTransport()
        return AnthropicClient(
            model=settings.model.name,
            api_key=api_key,
            default_max_tokens=settings.model.max_tokens,
            default_temperature=settings.model.temperature,
            timeout_seconds=settings.model.timeout_seconds,
            transport=transport,
            logger=logger,
        )
    elif provider in ("openai", "openclaw"):
        api_key = resolve_env_secret(settings.model.api_key_env, environ)
        return OpenAIClient(
            model=settings.model.name,
            api_key=api_key,
            base_url=settings.model.base_url,
            default_max_tokens=settings.model.max_tokens,
            default_temperature=settings.model.temperature,
            timeout_seconds=settings.model.timeout_seconds,
            agent_id=settings.model.agent_id,
            logger=logger,
        )
    else:
        raise LlmClientError(f"Unsupported model provider: {provider}")


def _parse_anthropic_response(payload: Mapping[str, Any]) -> LlmResponse:
    content = payload.get("content")
    if not isinstance(content, Sequence):
        raise LlmClientError("Anthropic response missing content array.")

    text_parts = []
    for part in content:
        if not isinstance(part, Mapping):
            continue
        if part.get("type") == "text" and isinstance(part.get("text"), str):
            text_parts.append(part["text"])
    text = "".join(text_parts).strip()
    if not text:
        raise LlmClientError("Anthropic response contained no text content.")

    usage = payload.get("usage")
    if isinstance(usage, Mapping):
        input_tokens = _as_int(usage.get("input_tokens"))
        output_tokens = _as_int(usage.get("output_tokens"))
    else:
        input_tokens = 0
        output_tokens = 0

    model = payload.get("model")
    if not isinstance(model, str) or not model.strip():
        model = "unknown"

    stop_reason = payload.get("stop_reason")
    if not isinstance(stop_reason, str):
        stop_reason = None

    return LlmResponse(
        text=text,
        model=model,
        stop_reason=stop_reason,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def _parse_openai_response(payload: Mapping[str, Any]) -> LlmResponse:
    choices = payload.get("choices")
    if not isinstance(choices, Sequence) or not choices:
        raise LlmClientError("OpenAI response missing choices array.")

    choice = choices[0]
    if not isinstance(choice, Mapping):
        raise LlmClientError("OpenAI choice is not an object.")

    message = choice.get("message")
    if not isinstance(message, Mapping):
        raise LlmClientError("OpenAI choice missing message object.")

    text = message.get("content")
    if not isinstance(text, str):
        raise LlmClientError("OpenAI message content is not a string.")

    text = text.strip()
    if not text:
        raise LlmClientError("OpenAI response contained no text content.")

    usage = payload.get("usage")
    if isinstance(usage, Mapping):
        input_tokens = _as_int(usage.get("prompt_tokens"))
        output_tokens = _as_int(usage.get("completion_tokens"))
    else:
        input_tokens = 0
        output_tokens = 0

    model = payload.get("model")
    if not isinstance(model, str) or not model.strip():
        model = "unknown"

    finish_reason = choice.get("finish_reason")
    if not isinstance(finish_reason, str):
        finish_reason = None

    return LlmResponse(
        text=text,
        model=model,
        stop_reason=finish_reason,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def _as_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return 0
    return 0
