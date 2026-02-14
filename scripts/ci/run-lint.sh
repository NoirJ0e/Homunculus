#!/usr/bin/env bash
set -euo pipefail

mkdir -p "artifacts"

run_with_log() {
  local cmd="$1"

  set +e
  bash -lc "${cmd}" 2>&1 | tee "artifacts/lint.log"
  local status=${PIPESTATUS[0]}
  set -e

  return "${status}"
}

if [[ -n "${CI_LINT_CMD:-}" ]]; then
  run_with_log "${CI_LINT_CMD}"
  exit 0
fi

if [[ ! -f "pyproject.toml" && ! -f "requirements.txt" ]]; then
  echo "No Python project detected. Skipping lint." | tee "artifacts/lint.log"
  exit 0
fi

if command -v uv >/dev/null 2>&1 && uv run ruff --version >/dev/null 2>&1; then
  run_with_log "uv run ruff check ."
  exit 0
fi

if python -m ruff --version >/dev/null 2>&1; then
  run_with_log "python -m ruff check ."
  exit 0
fi

echo "Ruff is unavailable. Set CI_LINT_CMD or add ruff to dependencies." | tee "artifacts/lint.log"
exit 1
