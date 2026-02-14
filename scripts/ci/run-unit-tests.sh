#!/usr/bin/env bash
set -euo pipefail

mkdir -p "artifacts"

if [[ -n "${CI_UNIT_TEST_CMD:-}" ]]; then
  set +e
  bash -lc "${CI_UNIT_TEST_CMD}" 2>&1 | tee "artifacts/unit-tests.log"
  status=${PIPESTATUS[0]}
  set -e
  exit "${status}"
fi

if [[ ! -d "tests" ]]; then
  echo "No tests directory detected. Skipping unit tests." | tee "artifacts/unit-tests.log"
  exit 0
fi

if command -v uv >/dev/null 2>&1 && uv run pytest --version >/dev/null 2>&1; then
  PYTEST_RUNNER=(uv run pytest)
elif command -v pytest >/dev/null 2>&1; then
  PYTEST_RUNNER=(pytest)
else
  echo "pytest is unavailable. Set CI_UNIT_TEST_CMD or add pytest to dependencies." | tee "artifacts/unit-tests.log"
  exit 1
fi

set +e
"${PYTEST_RUNNER[@]}" \
  -m "not integration and not smoke" \
  --maxfail=1 \
  --durations=20 \
  --junitxml "artifacts/unit-junit.xml" \
  2>&1 | tee "artifacts/unit-tests.log"
status=${PIPESTATUS[0]}
set -e

if [[ "${status}" -eq 5 ]]; then
  echo "No unit tests collected with marker expression: not integration and not smoke." | tee -a "artifacts/unit-tests.log"
  exit 0
fi

exit "${status}"
