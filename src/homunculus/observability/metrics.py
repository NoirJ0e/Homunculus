"""Token and cost metric helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class _Pricing:
    input_per_million_usd: float
    output_per_million_usd: float


_MODEL_PRICING: tuple[tuple[str, _Pricing], ...] = (
    ("claude-sonnet", _Pricing(input_per_million_usd=3.0, output_per_million_usd=15.0)),
    ("claude-haiku", _Pricing(input_per_million_usd=0.8, output_per_million_usd=4.0)),
)


def estimate_completion_cost_usd(
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> Optional[float]:
    if input_tokens < 0 or output_tokens < 0:
        return None

    pricing = _resolve_pricing(model)
    if pricing is None:
        return None

    cost = (
        (input_tokens / 1_000_000.0) * pricing.input_per_million_usd
        + (output_tokens / 1_000_000.0) * pricing.output_per_million_usd
    )
    return round(cost, 8)


def _resolve_pricing(model: str) -> Optional[_Pricing]:
    normalized = model.strip().lower()
    if not normalized:
        return None
    for prefix, pricing in _MODEL_PRICING:
        if normalized.startswith(prefix):
            return pricing
    return None
