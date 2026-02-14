#!/usr/bin/env python3
"""Create ~/.homunculus/agents/<npc>/ trees idempotently."""

from __future__ import annotations

from pathlib import Path
import argparse
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from homunculus.ops.bootstrap import bootstrap_agents


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bootstrap Homunculus agent directory trees.")
    parser.add_argument(
        "npc_names",
        nargs="+",
        help="NPC slugs to bootstrap (example: kovach eliza).",
    )
    parser.add_argument(
        "--data-home",
        type=Path,
        default=Path("~/.homunculus"),
        help="Base runtime home. Defaults to ~/.homunculus.",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    try:
        results = bootstrap_agents(args.data_home, args.npc_names)
    except ValueError as exc:
        print(f"Bootstrap error: {exc}", file=sys.stderr)
        return 2

    for result in results:
        print(f"[{result.npc_name}] root={result.agent_root}")
        print(f"  created_dirs={len(result.created_dirs)} created_files={len(result.created_files)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
