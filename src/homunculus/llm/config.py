from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .errors import InvalidModelConfigError
from .types import ModelConfig


def model_config_from_mapping(payload: Mapping[str, Any]) -> ModelConfig:
    provider = _required_non_empty_str(payload, "provider")
    model = _required_non_empty_str(payload, "model")
    api_key_env = _optional_non_empty_str(payload, "api_key_env", "ANTHROPIC_API_KEY")
    max_tokens = _optional_positive_int(payload, "max_tokens", 500)
    temperature = _optional_float(payload, "temperature", 0.7)
    base_url = _optional_str(payload, "base_url")

    return ModelConfig(
        provider=provider,
        model=model,
        api_key_env=api_key_env,
        max_tokens=max_tokens,
        temperature=temperature,
        base_url=base_url,
    )


def _required_non_empty_str(payload: Mapping[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise InvalidModelConfigError(f"'{field}' must be a non-empty string.")
    return value.strip()


def _optional_non_empty_str(payload: Mapping[str, Any], field: str, default: str) -> str:
    value = payload.get(field, default)
    if not isinstance(value, str) or not value.strip():
        raise InvalidModelConfigError(f"'{field}' must be a non-empty string.")
    return value.strip()


def _optional_positive_int(payload: Mapping[str, Any], field: str, default: int) -> int:
    value = payload.get(field, default)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise InvalidModelConfigError(f"'{field}' must be a positive integer.")
    return value


def _optional_float(payload: Mapping[str, Any], field: str, default: float) -> float:
    value = payload.get(field, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidModelConfigError(f"'{field}' must be a numeric value.")
    return float(value)


def _optional_str(payload: Mapping[str, Any], field: str) -> str | None:
    value = payload.get(field)
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    raise InvalidModelConfigError(f"'{field}' must be a string if provided.")

