#!/usr/bin/env bash
# Offline gate for Local Service Weekly. No provider network, secrets, or browser.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

need_file() {
  [[ -s "$1" ]] || fail "missing or empty $1"
}

echo "== contract files =="
for f in README.md SPEC.md BUILD.md CONTRIBUTING.md package.json tsconfig.json scripts/test.sh; do
  need_file "$f"
done
grep -q 'main must always be buildable' CONTRIBUTING.md \
  || grep -q 'main.*must always be buildable' CONTRIBUTING.md \
  || fail "CONTRIBUTING.md must state the main-branch rule"
grep -q 'Git collaboration' SPEC.md || fail "SPEC.md missing Git collaboration"
grep -q 'London' SPEC.md || fail "SPEC.md missing London"
grep -q 'business + category + city + site' SPEC.md || fail "SPEC.md missing listing identity"
grep -q 'license' SPEC.md || fail "SPEC.md missing license rules"
grep -q 'invented' SPEC.md || fail "SPEC.md missing no-invented-data rule"
grep -q 'Waffo' SPEC.md || fail "SPEC.md missing Waffo"
grep -q '\$5' SPEC.md || fail "SPEC.md missing minimum bid"
grep -q 'older' SPEC.md || fail "SPEC.md missing tie-break rule"

echo "== CI and offline boundary =="
if [[ -f .github/workflows/ci.yml ]]; then
  grep -qE '^[[:space:]]+ci:' .github/workflows/ci.yml || fail "CI job id ci missing"
  grep -q 'bash scripts/test.sh' .github/workflows/ci.yml || fail "CI must run scripts/test.sh"
  grep -q 'actions/setup-node@v4' .github/workflows/ci.yml || fail "CI must pin setup-node"
  grep -q 'node-version: 22' .github/workflows/ci.yml || fail "CI must use Node 22"
  if grep -Eqi 'POLAR_LIVE=1|POLAR_ACCESS_TOKEN=|WAFFO_LIVE=1|WAFFO_MODE=waffo-|PAYMENT_MODE=waffo-|WAFFO_PRIVATE_KEY=|live-smoke.sh' .github/workflows/ci.yml; then
    fail "CI must not run a live provider or live smoke"
  fi
fi
if grep -Eq '^[[:space:]]*(bash[[:space:]]+)?(\./)?scripts/live-smoke\.sh' scripts/test.sh; then
  fail "test.sh must not invoke live-smoke.sh"
fi

echo "== Node 22 and durable SQLite contract =="
command -v node >/dev/null 2>&1 || fail "Node is required"
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" =~ ^[0-9]+$ && "$node_major" -ge 22 ]] \
  || fail "Node 22 or newer is required (found ${node_major:-unknown})"
grep -Eq '"node"[[:space:]]*:[[:space:]]*">=22"' package.json \
  || fail "package.json must declare Node >=22"
grep -q 'better-sqlite3' package.json || fail "package.json must use better-sqlite3"
for migration in src/migrations/*.sql; do
  need_file "$migration"
done
migration_count="$(rg --files src/migrations | rg '\.sql$' | wc -l | tr -d ' ')"
[[ "$migration_count" =~ ^[0-9]+$ && "$migration_count" -ge 9 ]] \
  || fail "all durable SQLite migrations must be present (found ${migration_count:-0})"
grep -q 'DATABASE_PATH' src/db.ts || fail "SQLite must honor DATABASE_PATH"
grep -q 'journal_mode = WAL' src/db.ts || fail "file-backed SQLite must use WAL"
grep -q 'schema_migrations' src/db.ts || fail "SQLite migrations must be recorded"
grep -q 'DATABASE_PATH' src/billing/waffo-session.ts || fail "Waffo readiness must require durable DATABASE_PATH"
grep -q 'databasePath === ":memory:"' src/billing/waffo-session.ts \
  || fail "production Waffo must reject in-memory SQLite"
grep -q 'restart and two independent instances share one atomic Waffo ledger' tests/waffo-webhook.test.ts \
  || fail "Waffo tests must cover restart/concurrent durable ledger behavior"

echo "== skeleton and domain =="
for f in app/page.tsx app/layout.tsx app/healthz/route.ts \
  'app/c/[city]/page.tsx' 'app/c/[city]/[category]/page.tsx' \
  'app/c/[city]/not-found.tsx' 'app/c/[city]/[category]/not-found.tsx' \
  src/db.ts src/cities.ts src/categories.ts src/constants.ts src/board.ts \
  src/week.ts src/urls.ts src/migrations/001_cities.sql \
  src/migrations/002_weeks.sql src/migrations/003_listings.sql \
  src/migrations/004_checkouts.sql tests/board.test.ts tests/live-smoke.test.ts; do
  need_file "$f"
done
grep -q 'DEFAULT_CITY_SLUG' app/page.tsx || fail "home must default to London"
grep -q 'london' src/cities.ts || fail "catalog must ship London"
grep -q 'city_unknown' src/cities.ts || fail "unknown city code missing"
grep -q 'category_unknown' src/categories.ts || fail "unknown category code missing"
grep -q 'GET' app/healthz/route.ts || fail "healthz GET missing"
grep -q 'validateWaffoConfiguration' app/healthz/route.ts || fail "healthz Waffo readiness missing"
grep -q 'status: 503' app/healthz/route.ts || fail "healthz not-ready status missing"

echo "== Local Service Weekly identity =="
[[ ! -e app/parity.css ]] || fail "target parity CSS must be removed from runtime"
if grep -RInE 'OUTBID_|OutbidReferenceActivity|REFERENCE_RAIL|presentation-card|today-strip|activity-strip|outbid-mark|parity\.css|data-display-rank' app/layout.tsx src/ui app/globals.css >/dev/null 2>&1; then
  fail "shared reference fixture markers remain in the ordinary renderer"
fi
if grep -RInE 'rail-bot|rail-megaphone|layout-grid-light|trophy\.svg|dm-sans' app src/ui >/dev/null 2>&1; then
  fail "target assets remain referenced by the ordinary renderer"
fi
if grep -RInE '★|⭐|top rated|review count|favicon|avatar|map pin|google map' app/layout.tsx src/ui app/globals.css >/dev/null 2>&1; then
  fail "ratings, map, or generated media remain in the paper surface"
fi
grep -q 'Local Service Weekly' app/layout.tsx src/ui/edition.tsx || fail "paper brand missing"
grep -q 'Last 7 days' app/layout.tsx src/ui/edition.tsx || fail "rolling window copy missing"
grep -q 'Rank is the bid' app/layout.tsx src/ui/edition.tsx || fail "rank contract missing"
grep -q '#2b241b' app/globals.css || fail "dark-brown canvas missing"
grep -q 'var(--paper)' app/globals.css || fail "tan paper token missing"
grep -q '4px double' app/globals.css || fail "double-rule masthead missing"
grep -q 'classified-columns' app/globals.css src/ui/city-hub.tsx || fail "four-column paper missing"
grep -q '@media (max-width: 700px)' app/globals.css || fail "mobile paper layout missing"
grep -q 'min-height: 2.75rem' app/globals.css || fail "amount stepper controls must be at least 44px"
grep -q 'Claim #1 for' src/ui/outbid-form.tsx || fail "Claim #1 want-ad missing"
grep -q 'className="outbid"' src/ui/outbid-form.tsx || fail "Outbid action missing"
grep -q 'Decrease bid by one dollar' src/ui/outbid-form.tsx || fail "minus stepper missing"
grep -q 'Increase bid by one dollar' src/ui/outbid-form.tsx || fail "plus stepper missing"
grep -q 'Business' src/ui/outbid-form.tsx || fail "Business field missing"
grep -q 'Site URL' src/ui/outbid-form.tsx || fail "Site URL field missing"
grep -q 'Claimed license id' src/ui/outbid-form.tsx || fail "claimed license field missing"
grep -q 'data-bid-usd' src/ui/listing-card.tsx || fail "bid fact missing"
grep -q 'data-clicks' src/ui/listing-card.tsx || fail "click fact missing"
grep -q 'data-first-click="call"' src/ui/listing-card.tsx || fail "primary call marker missing"
grep -q 'data-later-call' src/ui/listing-card.tsx || fail "later call marker missing"
grep -q 'Claimed license' src/ui/listing-card.tsx || fail "license honesty copy missing"
grep -q 'No #1' src/ui/lane-board.tsx || fail "honest empty lane missing"
grep -q 'Ratings and map position do not' src/ui/lane-board.tsx \
  && grep -q 'affect the board' src/ui/lane-board.tsx \
  && grep -q 'An incomplete checkout stays off the paper' src/ui/lane-board.tsx \
  || fail "empty-lane honesty copy missing"
grep -q 'data-empty-honest' src/ui/lane-board.tsx || fail "empty-lane marker missing"
grep -q 'charges only the difference' src/ui/lane-board.tsx src/ui/outbid-form.tsx \
  && grep -q 'not a full rebid' src/ui/lane-board.tsx src/ui/outbid-form.tsx \
  || fail "difference-only copy missing"
grep -q 'data-raise-difference' src/ui/lane-board.tsx src/ui/outbid-form.tsx || fail "difference marker missing"
grep -q 'data-provider-paid' src/ui/listing-card.tsx || fail "paid marker missing"
grep -q 'isProviderPaidListing' src/ui/listing-card.tsx src/ui/lane-board.tsx || fail "paid guard missing"
grep -q 'emptyPaper={!occupied}' 'app/c/[city]/[category]/page.tsx' || fail "empty lane must own empty paper state"
grep -q 'showForm={occupied}' 'app/c/[city]/[category]/page.tsx' || fail "occupied lane must own raise form"
grep -q 'data-category-tabs' src/ui/column-index.tsx || fail "category index missing"
grep -q 'CATEGORIES.map' src/ui/city-hub.tsx || fail "service desks must be data-driven"
[[ "$(grep -c '{ slug:' src/categories.ts | tr -d ' ')" == "4" ]] || fail "service taxonomy must contain exactly four rows"
for category in movers dentists immigration_lawyers tutors; do
  grep -q "$category" src/categories.ts || fail "missing service desk $category"
done
grep -q 'movers.*licenseRequired: false' src/categories.ts || fail "movers license rule missing"
grep -q 'dentists.*licenseRequired: true' src/categories.ts || fail "dentists license rule missing"
grep -q 'immigration_lawyers.*licenseRequired: true' src/categories.ts || fail "immigration lawyer license rule missing"
grep -q 'tutors.*licenseRequired: false' src/categories.ts || fail "tutors license rule missing"

echo "== renderer ownership =="
if grep -RInE 'HeaderPeriodTabs|SearchPopover|showColumnIndex|today-strip|activity-strip|REFERENCE_RAIL|OutbidReferenceActivity' app/layout.tsx src/ui app/globals.css >/dev/null 2>&1; then
  fail "old target shell or compatibility surface is still mounted"
fi
grep -q 'ClassifiedEdition' src/ui/city-hub.tsx || fail "hub must render ClassifiedEdition"
grep -q 'LaneBoard' src/ui/city-hub.tsx || fail "hub must render lane boards"
grep -q 'ClaimColumn' src/ui/city-hub.tsx || fail "hub must render local claim routes"
grep -q 'ColumnIndex' src/ui/city-hub.tsx || fail "occupied paper must render local column index"
grep -q 'paper-empty' src/ui/edition.tsx || fail "empty paper class missing"
grep -q 'paper-occupied' src/ui/edition.tsx || fail "occupied paper class missing"
grep -q 'data-paper-empty' src/ui/edition.tsx || fail "empty paper marker missing"
grep -q 'data-paper-occupied' src/ui/edition.tsx || fail "occupied paper marker missing"
grep -q 'paper-empty\[data-paper-empty\]' app/globals.css || fail "empty paper scope missing"
grep -q 'paper-occupied\[data-paper-occupied\]' app/globals.css || fail "occupied paper scope missing"
grep -q 'paper-empty\[data-paper-empty\] \[data-later-fact\]' app/globals.css || fail "empty paper fact guard missing"
grep -q 'paper-occupied\[data-paper-occupied\] .lane-empty\[data-lane-empty\]' app/globals.css || fail "mixed paper empty lane guard missing"
grep -q 'paper-occupied\[data-paper-occupied\] .lane-occupied\[data-lane-occupied\] .later-call' app/globals.css || fail "occupied later call scope missing"

echo "== provider, licensing, and public facts =="
for f in src/billing/port.ts src/billing/fake.ts src/billing/live.ts \
  src/billing/waffo-session.ts app/api/checkout/route.ts app/api/raise/route.ts \
  app/api/takedown/route.ts src/listings.ts src/takedown.ts src/clicks.ts \
  'app/go/[id]/route.ts' app/return/page.tsx tests/checkout.test.ts \
  tests/raise.test.ts tests/clicks.test.ts tests/takedown.test.ts \
  src/migrations/006_takedowns.sql src/migrations/007_polar_provider_events.sql \
  src/migrations/008_polar_provider_intents.sql src/migrations/009_waffo_atomic_settlement.sql \
  app/api/webhooks/waffo/route.ts app/api/webhooks/polar/route.ts \
  tests/waffo-webhook.test.ts; do
  need_file "$f"
done
grep -q 'createCheckout' src/billing/port.ts || fail "payment port createCheckout missing"
grep -q 'settle' src/billing/port.ts || fail "payment port settle missing"
grep -q 'class FakePaymentPort' src/billing/fake.ts || fail "fixture port missing"
grep -q 'quoteRaise' src/listings.ts || fail "raise quote missing"
grep -q 'applyRaise' src/listings.ts || fail "raise apply missing"
grep -q 'chargeUsd' src/listings.ts || fail "difference-only charge missing"
grep -q 'created_at' src/listings.ts || fail "createdAt preservation missing"
grep -q 'requireClaimedLicense' src/takedown.ts src/billing/port.ts src/listings.ts || fail "license guard missing"
grep -q 'license_required' src/takedown.ts tests/takedown.test.ts || fail "license error missing"
grep -q 'hideListing' src/takedown.ts src/clicks.ts || fail "hide/click guard missing"
grep -q 'incrementPublicClick' src/clicks.ts 'app/go/[id]/route.ts' || fail "click count path missing"
grep -q 'canonicalizeSiteUrl' src/urls.ts src/clicks.ts || fail "URL hygiene missing"
grep -q 'bid_too_low' src/billing/port.ts tests/checkout.test.ts || fail "minimum-bid error missing"
grep -q 'bid_not_integer' src/billing/port.ts tests/checkout.test.ts || fail "whole-dollar error missing"
grep -q 'verifyWebhook' app/api/webhooks/waffo/route.ts || fail "Waffo webhook verification missing"
grep -q 'webhook-id' app/api/webhooks/waffo/route.ts || fail "Waffo delivery identity missing"
grep -q 'order.completed' src/billing/live.ts || fail "Waffo completion event missing"
grep -q 'priceSnapshot' src/billing/live.ts || fail "Waffo price snapshot missing"
grep -q 'BLOCKED-SECRET: WAFFO_PRIVATE_KEY' src/billing/waffo-session.ts || fail "Waffo fail-closed secret missing"
grep -q 'WAFFO_PUBLIC_BASE_URL' src/billing/waffo-session.ts || fail "Waffo base URL guard missing"
grep -q 'WAFFO_WEBHOOK' src/billing/waffo-session.ts || fail "Waffo webhook guard missing"
grep -q 'https://api.waffo.ai' src/billing/waffo-session.ts || fail "official Waffo host missing"
grep -q 'webhook_route_moved' app/api/webhooks/polar/route.ts || fail "obsolete provider route not inert"
if grep -nE 'fetch\(|waffo\.ai|polar\.sh|api\.polar' src/billing/fake.ts src/billing/port.ts >/dev/null 2>&1; then
  fail "fixture/port must stay offline"
fi
if grep -RInE '^[[:space:]]*export[[:space:]]' src/polar >/dev/null 2>&1; then
  fail "quarantined legacy provider files must not export runtime code"
fi
if grep -RInE 'fetch\(|https?://([^/]*\.)?polar\.sh' app src tests \
  | grep -v 'src/billing/live.ts:' \
  | grep -v 'tests/live-smoke.test.ts:' >/dev/null 2>&1; then
  fail "app/src/tests must not call legacy provider HTTP"
fi

echo "== weekly window and docs =="
grep -q 'Europe/London' src/week.ts tests/week.test.ts || fail "London week timezone missing"
grep -q 'rolling last 7 days' tests/week.test.ts || fail "rolling window test missing"
grep -q 'week_closed' src/week.ts tests/week.test.ts || fail "closed-week behavior missing"
grep -q 'Last Week Van' tests/week.test.ts || fail "last-week archive test missing"
for f in app/about/page.tsx app/rules/page.tsx; do
  need_file "$f"
done
grep -q 'Rank is the bid' app/about/page.tsx app/rules/page.tsx || fail "rank copy missing from docs"
grep -q 'difference' app/rules/page.tsx || fail "raise difference missing from rules"
grep -q 'English' app/about/page.tsx || fail "about must state English"
if grep -Eqi 'outbid\.lol|local-service-weekly|\\bclone\\b|\\bv1\\b|\\bfixture\\b|weekId|createdAt|paidAt|Waffo' \
  app/about/page.tsx app/rules/page.tsx; then
  fail "public about/rules copy must not expose internal or provider details"
fi
grep -q 'starts at' app/rules/page.tsx \
  && grep -q '\$5' app/rules/page.tsx \
  || fail "rules must state minimum bid"

echo "== live-smoke stays offline =="
need_file scripts/live-smoke.sh
[[ -x scripts/live-smoke.sh ]] || fail "live-smoke.sh must be executable"
grep -q 'BLOCKED-SECRET: WAFFO_PRIVATE_KEY' scripts/live-smoke.sh || fail "live-smoke secret gate missing"
grep -q 'live-smoke refuses CI=true' scripts/live-smoke.sh || fail "live-smoke CI gate missing"
grep -q 'live-smoke must not run in GitHub Actions' scripts/live-smoke.sh || fail "live-smoke Actions gate missing"
grep -q 'data-empty-lane' scripts/live-smoke.sh || fail "live-smoke empty-lane parser missing"
grep -q 'next start' scripts/live-smoke.sh || fail "live-smoke must exercise the compiled Node server"
if grep -q 'next dev' scripts/live-smoke.sh; then
  fail "live-smoke must not depend on a shared next-dev lock"
fi
grep -q 'WAFFO_WEBHOOK_TEST_PUBLIC_KEY' scripts/live-smoke.sh || fail "live-smoke test webhook key gate missing"
grep -q 'WAFFO_WEBHOOK_PROD_PUBLIC_KEY' scripts/live-smoke.sh || fail "live-smoke production webhook key gate missing"
grep -q 'journal_mode' scripts/live-smoke.sh || fail "live-smoke must inspect file-backed SQLite"
grep -q 'PASS-ERROR' docs/live-smoke.md || fail "live-smoke docs missing PASS-ERROR"
grep -q 'BLOCKED-SECRET' docs/live-smoke.md || fail "live-smoke docs missing BLOCKED-SECRET"
if grep -Eq '^[[:space:]]*(bash[[:space:]]+)?(\./)?scripts/live-smoke\.sh' scripts/test.sh; then
  fail "test.sh cannot call live-smoke.sh"
fi
if grep -q 'POLAR_FIXTURE_ONLY' src/billing/port.ts src/billing/waffo-session.ts; then
  fail "legacy fixture switch must not select payment"
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

  unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET POLAR_ORGANIZATION_ID POLAR_PRODUCT_ID POLAR_API_BASE
  unset POLAR_FIXTURE_ONLY WAFFO_LIVE WAFFO_MODE PAYMENT_PROVIDER_MODE
  unset WAFFO_PRIVATE_KEY WAFFO_PRIVATE_KEY_FILE WAFFO_MERCHANT_ID WAFFO_STORE_ID WAFFO_PRODUCT_ID
  unset WAFFO_API_BASE WAFFO_PUBLIC_BASE_URL WAFFO_WEBHOOK_PUBLIC_KEY
  unset WAFFO_WEBHOOK_TEST_PUBLIC_KEY WAFFO_WEBHOOK_PROD_PUBLIC_KEY DATABASE_PATH
  unset NODE_ENV VERCEL_ENV APP_ENV DEPLOY_ENV BUILD_ENV NEXT_PHASE
  export PAYMENT_MODE=fixture

  echo "== typecheck =="
  npx tsc --noEmit

  echo "== unit tests =="
  test_log="$(mktemp /tmp/lsw-tests.XXXXXX)"
  npx tsx --test --test-reporter spec 'tests/**/*.test.ts' | tee "$test_log"
  grep -Eq 'tests[[:space:]]+[1-9][0-9]*' "$test_log" || fail "unit runner reported zero tests"
  for contract in \
    'four empty lanes stay honest' \
    'occupied mixed paper keeps empty lanes honest' \
    'occupied paper keeps one first Call and one quiet claim route' \
    'unpaid and abandoned listings stay off the classified paper' \
    'empty paper sends identity fields directly to one Claim rank submit' \
    'claim and occupied forms post to their distinct payment intents' \
    'occupied raise controls share a top-plus-one floor' \
    'occupied home form is a clear new-listing path' \
    'occupied raise copy names difference-only' \
    'the ordinary renderer and runtime shell contain no shared reference fixture'; do
    grep -q "$contract" "$test_log" || fail "unit contract did not run: $contract"
  done

  echo "== optimized build =="
  port="$(printenv TEST_PORT 2>/dev/null || true)"
  if [[ -z "$port" ]]; then port=34568; fi
  log_file="$(mktemp /tmp/lsw-next.XXXXXX)"
  db_file="$(mktemp /tmp/lsw-db.XXXXXX.sqlite)"
  server_pid=""
  kill_process_tree() {
    local pid="$1"
    local child
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      kill_process_tree "$child"
    done
    kill "$pid" 2>/dev/null || true
  }
  stop_server() {
    if [[ -n "$server_pid" ]]; then
      kill_process_tree "$server_pid"
      wait "$server_pid" 2>/dev/null || true
      server_pid=""
    fi
  }
  cleanup_http() {
    stop_server
    rm -f "$log_file" "$db_file" "$db_file-wal" "$db_file-shm" "$test_log" 2>/dev/null || true
  }
  trap cleanup_http EXIT
  export DATABASE_PATH="$db_file"
  export NEXT_TELEMETRY_DISABLED=1
  export OPERATOR_SECRET="operator-test-secret"
  npx next build

  echo "== offline fixture smoke =="
  NODE_ENV=development PORT="$port" npx next start --port "$port" --hostname 127.0.0.1 >"$log_file" 2>&1 &
  server_pid=$!
  ready=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      fail "next start exited early: $(sed -n '1,80p' "$log_file")"
    fi
    if curl -sf "http://127.0.0.1:$port/healthz" >/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  [[ "$ready" == "1" ]] || fail "GET /healthz did not become ready: $(sed -n '1,80p' "$log_file")"
  [[ -f "$db_file" ]] || fail "healthz did not open the configured file-backed SQLite database"
  sqlite_report="$(node -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1], { readonly: true });
    const journal = String(db.pragma("journal_mode", { simple: true })).toLowerCase();
    const integrity = String(db.pragma("integrity_check", { simple: true })).toLowerCase();
    const migrations = Number(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count);
    db.close();
    if (journal !== "wal" || integrity !== "ok" || migrations < 9) process.exit(1);
    process.stdout.write(`journal=${journal} integrity=${integrity} migrations=${migrations}`);
  ' "$db_file")" || fail "durable SQLite probe failed"
  echo "durable SQLite: ${sqlite_report}"

  home_body="$(mktemp /tmp/lsw-home.XXXXXX)"
  home_code="$(curl -sS -o "$home_body" -w '%{http_code}' "http://127.0.0.1:$port/")"
  [[ "$home_code" == "200" ]] || fail "GET / expected 200 got $home_code"
  grep -q 'data-city="london"' "$home_body" || fail "home must default to London"
  grep -q 'data-classified=""' "$home_body" || fail "home must be a classified paper"
  grep -q 'class="paper classified paper-empty"' "$home_body" || fail "home must begin empty"
  [[ "$(grep -o 'data-empty-lane="true"' "$home_body" | wc -l | tr -d ' ')" == "4" ]] || fail "home must expose exactly four honest lanes"
  grep -q 'data-hero-form=""' "$home_body" || fail "empty home must lead with hero claim form"
  grep -q 'data-checkout-intent="place"' "$home_body" || fail "empty home must post a place checkout"
  grep -q 'name="business"' "$home_body" || fail "empty home must expose Business"
  grep -q 'name="siteUrl"' "$home_body" || fail "empty home must expose Site URL"
  grep -q '>Claim rank<' "$home_body" || fail "empty home must expose Claim rank"
  grep -q 'href="/c/london/movers#claim"' "$home_body" || fail "home must link the local movers claim route"
  if grep -q 'Call this #1' "$home_body"; then
    fail "empty home must not invent Call this #1"
  fi

  unknown_city="$(mktemp /tmp/lsw-city.XXXXXX)"
  unknown_city_code="$(curl -sS -o "$unknown_city" -w '%{http_code}' "http://127.0.0.1:$port/c/not-a-city")"
  [[ "$unknown_city_code" == "404" ]] || fail "unknown city expected 404 got $unknown_city_code"
  grep -q 'city_unknown' "$unknown_city" || fail "unknown city must be explicit"
  unknown_cat="$(mktemp /tmp/lsw-cat.XXXXXX)"
  unknown_cat_code="$(curl -sS -o "$unknown_cat" -w '%{http_code}' "http://127.0.0.1:$port/c/london/plumbers")"
  [[ "$unknown_cat_code" == "404" ]] || fail "unknown category expected 404 got $unknown_cat_code"
  grep -q 'category_unknown' "$unknown_cat" || fail "unknown category must be explicit"

  paid_body="$(mktemp /tmp/lsw-paid.XXXXXX)"
  paid_code="$(curl -sS -o "$paid_body" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"North London Movers","category":"movers","city":"london","siteUrl":"https://north.example","amount":20}' \
    "http://127.0.0.1:$port/api/checkout")"
  [[ "$paid_code" == "200" ]] || fail "fixture checkout \$20 expected 200 got $paid_code: $(sed -n '1,20p' "$paid_body")"
  grep -q '"status":"paid"' "$paid_body" || fail "fixture checkout must return paid"
  checkout_id="$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).id)' "$paid_body")"
  listing_id="$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).listingId || "")' "$paid_body")"
  [[ -n "$checkout_id" && -n "$listing_id" ]] || fail "fixture checkout must return ids"

  occupied_home="$(mktemp /tmp/lsw-occupied.XXXXXX)"
  occupied_home_code="$(curl -sS -o "$occupied_home" -w '%{http_code}' "http://127.0.0.1:$port/")"
  [[ "$occupied_home_code" == "200" ]] || fail "occupied home expected 200 got $occupied_home_code"
  grep -q 'class="paper classified paper-occupied"' "$occupied_home" || fail "occupied home must use occupied paper"
  grep -q 'data-classified-columns=""' "$occupied_home" || fail "occupied home must use four columns"
  grep -q 'North London Movers' "$occupied_home" || fail "occupied home must show paid business"
  grep -q 'data-new-listing=""' "$occupied_home" || fail "occupied home must expose a new-listing path"
  grep -q 'data-checkout-intent="place"' "$occupied_home" || fail "occupied home new listing must post a place checkout"
  if grep -q 'action="/api/raise"' "$occupied_home"; then
    fail "occupied home must not submit the new-listing form to raise"
  fi
  if grep -qE 'OutbidReferenceActivity|REFERENCE_RAIL|presentation-card|today-strip|activity-strip' "$occupied_home"; then
    fail "occupied home must not render target fixture UI"
  fi

  paid_board="$(mktemp /tmp/lsw-board.XXXXXX)"
  paid_board_code="$(curl -sS -o "$paid_board" -w '%{http_code}' "http://127.0.0.1:$port/c/london/movers")"
  [[ "$paid_board_code" == "200" ]] || fail "paid lane expected 200 got $paid_board_code"
  grep -q 'data-rank="1"' "$paid_board" || fail "paid fixture must rank #1"
  grep -q 'data-bid-usd="20"' "$paid_board" || fail "paid fixture must expose bid \$20"
  grep -q 'class="outbid call-this-one"' "$paid_board" || fail "paid #1 must have first Call"
  grep -q 'data-first-click="call"' "$paid_board" || fail "paid #1 must expose first click"
  grep -q 'class="claim-route"' "$paid_board" || fail "paid lane must expose quiet claim route"
  grep -q 'href="/c/london/movers#claim"' "$paid_board" || fail "paid claim route must be local"
  grep -q 'data-raise-difference=""' "$paid_board" || fail "paid lane must expose difference-only fact"

  echo "== durable SQLite restart smoke =="
  stop_server
  NODE_ENV=development PORT="$port" npx next start --port "$port" --hostname 127.0.0.1 >"$log_file" 2>&1 &
  server_pid=$!
  restarted_ready=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      fail "next start restart exited early: $(sed -n '1,80p' "$log_file")"
    fi
    if curl -sf "http://127.0.0.1:$port/healthz" >/dev/null; then
      restarted_ready=1
      break
    fi
    sleep 1
  done
  [[ "$restarted_ready" == "1" ]] || fail "GET /healthz did not recover after process restart: $(sed -n '1,80p' "$log_file")"
  restarted_board="$(mktemp /tmp/lsw-restarted-board.XXXXXX)"
  restarted_code="$(curl -sS -o "$restarted_board" -w '%{http_code}' "http://127.0.0.1:$port/c/london/movers")"
  [[ "$restarted_code" == "200" ]] || fail "restarted paid lane expected 200 got $restarted_code"
  grep -q 'North London Movers' "$restarted_board" || fail "paid listing disappeared after process restart"
  grep -q 'data-rank="1"' "$restarted_board" || fail "paid rank disappeared after process restart"
  echo "durable SQLite restart: paid listing and rank survived"

  second_body="$(mktemp /tmp/lsw-second.XXXXXX)"
  second_code="$(curl -sS -o "$second_body" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"South London Movers","category":"movers","city":"london","siteUrl":"https://south.example","amount":15}' \
    "http://127.0.0.1:$port/api/checkout")"
  [[ "$second_code" == "200" ]] || fail "second fixture checkout expected 200 got $second_code"
  movers_two="$(mktemp /tmp/lsw-two.XXXXXX)"
  curl -sS -o "$movers_two" "http://127.0.0.1:$port/c/london/movers"
  grep -q 'data-rank="2"' "$movers_two" || fail "second fixture must rank #2"
  grep -q 'Call #2' "$movers_two" || fail "later listing must say Call #2"
  grep -q 'data-later-call=""' "$movers_two" || fail "later listing must be marked later"
  grep -q 'data-later-claim=""' "$movers_two" || fail "occupied lane must keep quiet claim"

  raise_body="$(mktemp /tmp/lsw-raise.XXXXXX)"
  raise_code="$(curl -sS -o "$raise_body" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"North London Movers","category":"movers","city":"london","siteUrl":"https://north.example","amount":25}' \
    "http://127.0.0.1:$port/api/raise")"
  [[ "$raise_code" == "200" ]] || fail "fixture raise \$25 expected 200 got $raise_code: $(sed -n '1,20p' "$raise_body")"
  grep -q '"chargedUsd":5' "$raise_body" || fail "raise must charge only \$5"
  grep -q '"bidUsd":25' "$raise_body" || fail "raise must move bid to \$25"
  raise_checkout_id="$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).id)' "$raise_body")"
  raise_return="$(mktemp /tmp/lsw-raise-return.XXXXXX)"
  raise_return_code="$(curl -sS -o "$raise_return" -w '%{http_code}' "http://127.0.0.1:$port/return?checkout=$raise_checkout_id")"
  [[ "$raise_return_code" == "200" ]] || fail "raise return expected 200 got $raise_return_code"
  grep -q 'data-return="paid"' "$raise_return" || fail "raise return must say paid"
  grep -q 'data-raise-charge-usd="">5<' "$raise_return" || fail "raise return must show \$5 difference"
  if grep -q 'Call this #1' "$raise_return"; then
    fail "return page must not retouch Call this #1"
  fi

  low_body="$(mktemp /tmp/lsw-low.XXXXXX)"
  low_code="$(curl -sS -o "$low_body" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Too Cheap","category":"movers","city":"london","siteUrl":"https://cheap.example","amount":4}' \
    "http://127.0.0.1:$port/api/checkout")"
  [[ "$low_code" == "400" ]] || fail "minimum bid expected 400 got $low_code"
  grep -q 'bid_too_low' "$low_body" || fail "minimum bid error must be explicit"
  frac_body="$(mktemp /tmp/lsw-fractional.XXXXXX)"
  frac_code="$(curl -sS -o "$frac_body" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Fractional","category":"movers","city":"london","siteUrl":"https://frac.example","amount":"12.5"}' \
    "http://127.0.0.1:$port/api/checkout")"
  [[ "$frac_code" == "400" ]] || fail "fractional bid expected 400 got $frac_code"
  grep -q 'bid_not_integer' "$frac_body" || fail "fractional error must be explicit"

  tracked_body="$(mktemp /tmp/lsw-tracked.XXXXXX)"
  tracked_code="$(curl -sS -o "$tracked_body" -w '%{http_code}' \
    -H 'accept: application/json' -H 'content-type: application/json' \
    -d '{"business":"Tracked Van","category":"movers","city":"london","siteUrl":"https://tracked.example/van?utm_source=fixture","amount":10}' \
    "http://127.0.0.1:$port/api/checkout")"
  [[ "$tracked_code" == "200" ]] || fail "tracked fixture checkout expected 200 got $tracked_code"
  tracked_id="$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).listingId || "")' "$tracked_body")"
  [[ -n "$tracked_id" ]] || fail "tracked fixture must return listingId"
  click_headers="$(mktemp /tmp/lsw-click-headers.XXXXXX)"
  click_body="$(mktemp /tmp/lsw-click-body.XXXXXX)"
  click_code="$(curl -sS -D "$click_headers" -o "$click_body" -w '%{http_code}' "http://127.0.0.1:$port/go/$tracked_id?utm_source=injected")"
  [[ "$click_code" == "302" ]] || fail "GET /go/:id expected 302 got $click_code"
  click_location="$(awk 'BEGIN{IGNORECASE=1} /^location:/{sub("\r",""); print $2; exit}' "$click_headers")"
  [[ "$click_location" == "https://tracked.example/van" ]] || fail "click must clean URL, got $click_location"
  if echo "$click_location" | grep -Eqi 'utm_|gclid|fbclid|\?'; then
    fail "click destination contains tracking"
  fi
  clicked_board="$(mktemp /tmp/lsw-clicked.XXXXXX)"
  curl -sS -o "$clicked_board" "http://127.0.0.1:$port/c/london/movers"
  grep -q '1 click' "$clicked_board" || fail "public click count must increment"

  empty_return="$(mktemp /tmp/lsw-return.XXXXXX)"
  empty_return_code="$(curl -sS -o "$empty_return" -w '%{http_code}' "http://127.0.0.1:$port/return")"
  [[ "$empty_return_code" == "200" ]] || fail "unknown return expected 200 got $empty_return_code"
  grep -q 'data-return="unknown"' "$empty_return" || fail "unknown return must be explicit"
  grep -q 'No rank claimed' "$empty_return" || fail "unknown return must not claim a rank"

  rm -f "$home_body" "$unknown_city" "$unknown_cat" "$paid_body" "$occupied_home" \
    "$paid_board" "$second_body" "$movers_two" "$raise_body" "$raise_return" \
    "$low_body" "$frac_body" "$tracked_body" "$click_headers" "$click_body" \
    "$clicked_board" "$empty_return" "$restarted_board"
fi

  echo "== production dependency audit =="
  npm audit --omit=dev --audit-level=high

echo "OK: buildable and testable"
