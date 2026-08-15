#!/usr/bin/env bash
# Release candidate gate — local or CI-safe (no production DB).
# Answers: "Is this commit safe to promote toward staging/production?"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Scalers release candidate ==="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

run() {
  echo "→ $*"
  "$@"
}

run npm run test:voice
run npm run test:mvp

echo "→ dashboard lint"
(cd dashboard && npm run lint)

echo "→ dashboard build"
(cd dashboard && npm run build)

if [[ "${RUN_SMOKE_DB:-}" == "1" ]]; then
  if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    echo "SKIP smoke:db (set RUN_SMOKE_DB=1 and Supabase env)"
  else
    run npm run smoke:db
  fi
else
  echo "SKIP smoke:db (set RUN_SMOKE_DB=1 with staging credentials)"
fi

if [[ "${RUN_SCHEMA_VERIFY:-}" == "1" ]]; then
  run node scripts/verify-staging-schema.js ${SCHEMA_VERIFY_FLAGS:-}
else
  echo "SKIP schema verify (set RUN_SCHEMA_VERIFY=1 for staging)"
fi

echo
echo "=== Release candidate PASSED (code gates) ==="
echo "Before production: complete RELEASE_GATE.md including staging SQL + human approval."
