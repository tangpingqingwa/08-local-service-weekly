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
  app/healthz/route.ts app/layout.tsx src/db.ts src/cities.ts \
  src/migrations/001_cities.sql src/migrations/002_weeks.sql \
  src/migrations/003_listings.sql tests/health.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q '/healthz' app/healthz/route.ts || fail "app/healthz missing /healthz"
grep -q 'GET' app/healthz/route.ts || fail "app/healthz missing GET"
grep -q 'getDb' app/healthz/route.ts || fail "app/healthz must probe SQLite"
grep -q 'london' src/cities.ts || fail "src/cities.ts missing London row"
grep -q 'CREATE TABLE cities' src/migrations/001_cities.sql || fail "cities migration missing"
grep -q 'CREATE TABLE weeks' src/migrations/002_weeks.sql || fail "weeks migration missing"
grep -q 'CREATE TABLE listings' src/migrations/003_listings.sql || fail "listings migration missing"
grep -q 'CREATE TABLE checkouts' src/migrations/004_checkouts.sql || fail "checkouts migration missing"

echo "== board UI files =="
for f in app/page.tsx app/c/\[city\]/page.tsx app/c/\[city\]/\[category\]/page.tsx \
  app/c/\[city\]/not-found.tsx app/c/\[city\]/\[category\]/not-found.tsx \
  src/board.ts src/categories.ts src/ui/city-hub.tsx src/ui/lane-board.tsx \
  src/ui/listing-card.tsx src/ui/outbid-form.tsx src/ui/not-found-code.tsx \
  tests/board.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'london' app/page.tsx || grep -q 'DEFAULT_CITY_SLUG' app/page.tsx \
  || fail "app/page.tsx must default to London"
grep -q 'city_unknown' src/cities.ts || fail "unknown city must be city_unknown"
grep -q 'city_unknown' app/c/\[city\]/not-found.tsx \
  || grep -q 'BoardNotFound' app/c/\[city\]/not-found.tsx \
  || fail "unknown city page must surface city_unknown"
grep -q 'Outbid' src/ui/outbid-form.tsx || fail "bid form must render Outbid"
grep -q 'data-empty-lane' src/ui/lane-board.tsx \
  || fail "lane board must have an honest empty-lane state"
grep -q 'data-clicks' src/ui/listing-card.tsx || fail "cards must show public clicks"
grep -q 'data-bid' src/ui/listing-card.tsx || fail "cards must show \$bid"
if grep -RInE '★|⭐|top rated|review count' app src >/dev/null 2>&1; then
  fail "board UI must not render stars or review counts"
fi

echo "== polar checkout + fixture =="
for f in src/polar/port.ts src/polar/fake.ts app/api/checkout/route.ts \
  app/return/page.tsx tests/checkout.test.ts src/migrations/004_checkouts.sql; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'createCheckout' src/polar/port.ts || fail "port.ts must define createCheckout"
grep -q 'settle' src/polar/port.ts || fail "port.ts must define settle"
grep -q 'class FakePolarPort' src/polar/fake.ts || fail "fake.ts must export FakePolarPort"
grep -q 'POLAR_FIXTURE_ONLY' src/polar/port.ts \
  || fail "port.ts must honor POLAR_FIXTURE_ONLY"
grep -q 'bid_too_low' src/polar/port.ts || fail "port.ts must emit bid_too_low"
grep -q 'bid_not_integer' src/polar/port.ts || fail "port.ts must emit bid_not_integer"
grep -q 'data-return' app/return/page.tsx || fail "return page must expose paid/cancelled/unknown"
grep -q '/api/checkout' src/ui/outbid-form.tsx || fail "Outbid form must POST to /api/checkout"
if [[ -f src/polar/live.ts ]]; then
  fail "live Polar belongs in PR 9, not this unit"
fi
if [[ -d app/api/raise ]]; then
  fail "raise-bid belongs in PR 4, not this unit"
fi
grep -q 'bid_too_low' tests/checkout.test.ts || fail "checkout tests must cover bid_too_low"
grep -q 'bid_not_integer' tests/checkout.test.ts || fail "checkout tests must cover bid_not_integer"
if grep -nE 'fetch\(|polar\.sh|api\.polar' src/polar/fake.ts src/polar/port.ts >/dev/null; then
  fail "fixture/port must not call Polar over the network"
fi
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

  echo "== GET / London board and unknown-city 404 =="
  port="${TEST_PORT:-34568}"
  log_file="$(mktemp "${TMPDIR:-/tmp}/lsw-next.XXXXXX.log")"
  db_file="$(mktemp "${TMPDIR:-/tmp}/lsw.XXXXXX.sqlite")"
  server_pid=""
  cleanup_http() {
    if [[ -n "${server_pid}" ]]; then
      kill "${server_pid}" 2>/dev/null || true
      wait "${server_pid}" 2>/dev/null || true
    fi
    rm -f "${log_file}" "${db_file}" "${db_file}-wal" "${db_file}-shm"
  }
  trap cleanup_http EXIT

  export DATABASE_PATH="${db_file}"
  export NEXT_TELEMETRY_DISABLED=1
  npx next build
  PORT="${port}" npx next start --port "${port}" --hostname 127.0.0.1 \
    >"${log_file}" 2>&1 &
  server_pid=$!

  ready=0
  for _ in $(seq 1 60); do
    if ! kill -0 "${server_pid}" 2>/dev/null; then
      fail "next start exited early: $(cat "${log_file}")"
    fi
    if curl -sf "http://127.0.0.1:${port}/healthz" >/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  [[ "${ready}" -eq 1 ]] || fail "GET /healthz did not become ready: $(cat "${log_file}")"

  home_body="$(mktemp)"
  home_code="$(curl -sS -o "${home_body}" -w '%{http_code}' "http://127.0.0.1:${port}/")"
  [[ "${home_code}" == "200" ]] || fail "GET / expected 200 got ${home_code}"
  grep -q 'data-city="london"' "${home_body}" || fail "GET / must default to London"
  grep -q 'data-empty-lane="true"' "${home_body}" || fail "GET / empty London lane must be empty"
  grep -q 'Outbid' "${home_body}" || fail "GET / must show Outbid form chrome"
  if grep -qiE '★|⭐|top rated|review count' "${home_body}"; then
    fail "GET / must not show stars or review counts"
  fi

  city_body="$(mktemp)"
  city_code="$(curl -sS -o "${city_body}" -w '%{http_code}' "http://127.0.0.1:${port}/c/manchester")"
  [[ "${city_code}" == "404" ]] || fail "GET /c/manchester expected 404 got ${city_code}"
  grep -q 'city_unknown' "${city_body}" || fail "unknown city must render city_unknown"
  if grep -q 'data-city="london"' "${city_body}"; then
    fail "unknown city must not silently fall back to London"
  fi

  lane_body="$(mktemp)"
  lane_code="$(curl -sS -o "${lane_body}" -w '%{http_code}' "http://127.0.0.1:${port}/c/london/movers")"
  [[ "${lane_code}" == "200" ]] || fail "GET /c/london/movers expected 200 got ${lane_code}"
  grep -q 'data-empty-lane="true"' "${lane_body}" || fail "empty movers lane must be empty"
  grep -q 'Outbid' "${lane_body}" || fail "lane board must show Outbid form chrome"

  unknown_cat="$(mktemp)"
  unknown_cat_code="$(curl -sS -o "${unknown_cat}" -w '%{http_code}' "http://127.0.0.1:${port}/c/london/plumbers")"
  [[ "${unknown_cat_code}" == "404" ]] || fail "GET /c/london/plumbers expected 404 got ${unknown_cat_code}"
  grep -q 'category_unknown' "${unknown_cat}" || fail "unknown category must render category_unknown"

  echo "== fixture checkout HTTP =="
  paid_body="$(mktemp)"
  paid_code="$(curl -sS -o "${paid_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"North London Movers","category":"movers","city":"london","siteUrl":"https://north.example","amount":20}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${paid_code}" == "200" ]] || fail "POST /api/checkout $20 expected 200 got ${paid_code}: $(cat "${paid_body}")"
  grep -q '"status":"paid"' "${paid_body}" || fail "fixture checkout must return paid"

  movers_paid="$(mktemp)"
  movers_paid_code="$(curl -sS -o "${movers_paid}" -w '%{http_code}' "http://127.0.0.1:${port}/c/london/movers")"
  [[ "${movers_paid_code}" == "200" ]] || fail "GET /c/london/movers after pay expected 200 got ${movers_paid_code}"
  grep -q 'data-rank="1"' "${movers_paid}" || fail "paid $20 must list at rank 1"
  grep -q 'North London Movers' "${movers_paid}" || fail "paid listing must appear on the board"
  grep -q '\$20' "${movers_paid}" || fail "paid listing must show \$20"
  if grep -q 'data-empty-lane="true"' "${movers_paid}"; then
    fail "paid lane must not stay empty"
  fi

  low_body="$(mktemp)"
  low_code="$(curl -sS -o "${low_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Too Cheap","category":"movers","city":"london","siteUrl":"https://cheap.example","amount":4}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${low_code}" == "400" ]] || fail "POST /api/checkout \$4 expected 400 got ${low_code}"
  grep -q 'bid_too_low' "${low_body}" || fail "\$4 must return bid_too_low"

  frac_body="$(mktemp)"
  frac_code="$(curl -sS -o "${frac_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Fractional","category":"movers","city":"london","siteUrl":"https://frac.example","amount":"12.5"}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${frac_code}" == "400" ]] || fail "POST /api/checkout 12.5 expected 400 got ${frac_code}"
  grep -q 'bid_not_integer' "${frac_body}" || fail "12.5 must return bid_not_integer"

  return_unknown="$(mktemp)"
  return_unknown_code="$(curl -sS -o "${return_unknown}" -w '%{http_code}' "http://127.0.0.1:${port}/return")"
  [[ "${return_unknown_code}" == "200" ]] || fail "GET /return expected 200 got ${return_unknown_code}"
  grep -q 'data-return="unknown"' "${return_unknown}" || fail "GET /return without checkout is unknown"

  form_headers="$(mktemp)"
  form_body="$(mktemp)"
  form_code="$(curl -sS -D "${form_headers}" -o "${form_body}" -w '%{http_code}' \
    -X POST \
    --data-urlencode 'business=South London Movers' \
    --data-urlencode 'category=movers' \
    --data-urlencode 'city=london' \
    --data-urlencode 'siteUrl=https://south.example' \
    --data-urlencode 'amount=15' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${form_code}" == "303" ]] || fail "form POST /api/checkout expected 303 got ${form_code}: $(cat "${form_body}")"
  location="$(awk 'BEGIN{IGNORECASE=1} /^location:/{sub("\r",""); print $2; exit}' "${form_headers}")"
  [[ "${location}" == *"/return?checkout="* ]] || fail "form checkout must redirect to /return?checkout= got ${location}"
  if [[ "${location}" == http* ]]; then
    return_url="${location}"
  else
    return_url="http://127.0.0.1:${port}${location}"
  fi

  return_paid="$(mktemp)"
  return_paid_code="$(curl -sS -o "${return_paid}" -w '%{http_code}' "${return_url}")"
  [[ "${return_paid_code}" == "200" ]] || fail "GET return after form pay expected 200 got ${return_paid_code}"
  grep -q 'data-return="paid"' "${return_paid}" || fail "fixture return must show paid"

  movers_two="$(mktemp)"
  curl -sS -o "${movers_two}" "http://127.0.0.1:${port}/c/london/movers"
  grep -q 'South London Movers' "${movers_two}" || fail "\$15 underbid must still list"
  grep -q 'data-rank="2"' "${movers_two}" || fail "\$15 must list below \$20"

  rm -f "${home_body}" "${city_body}" "${lane_body}" "${unknown_cat}" \
    "${paid_body}" "${movers_paid}" "${low_body}" "${frac_body}" \
    "${return_unknown}" "${form_headers}" "${form_body}" "${return_paid}" \
    "${movers_two}"
fi

echo "OK: buildable and testable"
