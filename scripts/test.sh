#!/usr/bin/env bash
# Offline gate for main. Must exit 0 on a clean clone with no secrets.
# When application code lands, add unit/contract tests here. Do not delete the
# contract checks. Do not require live Polar or other third-party networks.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== contract files =="
for f in README.md SPEC.md BUILD.md CONTRIBUTING.md scripts/test.sh; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done

echo "== contributing rules are documented =="
grep -q 'main must always be buildable' CONTRIBUTING.md \
  || grep -q 'main` must always be buildable' CONTRIBUTING.md \
  || fail "CONTRIBUTING.md does not state the main-branch rule"

echo "== SPEC mentions git collaboration =="
grep -q 'Git collaboration' SPEC.md || fail "SPEC.md missing Git collaboration section"

echo "== SPEC product contract =="
grep -q 'London' SPEC.md || fail "SPEC.md missing v1 city lane London"
grep -q 'business + category + city + site' SPEC.md \
  || fail "SPEC.md missing listing identity"
grep -q 'license' SPEC.md || fail "SPEC.md missing license/takedown rules"
grep -q 'invented' SPEC.md || fail "SPEC.md missing no-invented-ratings rule"
grep -q 'Polar' SPEC.md || fail "SPEC.md missing Polar"
grep -q '\$5' SPEC.md || fail "SPEC.md missing min \$5"
grep -q 'older' SPEC.md || fail "SPEC.md missing older-wins-ties rule"

echo "== BUILD PR sequence =="
grep -q '### PR 1:' BUILD.md || fail "BUILD.md missing ### PR 1:"
grep -q '### PR 9:' BUILD.md || fail "BUILD.md missing ### PR 9:"
grep -q 'live-smoke' BUILD.md || fail "BUILD.md missing live-smoke"
if ! grep -E '^### PR [0-9]+:' BUILD.md >/dev/null; then
  fail "BUILD.md PR headings must be ### PR N: title"
fi

echo "== no committed secrets =="
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files | grep -E '(^|/)\.env$|(^|/)id_rsa$|\.pem$|credentials\.json$' >/dev/null; then
    fail "secret-like path is tracked"
  fi
fi

echo "== markdown is UTF-8 text =="
file -b --mime-encoding README.md SPEC.md BUILD.md CONTRIBUTING.md | grep -qiE 'utf-8|us-ascii' \
  || fail "docs are not UTF-8/ASCII"

echo "== CI job ci exists when workflow is present =="
if [[ -f .github/workflows/ci.yml ]]; then
  grep -qE '^[[:space:]]+ci:' .github/workflows/ci.yml \
    || fail ".github/workflows/ci.yml missing job id ci"
  grep -q 'bash scripts/test.sh' .github/workflows/ci.yml \
    || fail "ci.yml must run bash scripts/test.sh"
  if grep -Eqi 'POLAR_LIVE=1|POLAR_ACCESS_TOKEN=' .github/workflows/ci.yml; then
    fail "CI must not set live Polar flags or secrets"
  fi
  if grep -q 'live-smoke.sh' .github/workflows/ci.yml; then
    fail "live-smoke.sh must not be called from Actions"
  fi
fi

if grep -Eq '^\s*(bash )?scripts/live-smoke\.sh' scripts/test.sh; then
  fail "test.sh must not invoke live-smoke.sh"
fi

echo "== skeleton files =="
for f in package.json tsconfig.json next.config.ts \
  app/healthz/route.ts src/db.ts src/cities.ts \
  src/migrations/001_cities.sql src/migrations/002_weeks.sql \
  src/migrations/003_listings.sql tests/health.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q '/healthz' app/healthz/route.ts || fail "app/healthz missing /healthz"
grep -q 'london' src/cities.ts || fail "src/cities.ts missing London row"
grep -q 'CREATE TABLE cities' src/migrations/001_cities.sql || fail "cities migration missing"
grep -q 'CREATE TABLE weeks' src/migrations/002_weeks.sql || fail "weeks migration missing"
grep -q 'CREATE TABLE listings' src/migrations/003_listings.sql || fail "listings migration missing"

if grep -RInE 'https?://([^/]*\.)?polar\.sh' app src tests >/dev/null 2>&1; then
  fail "app/src/tests must not hard-code polar.sh HTTP"
fi

if [[ -f package.json ]]; then
  echo "== install =="
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  fi

  unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET POLAR_ORGANIZATION_ID
  export POLAR_FIXTURE_ONLY=1
  [[ "${POLAR_LIVE:-}" != "1" ]] || fail "POLAR_LIVE must stay unset in test.sh"

  echo "== tsc --noEmit =="
  npx tsc --noEmit

  echo "== unit tests =="
  test_log="$(mktemp)"
  trap 'rm -f "$test_log"' EXIT
  set +e
  npx tsx --test --test-reporter spec 'tests/**/*.test.ts' | tee "$test_log"
  test_status=${PIPESTATUS[0]}
  set -e
  [[ $test_status -eq 0 ]] || fail "unit tests failed"
  grep -Eq 'tests[[:space:]]+[1-9][0-9]*' "$test_log" \
    || fail "test runner reported 0 tests"
fi

echo "OK: buildable and testable"
