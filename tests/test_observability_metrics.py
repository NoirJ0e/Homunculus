from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.observability.metrics import estimate_completion_cost_usd


class ObservabilityMetricsTests(unittest.TestCase):
    def test_estimates_cost_for_known_sonnet_model(self) -> None:
        cost = estimate_completion_cost_usd(
            model="claude-sonnet-4-5-20250929",
            input_tokens=10_000,
            output_tokens=2_000,
        )
        self.assertEqual(cost, 0.06)

    def test_estimates_cost_for_known_haiku_model(self) -> None:
        cost = estimate_completion_cost_usd(
            model="claude-haiku-4-5-20251001",
            input_tokens=50_000,
            output_tokens=10_000,
        )
        self.assertEqual(cost, 0.08)

    def test_returns_none_for_unknown_model(self) -> None:
        cost = estimate_completion_cost_usd(
            model="custom-provider-model",
            input_tokens=100,
            output_tokens=100,
        )
        self.assertIsNone(cost)

    def test_returns_none_for_negative_tokens(self) -> None:
        cost = estimate_completion_cost_usd(
            model="claude-sonnet-4-5-20250929",
            input_tokens=-1,
            output_tokens=100,
        )
        self.assertIsNone(cost)


if __name__ == "__main__":
    unittest.main()
