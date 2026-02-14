#!/usr/bin/env bash
set -euo pipefail

if [[ -f "pyproject.toml" ]]; then
  if command -v uv >/dev/null 2>&1; then
    if [[ -f "uv.lock" ]]; then
      uv sync --frozen --all-extras --dev
    else
      uv sync --all-extras --dev
    fi
  else
    python -m pip install --upgrade pip
    if [[ -f "requirements.txt" ]]; then
      python -m pip install -r requirements.txt
      if [[ -f "requirements-dev.txt" ]]; then
        python -m pip install -r requirements-dev.txt
      fi
    else
      python -m pip install -e ".[dev]" || python -m pip install -e .
    fi
  fi
  exit 0
fi

if [[ -f "requirements.txt" ]]; then
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt
  if [[ -f "requirements-dev.txt" ]]; then
    python -m pip install -r requirements-dev.txt
  fi
  exit 0
fi

echo "No dependency manifest found. Skipping dependency installation."
