#!/usr/bin/env bash
set -euo pipefail

mkdir -p "artifacts"

if [[ -n "${CI_INTEGRATION_SMOKE_CMD:-}" ]]; then
  set +e
  bash -lc "${CI_INTEGRATION_SMOKE_CMD}" 2>&1 | tee "artifacts/integration-smoke.log"
  status=${PIPESTATUS[0]}
  set -e
  exit "${status}"
fi

if [[ ! -d "tests" ]]; then
  echo "No tests directory detected. Skipping integration smoke tests." | tee "artifacts/integration-smoke.log"
  exit 0
fi

if command -v uv >/dev/null 2>&1 && uv run pytest --version >/dev/null 2>&1; then
  PYTEST_RUNNER=(uv run pytest)
elif command -v pytest >/dev/null 2>&1; then
  PYTEST_RUNNER=(pytest)
else
  echo "pytest is unavailable. Set CI_INTEGRATION_SMOKE_CMD or add pytest to dependencies." | tee "artifacts/integration-smoke.log"
  exit 1
fi

set +e
"${PYTEST_RUNNER[@]}" \
  -m "integration or smoke" \
  --maxfail=1 \
  --durations=20 \
  --junitxml "artifacts/integration-smoke-junit.xml" \
  2>&1 | tee "artifacts/integration-smoke.log"
status=${PIPESTATUS[0]}
set -e

if [[ "${status}" -eq 5 ]]; then
  echo "No integration/smoke tests collected with marker expression: integration or smoke." | tee -a "artifacts/integration-smoke.log"
  exit 0
fi

exit "${status}"
