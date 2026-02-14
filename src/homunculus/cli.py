"""CLI for Homunculus runtime bootstrap."""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Sequence
import argparse
import asyncio
import json
import sys

from homunculus import __version__
from homunculus.config.settings import SettingsError, load_settings, settings_summary
from homunculus.runtime.app import run_runtime


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Homunculus runtime")
    parser.add_argument(
        "--config",
        type=Path,
        help="Path to JSON config file. Environment variables override file values.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate settings and print a redacted summary.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Boot runtime and stop immediately (startup wiring smoke check).",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"homunculus {__version__}",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        settings = load_settings(config_path=args.config)
    except SettingsError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    if args.check:
        print(json.dumps(settings_summary(settings), indent=2, sort_keys=True))
        return 0

    shutdown_event = None
    if args.once:
        shutdown_event = asyncio.Event()
        shutdown_event.set()

    try:
        asyncio.run(run_runtime(settings=settings, shutdown_event=shutdown_event))
    except KeyboardInterrupt:
        # KeyboardInterrupt is expected during local runs.
        return 130

    return 0
