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
grep -q 'bid_too_low' tests/checkout.test.ts || fail "checkout tests must cover bid_too_low"
grep -q 'bid_not_integer' tests/checkout.test.ts || fail "checkout tests must cover bid_not_integer"
if grep -nE 'fetch\(|polar\.sh|api\.polar' src/polar/fake.ts src/polar/port.ts >/dev/null; then
  fail "fixture/port must not call Polar over the network"
fi
if grep -RInE 'https?://([^/]*\.)?polar\.sh' app src tests >/dev/null 2>&1; then
  fail "app/src/tests must not hard-code polar.sh HTTP"
fi

echo "== raise-bid difference =="
for f in app/api/raise/route.ts src/listings.ts tests/raise.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'quoteRaise' src/listings.ts || fail "listings.ts must quote a raise"
grep -q 'applyRaise' src/listings.ts || fail "listings.ts must apply a raise"
grep -q 'created_at' src/listings.ts || fail "raise must keep createdAt"
grep -q 'chargeUsd' src/listings.ts || fail "raise must charge the difference"
grep -q 'listing_hidden' src/listings.ts || fail "hidden listings cannot raise"
grep -q 'intent' src/polar/port.ts || fail "raise checkout must carry intent"
grep -q 'POST' app/api/raise/route.ts || fail "app/api/raise missing POST"
echo "== about, rules, and URL hygiene =="
for f in app/about/page.tsx app/rules/page.tsx src/urls.ts tests/urls.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'canonicalizeSiteUrl' src/urls.ts || fail "urls.ts must export canonicalizeSiteUrl"
grep -q 'chat_link' src/urls.ts || fail "urls.ts must reject chat_link"
grep -q 'nsfw' src/urls.ts || fail "urls.ts must reject nsfw"
grep -q 'url_shortener' src/urls.ts || fail "urls.ts must reject url_shortener"
grep -q 'utm_' src/urls.ts || fail "urls.ts must strip utm_ tracking keys"
grep -q 'canonicalizeSiteUrl' src/polar/port.ts || fail "checkout must canonicalize site URLs"
grep -q 'canonicalizeSiteUrl' src/listings.ts || fail "listing identity must use canonical URLs"
grep -q 'href="/about"' app/layout.tsx || fail "nav must link to /about"
grep -q 'href="/rules"' app/layout.tsx || fail "nav must link to /rules"
grep -q 'Rank is the bid' app/about/page.tsx || fail "about must state rank is the bid"
grep -q 'outbid.lol' app/about/page.tsx || fail "about must name outbid.lol"
grep -q 'local-service-weekly' app/about/page.tsx || fail "about must name the vertical"
grep -q 'London' app/about/page.tsx || fail "about must name London v1"
grep -q 'global English' app/about/page.tsx || fail "about must state global English"
grep -q 'min $5' app/rules/page.tsx || fail "rules must state min \$5"
grep -q 'Rank is the bid' app/rules/page.tsx || fail "rules must state rank is the bid"
grep -q 'older' app/rules/page.tsx || fail "rules must state older wins ties"
grep -q 'difference' app/rules/page.tsx || fail "rules must state raise pays the difference"
grep -q 'utm_source' tests/urls.test.ts || fail "url tests must strip utm_source"
grep -q 'chat_link' tests/urls.test.ts || fail "url tests must cover chat_link"
grep -q 'nsfw' tests/urls.test.ts || fail "url tests must cover nsfw"
grep -q 'url_shortener' tests/urls.test.ts || fail "url tests must cover url_shortener"
if grep -RInE '★|⭐|top rated|review count' app/about app/rules src/urls.ts >/dev/null 2>&1; then
  fail "about/rules/urls must not render stars or review counts"
fi
echo "== weekly window + London v1 lane =="
for f in src/week.ts tests/week.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'export function weekId' src/week.ts || fail "week.ts must export weekId"
grep -q 'Europe/London' src/week.ts || fail "week.ts must use Europe/London"
grep -q 'week_closed' src/week.ts || fail "week.ts must reject closed weeks"
grep -q 'week_id = ?' src/board.ts || fail "board must filter lanes by weekId"
grep -q 'lastWeekNumberOne' src/board.ts || fail "board must expose last-week archive, not current #1"
grep -q 'Monday 00:00' tests/week.test.ts || fail "week tests must pin Monday 00:00 London rollover"
grep -q 'week_closed' tests/week.test.ts || fail "week tests must cover week_closed"
grep -q 'Last Week Van' tests/week.test.ts || fail "week tests must keep last week off current #1"
grep -q 'manchester' tests/week.test.ts || fail "week tests must keep ranker keyed by city"
echo "== license and complaint takedown =="
for f in src/takedown.ts tests/takedown.test.ts src/migrations/006_takedowns.sql \
  app/api/takedown/route.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'license_required' src/takedown.ts || fail "takedown.ts must emit license_required"
grep -q 'requireClaimedLicense' src/takedown.ts || fail "takedown.ts must guard claimed licenses"
grep -q 'hideListing' src/takedown.ts || fail "takedown.ts must hide listings"
grep -q 'operatorHideListing' src/takedown.ts || fail "takedown.ts must expose operator hide"
grep -q 'CREATE TABLE takedowns' src/migrations/006_takedowns.sql || fail "takedowns migration missing"
grep -q 'requireClaimedLicense' src/polar/port.ts || fail "checkout draft must require license"
grep -q 'requireClaimedLicense' src/listings.ts || fail "raise must keep license guard"
grep -q 'license_required' tests/takedown.test.ts || fail "takedown tests must cover license_required"
grep -q 'hideListing' tests/takedown.test.ts || fail "takedown tests must hide #1"
grep -q 'not verified' tests/takedown.test.ts || fail "takedown tests must not invent license verification"
grep -q 'invent' tests/takedown.test.ts || fail "takedown tests must refuse invented replacement #1"
if [[ -f src/polar/live.ts ]]; then
  fail "live Polar belongs in PR 9, not this unit"
fi
echo "== public click counts =="
for f in app/go/\[id\]/route.ts src/clicks.ts tests/clicks.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'incrementPublicClick' src/clicks.ts || fail "clicks.ts must increment then redirect"
grep -q 'listing_not_found' src/clicks.ts || fail "clicks.ts must 404 unknown listings"
grep -q 'canonicalizeSiteUrl' src/clicks.ts || fail "click destination must be cleaned"
grep -q 'GET' app/go/\[id\]/route.ts || fail "app/go/[id] missing GET"
grep -q '302' app/go/\[id\]/route.ts || fail "app/go/[id] must 302"
grep -q 'incrementPublicClick' app/go/\[id\]/route.ts || fail "go route must increment clicks"
grep -q 'utm_source' tests/clicks.test.ts || fail "click tests must strip utm_source"
grep -q '302' tests/clicks.test.ts || fail "click tests must assert 302"
grep -q 'listing_not_found' tests/clicks.test.ts || fail "click tests must cover missing listings"
if [[ -f src/polar/live.ts || -f scripts/live-smoke.sh ]]; then
  fail "live Polar / live-smoke belong in PR 9, not this unit"
fi
grep -q 'charged \$5' tests/raise.test.ts \
  || grep -q 'chargeUsd, 5' tests/raise.test.ts \
  || fail "raise tests must assert difference-only charge"
grep -q 'createdAt' tests/raise.test.ts || fail "raise tests must keep createdAt"
grep -q 'Rival' tests/raise.test.ts || fail "raise tests must cover rival difference"

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
  export OPERATOR_SECRET="operator-test-secret"
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
  grep -q 'data-week="' "${home_body}" || fail "GET / must stamp the open weekId"
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

  echo "== fixture raise HTTP =="
  raise_body="$(mktemp)"
  raise_code="$(curl -sS -o "${raise_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"North London Movers","category":"movers","city":"london","siteUrl":"https://north.example","amount":25}' \
    "http://127.0.0.1:${port}/api/raise")"
  [[ "${raise_code}" == "200" ]] || fail "POST /api/raise \$25 expected 200 got ${raise_code}: $(cat "${raise_body}")"
  grep -q '"status":"paid"' "${raise_body}" || fail "fixture raise must return paid"
  grep -q '"chargedUsd":5' "${raise_body}" || fail "raise \$20→\$25 must charge \$5"
  grep -q '"bidUsd":25' "${raise_body}" || fail "raise must list at \$25"

  movers_raised="$(mktemp)"
  curl -sS -o "${movers_raised}" "http://127.0.0.1:${port}/c/london/movers"
  grep -q 'North London Movers' "${movers_raised}" || fail "raised listing must stay on the board"
  grep -q '\$25' "${movers_raised}" || fail "raised listing must show \$25"
  grep -q 'data-rank="1"' "${movers_raised}" || fail "raised \$25 must stay #1"
  grep -q 'South London Movers' "${movers_raised}" || fail "\$15 underbid must still list after raise"

  rival_body="$(mktemp)"
  rival_code="$(curl -sS -o "${rival_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Rival Van","category":"movers","city":"london","siteUrl":"https://rival.example","amount":5}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${rival_code}" == "200" ]] || fail "rival \$5 checkout expected 200 got ${rival_code}: $(cat "${rival_body}")"
  movers_rival="$(mktemp)"
  curl -sS -o "${movers_rival}" "http://127.0.0.1:${port}/c/london/movers"
  grep -q 'Rival Van' "${movers_rival}" || fail "rival \$5 must still list"
  grep -q '\$25' "${movers_rival}" || fail "occupant must remain at \$25 after rival difference"
  if ! grep -q 'North London Movers' "${movers_rival}"; then
    fail "occupant must remain listed after rival difference"
  fi
  occupant_rank="$(python3 -c 'import re,sys; html=open(sys.argv[1]).read(); m=re.search(r"data-rank=\"(\d)\"[\s\S]{0,400}North London Movers", html); print(m.group(1) if m else "")' "${movers_rival}")"
  [[ "${occupant_rank}" == "1" ]] || fail "rival paying the difference must not take #1 (occupant rank=${occupant_rank})"
  rival_rank="$(python3 -c 'import re,sys; html=open(sys.argv[1]).read(); m=re.search(r"data-rank=\"(\d)\"[\s\S]{0,400}Rival Van", html); print(m.group(1) if m else "")' "${movers_rival}")"
  [[ "${rival_rank}" != "1" ]] || fail "rival \$5 must not be rank 1"

  same_raise="$(mktemp)"
  same_raise_code="$(curl -sS -o "${same_raise}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"North London Movers","category":"movers","city":"london","siteUrl":"https://north.example","amount":25}' \
    "http://127.0.0.1:${port}/api/raise")"
  [[ "${same_raise_code}" == "400" ]] || fail "same-bid raise expected 400 got ${same_raise_code}"
  grep -q 'bid_too_low' "${same_raise}" || fail "same-bid raise must return bid_too_low"

  echo "== about + rules HTTP =="
  about_body="$(mktemp)"
  about_code="$(curl -sS -o "${about_body}" -w '%{http_code}' "http://127.0.0.1:${port}/about")"
  [[ "${about_code}" == "200" ]] || fail "GET /about expected 200 got ${about_code}"
  grep -q 'data-page="about"' "${about_body}" || fail "GET /about must render about"
  grep -q 'Rank is the bid' "${about_body}" || fail "GET /about must state rank is the bid"
  grep -q 'outbid.lol' "${about_body}" || fail "GET /about must name outbid.lol"
  grep -q 'London' "${about_body}" || fail "GET /about must name London"
  grep -qi 'global English' "${about_body}" || fail "GET /about must state global English"
  if grep -qiE '★|⭐|top rated|review count' "${about_body}"; then
    fail "GET /about must not show stars or review counts"
  fi

  rules_body="$(mktemp)"
  rules_code="$(curl -sS -o "${rules_body}" -w '%{http_code}' "http://127.0.0.1:${port}/rules")"
  [[ "${rules_code}" == "200" ]] || fail "GET /rules expected 200 got ${rules_code}"
  grep -q 'data-page="rules"' "${rules_body}" || fail "GET /rules must render rules"
  grep -q 'min $5' "${rules_body}" || fail "GET /rules must state min \$5"
  grep -q 'Rank is the bid' "${rules_body}" || fail "GET /rules must state rank is the bid"
  grep -q 'older' "${rules_body}" || fail "GET /rules must state older wins ties"
  grep -q 'difference' "${rules_body}" || fail "GET /rules must state raise pays the difference"

  echo "== URL hygiene HTTP =="
  tracked_body="$(mktemp)"
  tracked_code="$(curl -sS -o "${tracked_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Tracked Van","category":"movers","city":"london","siteUrl":"https://tracked.example/van?utm_source=x&gclid=1","amount":12}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${tracked_code}" == "200" ]] || fail "tracked URL checkout expected 200 got ${tracked_code}: $(cat "${tracked_body}")"
  movers_tracked="$(mktemp)"
  curl -sS -o "${movers_tracked}" "http://127.0.0.1:${port}/c/london/movers"
  grep -q 'Tracked Van' "${movers_tracked}" || fail "tracked listing must appear after pay"
  grep -q 'tracked.example' "${movers_tracked}" || fail "cleaned host must appear on the board"
  if grep -q 'utm_source' "${movers_tracked}"; then
    fail "board must not show utm_source after store"
  fi

  chat_body="$(mktemp)"
  chat_code="$(curl -sS -o "${chat_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Chat Van","category":"movers","city":"london","siteUrl":"https://t.me/joinchat/abc","amount":12}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${chat_code}" == "400" ]] || fail "telegram checkout expected 400 got ${chat_code}"
  grep -q 'chat_link' "${chat_body}" || fail "telegram must return chat_link"

  nsfw_body="$(mktemp)"
  nsfw_code="$(curl -sS -o "${nsfw_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Adult Clinic","category":"movers","city":"london","siteUrl":"https://onlyfans.com/x","amount":12}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${nsfw_code}" == "400" ]] || fail "NSFW checkout expected 400 got ${nsfw_code}"
  grep -q 'nsfw' "${nsfw_body}" || fail "adult host must return nsfw"

  short_body="$(mktemp)"
  short_code="$(curl -sS -o "${short_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Short Van","category":"movers","city":"london","siteUrl":"https://bit.ly/abc","amount":12}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${short_code}" == "400" ]] || fail "shortener checkout expected 400 got ${short_code}"
  grep -q 'url_shortener' "${short_body}" || fail "shortener must return url_shortener"

  movers_hygiene="$(mktemp)"
  curl -sS -o "${movers_hygiene}" "http://127.0.0.1:${port}/c/london/movers"
  if grep -qiE 'Chat Van|Adult Clinic|Short Van|t.me|onlyfans|bit.ly' "${movers_hygiene}"; then
    fail "rejected chat/NSFW/shortener URLs must not list"
  fi

  echo "== weekly window HTTP =="
  open_week="$(npx tsx -e 'import { currentWeekId } from "./src/week.ts"; process.stdout.write(currentWeekId())')"
  last_week="$(npx tsx -e 'import { currentWeekId, previousWeekId } from "./src/week.ts"; process.stdout.write(previousWeekId(currentWeekId()))')"
  grep -q "data-week=\"${open_week}\"" "${movers_hygiene}" \
    || fail "lane board must stamp open weekId ${open_week}"

  closed_week_body="$(mktemp)"
  closed_week_code="$(curl -sS -o "${closed_week_body}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d "{\"business\":\"Stale Van\",\"category\":\"movers\",\"city\":\"london\",\"siteUrl\":\"https://stale.example\",\"amount\":20,\"weekId\":\"${last_week}\"}" \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${closed_week_code}" == "409" ]] \
    || fail "closed week checkout expected 409 got ${closed_week_code}: $(cat "${closed_week_body}")"
  grep -q 'week_closed' "${closed_week_body}" || fail "closed week must return week_closed"

  DATABASE_PATH="${db_file}" npx tsx -e '
    import { openDatabase } from "./src/db.ts";
    import { currentWeekId, ensureWeek, previousWeekId } from "./src/week.ts";
    const db = openDatabase(process.env.DATABASE_PATH);
    const last = previousWeekId(currentWeekId());
    ensureWeek(db, last);
    db.prepare(
      `INSERT INTO listings (
         id, business, category, city, site_url, license_id, bid_usd, week_id,
         created_at, raised_at, clicks, hidden, hidden_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "lst_last_week",
      "Last Week Van",
      "movers",
      "london",
      "https://last.example",
      null,
      99,
      last,
      "2026-08-10T00:00:00.000Z",
      null,
      0,
      0,
      null,
    );
    db.close();
  '

  movers_week="$(mktemp)"
  curl -sS -o "${movers_week}" "http://127.0.0.1:${port}/c/london/movers"
  grep -q 'data-empty-lane="true"' "${movers_week}" && fail "open week with paid listings must not be empty"
  grep -q 'data-last-week' "${movers_week}" || fail "board may show last week as archive copy"
  grep -q 'Last Week Van' "${movers_week}" || fail "last week #1 may appear as archive copy"
  occupant_week_rank="$(python3 -c 'import re,sys; html=open(sys.argv[1]).read(); m=re.search(r"data-rank=\"(\d)\"[\s\S]{0,400}Last Week Van", html); print(m.group(1) if m else "")' "${movers_week}")"
  [[ -z "${occupant_week_rank}" ]] || fail "last week must not be current #1 (rank=${occupant_week_rank})"
  current_one="$(python3 -c 'import re,sys; html=open(sys.argv[1]).read(); m=re.search(r"data-rank=\"1\"[\s\S]{0,400}<h3 class=\"business\">([^<]+)", html); print(m.group(1) if m else "")' "${movers_week}")"
  [[ "${current_one}" != "Last Week Van" ]] || fail "last week occupant must not be this week #1"
  grep -q 'North London Movers' "${movers_week}" || fail "current-week occupant must remain listed"

  echo "== license + takedown HTTP =="
  dentist_missing="$(mktemp)"
  dentist_missing_code="$(curl -sS -o "${dentist_missing}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Soho Smile","category":"dentists","city":"london","siteUrl":"https://soho.example","amount":20}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${dentist_missing_code}" == "400" ]] \
    || fail "dentist without license expected 400 got ${dentist_missing_code}: $(cat "${dentist_missing}")"
  grep -q 'license_required' "${dentist_missing}" || fail "dentist without license must return license_required"

  lawyer_missing="$(mktemp)"
  lawyer_missing_code="$(curl -sS -o "${lawyer_missing}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Thames Counsel","category":"immigration_lawyers","city":"london","siteUrl":"https://thames.example","amount":20}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${lawyer_missing_code}" == "400" ]] \
    || fail "immigration lawyer without license expected 400 got ${lawyer_missing_code}"
  grep -q 'license_required' "${lawyer_missing}" || fail "immigration lawyer without license must return license_required"

  dentist_paid="$(mktemp)"
  dentist_paid_code="$(curl -sS -o "${dentist_paid}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Soho Smile","category":"dentists","city":"london","siteUrl":"https://soho.example","licenseId":"GDC-12345","amount":20}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${dentist_paid_code}" == "200" ]] \
    || fail "dentist with claimed license expected 200 got ${dentist_paid_code}: $(cat "${dentist_paid}")"
  dentist_board="$(mktemp)"
  curl -sS -o "${dentist_board}" "http://127.0.0.1:${port}/c/london/dentists"
  grep -q 'Soho Smile' "${dentist_board}" || fail "claimed-license dentist must list"
  grep -q 'GDC-12345' "${dentist_board}" || fail "board must show claimed license id"
  grep -q 'not verified' "${dentist_board}" || fail "board must say claimed license is not verified"
  if grep -qiE 'license verified|verified license' "${dentist_board}"; then
    fail "board must not invent license verification"
  fi

  dentist_two="$(mktemp)"
  dentist_two_code="$(curl -sS -o "${dentist_two}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"East Smile","category":"dentists","city":"london","siteUrl":"https://eastsmile.example","licenseId":"GDC-99999","amount":15}' \
    "http://127.0.0.1:${port}/api/checkout")"
  [[ "${dentist_two_code}" == "200" ]] \
    || fail "second dentist expected 200 got ${dentist_two_code}: $(cat "${dentist_two}")"

  listing_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("listingId") or "")' "${dentist_paid}")"
  [[ -n "${listing_id}" ]] || fail "paid dentist checkout must return listingId"

  takedown_denied="$(mktemp)"
  takedown_denied_code="$(curl -sS -o "${takedown_denied}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d "{\"listingId\":\"${listing_id}\",\"reason\":\"unlicensed\"}" \
    "http://127.0.0.1:${port}/api/takedown")"
  [[ "${takedown_denied_code}" == "401" ]] \
    || fail "takedown without secret expected 401 got ${takedown_denied_code}"
  grep -q 'operator_unauthorized' "${takedown_denied}" || fail "takedown without secret must be operator_unauthorized"

  takedown_ok="$(mktemp)"
  takedown_ok_code="$(curl -sS -o "${takedown_ok}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -H 'x-operator-secret: operator-test-secret' \
    -d "{\"listingId\":\"${listing_id}\",\"reason\":\"unlicensed\"}" \
    "http://127.0.0.1:${port}/api/takedown")"
  [[ "${takedown_ok_code}" == "200" ]] \
    || fail "operator takedown expected 200 got ${takedown_ok_code}: $(cat "${takedown_ok}")"
  grep -q '"hidden":true' "${takedown_ok}" || fail "takedown must hide the listing"

  dentists_after="$(mktemp)"
  curl -sS -o "${dentists_after}" "http://127.0.0.1:${port}/c/london/dentists"
  if grep -q 'Soho Smile' "${dentists_after}"; then
    fail "taken-down #1 must drop off the public board"
  fi
  grep -q 'East Smile' "${dentists_after}" || fail "next visible bid must remain listed"
  next_rank="$(python3 -c 'import re,sys; html=open(sys.argv[1]).read(); m=re.search(r"data-rank=\"(\d)\"[\s\S]{0,400}East Smile", html); print(m.group(1) if m else "")' "${dentists_after}")"
  [[ "${next_rank}" == "1" ]] || fail "next visible bid must be #1 after takedown (rank=${next_rank})"
  if grep -qiE 'invented|placeholder clinic|example dentist' "${dentists_after}"; then
    fail "takedown must not invent a replacement listing"
  fi
  unset OPERATOR_SECRET

  hidden_raise="$(mktemp)"
  hidden_raise_code="$(curl -sS -o "${hidden_raise}" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Soho Smile","category":"dentists","city":"london","siteUrl":"https://soho.example","licenseId":"GDC-12345","amount":25}' \
    "http://127.0.0.1:${port}/api/raise")"
  [[ "${hidden_raise_code}" == "409" ]] \
    || fail "raise on hidden listing expected 409 got ${hidden_raise_code}: $(cat "${hidden_raise}")"
  grep -q 'listing_hidden' "${hidden_raise}" || fail "hidden listing cannot raise"

  echo "== public click HTTP =="
  click_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("listingId") or "")' "${tracked_body}")"
  [[ -n "${click_id}" ]] || fail "tracked checkout must return listingId for /go/:id"

  click_headers="$(mktemp)"
  click_body="$(mktemp)"
  click_code="$(curl -sS -D "${click_headers}" -o "${click_body}" -w '%{http_code}' \
    "http://127.0.0.1:${port}/go/${click_id}?utm_source=injected")"
  [[ "${click_code}" == "302" ]] \
    || fail "GET /go/:id expected 302 got ${click_code}: $(cat "${click_body}")"
  click_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/{sub("\r",""); print $2; exit}' "${click_headers}")"
  [[ "${click_location}" == "https://tracked.example/van" ]] \
    || fail "click must 302 to cleaned URL got ${click_location}"
  if echo "${click_location}" | grep -Eqi 'utm_|gclid|fbclid|\?'; then
    fail "click destination must have no tracking query: ${click_location}"
  fi

  movers_clicked="$(mktemp)"
  curl -sS -o "${movers_clicked}" "http://127.0.0.1:${port}/c/london/movers"
  grep -q 'Tracked Van' "${movers_clicked}" || fail "clicked listing must stay on the board"
  grep -q '1 click' "${movers_clicked}" || fail "public click count must increment to 1"

  click_again_headers="$(mktemp)"
  click_again_body="$(mktemp)"
  click_again_code="$(curl -sS -D "${click_again_headers}" -o "${click_again_body}" -w '%{http_code}' \
    "http://127.0.0.1:${port}/go/${click_id}")"
  [[ "${click_again_code}" == "302" ]] \
    || fail "second GET /go/:id expected 302 got ${click_again_code}"
  click_again_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/{sub("\r",""); print $2; exit}' "${click_again_headers}")"
  [[ "${click_again_location}" == "https://tracked.example/van" ]] \
    || fail "second click must 302 to cleaned URL got ${click_again_location}"

  movers_clicked_two="$(mktemp)"
  curl -sS -o "${movers_clicked_two}" "http://127.0.0.1:${port}/c/london/movers"
  grep -q '2 clicks' "${movers_clicked_two}" || fail "public click count must increment to 2"

  missing_click="$(mktemp)"
  missing_click_code="$(curl -sS -o "${missing_click}" -w '%{http_code}' \
    "http://127.0.0.1:${port}/go/does-not-exist")"
  [[ "${missing_click_code}" == "404" ]] \
    || fail "GET /go/missing expected 404 got ${missing_click_code}"
  grep -q 'listing_not_found' "${missing_click}" || fail "missing listing click must be listing_not_found"

  rm -f "${home_body}" "${city_body}" "${lane_body}" "${unknown_cat}" \
    "${paid_body}" "${movers_paid}" "${low_body}" "${frac_body}" \
    "${return_unknown}" "${form_headers}" "${form_body}" "${return_paid}" \
    "${movers_two}" "${raise_body}" "${movers_raised}" "${rival_body}" \
    "${movers_rival}" "${same_raise}" "${about_body}" "${rules_body}" \
    "${tracked_body}" "${movers_tracked}" "${chat_body}" "${nsfw_body}" \
    "${short_body}" "${movers_hygiene}" "${closed_week_body}" "${movers_week}" \
    "${dentist_missing}" "${lawyer_missing}" "${dentist_paid}" "${dentist_board}" \
    "${dentist_two}" "${takedown_denied}" "${takedown_ok}" "${dentists_after}" \
    "${hidden_raise}" "${click_headers}" "${click_body}" "${movers_clicked}" \
    "${click_again_headers}" "${click_again_body}" "${movers_clicked_two}" \
    "${missing_click}"
fi

echo "OK: buildable and testable"
