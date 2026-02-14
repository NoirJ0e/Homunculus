# CI Pipeline Contract (OPS-04)

The repository includes a pull-request CI workflow at `.github/workflows/ci.yml`.

## Jobs

1. `lint`
2. `unit-tests`
3. `integration-smoke`

All jobs run on Python 3.12, fail fast on command errors, and upload artifacts even on failure.

## Default Execution Rules

The workflow runs helper scripts under `scripts/ci/`:

- `install-deps.sh`
- `run-lint.sh`
- `run-unit-tests.sh`
- `run-integration-smoke.sh`

Behavior is intentionally deterministic:

1. If dependency manifests exist, dependencies are installed.
2. If no Python project manifests or test directory exist yet, the step is skipped explicitly.
3. If a project is present but required tooling (`ruff`/`pytest`) is missing, the job fails.

## Optional Command Overrides

Set these environment variables in GitHub repository or organization CI settings to use project-specific commands:

- `CI_LINT_CMD`
- `CI_UNIT_TEST_CMD`
- `CI_INTEGRATION_SMOKE_CMD`

When an override variable is set, the corresponding script executes that command verbatim and forwards its exit code.

## Artifacts

Uploaded artifacts by job:

- `lint-artifacts`: `artifacts/lint.log`
- `unit-test-artifacts`: `artifacts/unit-tests.log`, `artifacts/unit-junit.xml`
- `integration-smoke-artifacts`: `artifacts/integration-smoke.log`, `artifacts/integration-smoke-junit.xml`
