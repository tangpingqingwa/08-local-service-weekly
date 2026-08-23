#!/usr/bin/env bash
# Operator smoke against a local process. Not called from scripts/test.sh or CI.
# Walks SPEC §14: healthz, London board, about/rules, checkout, raise, click,
# takedown. Missing Polar secret → BLOCKED-SECRET: POLAR_ACCESS_TOKEN
# Fixture listing is allowed so raise / click / takedown can run when live
# pay is blocked. Empty London lane is honest. Do not invent a provider.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  fail "live-smoke must not run in GitHub Actions"
fi
if [[ "${CI:-}" == "true" ]]; then
  fail "live-smoke refuses CI=true"
fi

command -v curl >/dev/null || fail "curl is required"
command -v node >/dev/null || fail "node is required"

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi

PASS=0
PASS_ERROR=0
BLOCKED=0
FAIL=0
STARTED_PID=""
LIVE_PID=""
WORKDIR=""
RESULT_LOG=""
BASE="${LIVE_SMOKE_BASE:-}"

# Capture operator Polar flags before the fixture process unsets them.
OP_POLAR_LIVE="${POLAR_LIVE:-}"
OP_POLAR_ACCESS_TOKEN="${POLAR_ACCESS_TOKEN:-}"
OP_POLAR_WEBHOOK_SECRET="${POLAR_WEBHOOK_SECRET:-}"
OP_POLAR_PRODUCT_ID="${POLAR_PRODUCT_ID:-}"
OP_POLAR_ORGANIZATION_ID="${POLAR_ORGANIZATION_ID:-${POLAR_ORG_ID:-}}"
OP_POLAR_FIXTURE_ONLY="${POLAR_FIXTURE_ONLY:-}"
OP_POLAR_API_BASE="${POLAR_API_BASE:-}"

kill_tree() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  if [[ -n "${LIVE_PID}" ]]; then
    kill_tree "${LIVE_PID}"
    wait "${LIVE_PID}" 2>/dev/null || true
  fi
  if [[ -n "${STARTED_PID}" ]]; then
    kill_tree "${STARTED_PID}"
    wait "${STARTED_PID}" 2>/dev/null || true
  fi
  if [[ -n "${WORKDIR}" && -d "${WORKDIR}" ]]; then
    rm -rf "${WORKDIR}"
  fi
}
trap cleanup EXIT

record() {
  local flow="$1"
  local status="$2"
  local note="${3:-}"
  printf 'RESULT\t%s\t%s\t%s\n' "$flow" "$status" "$note"
  if [[ -n "${RESULT_LOG}" ]]; then
    printf '%s\t%s\t%s\n' "$flow" "$status" "$note" >>"${RESULT_LOG}"
  fi
  case "$status" in
    PASS) PASS=$((PASS + 1)) ;;
    PASS-ERROR) PASS_ERROR=$((PASS_ERROR + 1)) ;;
    BLOCKED-SECRET) BLOCKED=$((BLOCKED + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    *) fail "unknown smoke status ${status}" ;;
  esac
}

pick_port() {
  node --input-type=module -e '
    import net from "node:net";
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") process.exit(1);
      process.stdout.write(String(addr.port));
      server.close();
    });
  '
}

london_week_id() {
  node --import tsx --input-type=module -e '
    import { currentWeekId } from "./src/week.ts";
    process.stdout.write(currentWeekId());
  '
}

wait_health() {
  local url="$1/healthz"
  local i
  for i in $(seq 1 80); do
    if curl -fsS --connect-timeout 2 --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

ensure_next_build() {
  if [[ -f "${root}/.next/BUILD_ID" ]]; then
    return 0
  fi
  rebuild_next
}

rebuild_next() {
  echo "building Next.js app for live-smoke"
  (
    cd "$root"
    unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET POLAR_ORGANIZATION_ID POLAR_PRODUCT_ID POLAR_API_BASE || true
    export POLAR_FIXTURE_ONLY=1
    export NEXT_TELEMETRY_DISABLED=1
    npx --no-install next build
  )
}

start_smoke_server() {
  local port="$1"
  local db_path="$2"
  local log_path="$3"
  shift 3
  ensure_next_build
  (
    cd "$root"
    unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET POLAR_ORGANIZATION_ID POLAR_PRODUCT_ID POLAR_FIXTURE_ONLY POLAR_API_BASE || true
    export POLAR_FIXTURE_ONLY=1
    export PORT="${port}"
    export DATABASE_PATH="${db_path}"
    export PUBLIC_BASE_URL="http://127.0.0.1:${port}"
    export OPERATOR_SECRET="${OPERATOR_SECRET:-live-smoke-operator}"
    export NEXT_TELEMETRY_DISABLED=1
    # bash 3.2: do not `local` this name; export must reach next start.
    while [[ $# -gt 0 ]]; do
      assignment="$1"
      shift
      if [[ "${assignment}" == *= ]]; then
        unset "${assignment%=}" || true
      else
        export "${assignment}"
      fi
    done
    unset assignment
    exec npx --no-install next start --port "${port}" --hostname 127.0.0.1
  ) >"${log_path}" 2>&1 &
  echo $!
}

http_get() {
  local base="$1"
  local path="$2"
  local out="$3"
  curl -sS -o "$out" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    "${base}${path}"
}

http_get_headers() {
  local base="$1"
  local path="$2"
  local body="$3"
  local hdrs="$4"
  curl -sS -D "$hdrs" -o "$body" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    --max-redirs 0 \
    "${base}${path}"
}

http_post_json() {
  local base="$1"
  local path="$2"
  local payload="$3"
  local body="$4"
  local hdrs="$5"
  curl -sS -D "$hdrs" -o "$body" -w "%{http_code}" --connect-timeout 5 --max-time 30 \
    --max-redirs 0 \
    -X POST \
    -H "content-type: application/json" \
    -H "accept: application/json" \
    --data "$payload" \
    "${base}${path}"
}

header_value() {
  local file="$1"
  local name="$2"
  awk -v name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" '
    BEGIN { FS = ": " }
    tolower($1) == name {
      val = $0
      sub(/^[^:]+:[ \t]*/, "", val)
      gsub(/\r/, "", val)
      print val
      exit
    }
  ' "$file"
}

json_field() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const raw = readFileSync(process.argv[1], "utf8");
    let data;
    try { data = JSON.parse(raw); } catch { process.exit(2); }
    const key = process.argv[2];
    const value = data == null ? undefined : data[key];
    if (value === undefined || value === null) process.exit(3);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      process.stdout.write(String(value));
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(value));
  ' "$1" "$2"
}

html_has() {
  local file="$1"
  local pattern="$2"
  grep -Eq "$pattern" "$file"
}

invented_stars() {
  local file="$1"
  grep -Eiq '★|⭐|4\.8 stars|star rating|star-rating|data-stars=|review count|top rated' "$file"
}

listing_count() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    process.stdout.write(String([...html.matchAll(/data-listing-id="([^"]+)"/g)].length));
  ' "$1"
}

id_for_business() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const name = process.argv[2];
    const cards = [...html.matchAll(/<article class="card"[\s\S]*?<\/article>/g)].map((m) => m[0]);
    for (const card of cards) {
      if (card.includes(name)) {
        const id = card.match(/data-listing-id="([^"]+)"/);
        if (id) {
          process.stdout.write(id[1]);
          process.exit(0);
        }
      }
    }
    process.exit(2);
  ' "$1" "$2"
}

rank_for_business() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const name = process.argv[2];
    const cards = [...html.matchAll(/<article class="card"[\s\S]*?<\/article>/g)].map((m) => m[0]);
    for (const card of cards) {
      if (card.includes(name)) {
        const rank = card.match(/data-rank="(\d+)"/);
        if (rank) {
          process.stdout.write(rank[1]);
          process.exit(0);
        }
      }
    }
    process.exit(2);
  ' "$1" "$2"
}

clicks_for_id() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const id = process.argv[2];
    const cards = [...html.matchAll(/<article class="card"[\s\S]*?<\/article>/g)].map((m) => m[0]);
    for (const card of cards) {
      if (card.includes(`data-listing-id="${id}"`)) {
        const clicks = card.match(/(\d+) clicks?/);
        if (clicks) {
          process.stdout.write(clicks[1]);
          process.exit(0);
        }
      }
    }
    process.exit(2);
  ' "$1" "$2"
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/lsw-live-smoke.XXXXXX")"
RESULT_LOG="${WORKDIR}/results.tsv"
: >"${RESULT_LOG}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
EXPECT_WEEK="$(london_week_id)"
BUSINESS="Smoke Movers ${STAMP}"
STRIPPED_URL="https://smoke.example/van-${STAMP}"
TRACKED_URL="${STRIPPED_URL}?utm_source=smoke&gclid=1"
echo "== live-smoke (operator only; not CI) =="
echo "root=${root}"
echo "weekId=${EXPECT_WEEK}"

if [[ -z "${BASE}" ]]; then
  PORT="${LIVE_SMOKE_PORT:-$(pick_port)}"
  BASE="http://127.0.0.1:${PORT}"
  DB_PATH="${WORKDIR}/board.sqlite"
  LOG_PATH="${WORKDIR}/server.log"
  echo "starting local fixture process on ${BASE}"
  echo "database=${DB_PATH}"
  STARTED_PID="$(start_smoke_server "$PORT" "$DB_PATH" "$LOG_PATH" "POLAR_FIXTURE_ONLY=1")"
  if ! wait_health "$BASE"; then
    echo "server log:" >&2
    cat "${LOG_PATH}" >&2 || true
    fail "local server did not become healthy at ${BASE}/healthz"
  fi
else
  BASE="${BASE%/}"
  echo "assuming existing server at ${BASE}"
  if ! wait_health "$BASE"; then
    fail "existing server at ${BASE} did not answer /healthz"
  fi
fi

echo "base=${BASE}"
echo "operator POLAR_LIVE=${OP_POLAR_LIVE:-<unset>}"
if [[ -n "${OP_POLAR_ACCESS_TOKEN}" ]]; then
  echo "operator POLAR_ACCESS_TOKEN=<set len=${#OP_POLAR_ACCESS_TOKEN}>"
else
  echo "operator POLAR_ACCESS_TOKEN=<unset>"
fi
if [[ -n "${OP_POLAR_API_BASE}" ]]; then
  echo "operator POLAR_API_BASE=${OP_POLAR_API_BASE}"
else
  echo "operator POLAR_API_BASE=<unset; live process default is production>"
fi

# --- Health ---
health_body="${WORKDIR}/healthz.json"
health_code="$(http_get "$BASE" "/healthz" "$health_body" || true)"
if [[ "$health_code" == "200" ]] && grep -q '"ok":true' "$health_body"; then
  record "health" "PASS" "GET /healthz 200"
else
  record "health" "FAIL" "GET /healthz HTTP ${health_code}"
fi

# --- London board: honest empty lane ---
board0="${WORKDIR}/board0.html"
board0_code="$(http_get "$BASE" "/" "$board0" || true)"
board0_count="$(listing_count "$board0" || echo 0)"
lane0="${WORKDIR}/lane0.html"
lane0_code="$(http_get "$BASE" "/c/london/movers" "$lane0" || true)"
if [[ "$board0_code" != "200" || "$lane0_code" != "200" ]]; then
  record "london-board" "FAIL" "GET / HTTP ${board0_code} /c/london/movers HTTP ${lane0_code}"
elif invented_stars "$board0" || invented_stars "$lane0"; then
  record "london-board" "FAIL" "board invented stars or review counts"
elif [[ "$board0_count" == "0" ]] \
  && html_has "$board0" 'data-city="london"' \
  && html_has "$board0" "data-week=\"${EXPECT_WEEK}\"" \
  && html_has "$board0" 'data-empty-lane="true"' \
  && html_has "$lane0" 'data-empty-lane="true"' \
  && html_has "$board0" 'Outbid' \
  && ! html_has "$board0" 'North London Movers' \
  && ! html_has "$lane0" 'placeholder provider'; then
  record "london-board" "PASS" "GET / and /c/london/movers 200; empty London lane; no invented provider"
elif [[ "$board0_count" != "0" ]] \
  && html_has "$board0" 'data-city="london"' \
  && html_has "$board0" "data-week=\"${EXPECT_WEEK}\""; then
  record "london-board" "PASS" "GET / 200 London week ${EXPECT_WEEK}; ${board0_count} already-paid card(s); no invented empty-state provider"
else
  record "london-board" "FAIL" "London board contract broken"
fi

# --- About / rules ---
about_body="${WORKDIR}/about.html"
about_code="$(http_get "$BASE" "/about" "$about_body" || true)"
rules_body="${WORKDIR}/rules.html"
rules_code="$(http_get "$BASE" "/rules" "$rules_body" || true)"
if [[ "$about_code" == "200" && "$rules_code" == "200" ]] \
  && html_has "$about_body" 'Rank is the bid' \
  && html_has "$about_body" 'outbid.lol' \
  && html_has "$about_body" 'London' \
  && html_has "$rules_body" 'min \$5' \
  && html_has "$rules_body" 'Rank is the bid' \
  && html_has "$rules_body" 'older' \
  && html_has "$rules_body" 'difference' \
  && ! invented_stars "$about_body" \
  && ! invented_stars "$rules_body"; then
  record "about-rules" "PASS" "GET /about and /rules 200"
else
  record "about-rules" "FAIL" "about HTTP ${about_code} rules HTTP ${rules_code}"
fi

# --- Documented product errors (honest, nothing invented) ---
low_body="${WORKDIR}/bid-low.json"
low_hdrs="${WORKDIR}/bid-low.hdrs"
low_code="$(http_post_json "$BASE" "/api/checkout" \
  "{\"business\":\"Too Cheap\",\"category\":\"movers\",\"city\":\"london\",\"siteUrl\":\"https://cheap.example/van-${STAMP}\",\"amount\":4}" \
  "$low_body" "$low_hdrs" || true)"
low_err="$(json_field "$low_body" "error" || true)"
if [[ "$low_code" == "400" && "$low_err" == "bid_too_low" ]]; then
  record "bid-too-low" "PASS-ERROR" "POST /api/checkout \$4 → 400 bid_too_low"
else
  record "bid-too-low" "FAIL" "\$4 checkout HTTP ${low_code} error=${low_err}"
fi

chat_body="${WORKDIR}/chat.json"
chat_hdrs="${WORKDIR}/chat.hdrs"
chat_code="$(http_post_json "$BASE" "/api/checkout" \
  "{\"business\":\"Chat Van\",\"category\":\"movers\",\"city\":\"london\",\"siteUrl\":\"https://t.me/joinchat/smoke\",\"amount\":12}" \
  "$chat_body" "$chat_hdrs" || true)"
chat_err="$(json_field "$chat_body" "error" || true)"
if [[ "$chat_code" == "400" && "$chat_err" == "chat_link" ]]; then
  record "chat-link" "PASS-ERROR" "telegram URL → 400 chat_link"
else
  record "chat-link" "FAIL" "telegram checkout HTTP ${chat_code} error=${chat_err}"
fi

dentist_body="${WORKDIR}/dentist.json"
dentist_hdrs="${WORKDIR}/dentist.hdrs"
dentist_code="$(http_post_json "$BASE" "/api/checkout" \
  "{\"business\":\"Soho Smile\",\"category\":\"dentists\",\"city\":\"london\",\"siteUrl\":\"https://soho.example/smoke-${STAMP}\",\"amount\":20}" \
  "$dentist_body" "$dentist_hdrs" || true)"
dentist_err="$(json_field "$dentist_body" "error" || true)"
if [[ "$dentist_code" == "400" && "$dentist_err" == "license_required" ]]; then
  record "license-required" "PASS-ERROR" "dentist without license → 400 license_required"
else
  record "license-required" "FAIL" "dentist checkout HTTP ${dentist_code} error=${dentist_err}"
fi

# --- Live Polar: POLAR_LIVE=1 + secrets, else BLOCKED-SECRET ---
echo "== polar live checkout =="
if [[ "${OP_POLAR_LIVE}" == "1" ]]; then
  if [[ -z "${OP_POLAR_ACCESS_TOKEN}" ]]; then
    echo "BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
    record "live-checkout" "BLOCKED-SECRET" "POLAR_ACCESS_TOKEN"
  else
    live_port="$(pick_port)"
    live_db="${WORKDIR}/live.sqlite"
    live_log="${WORKDIR}/polar-live.log"
    live_base="http://127.0.0.1:${live_port}"
    live_env=(
      "POLAR_LIVE=1"
      "POLAR_ACCESS_TOKEN=${OP_POLAR_ACCESS_TOKEN}"
      "POLAR_WEBHOOK_SECRET=${OP_POLAR_WEBHOOK_SECRET:-}"
      "POLAR_PRODUCT_ID=${OP_POLAR_PRODUCT_ID:-}"
      "POLAR_ORGANIZATION_ID=${OP_POLAR_ORGANIZATION_ID:-}"
      "POLAR_FIXTURE_ONLY="
    )
    if [[ -n "${OP_POLAR_API_BASE}" ]]; then
      live_env+=("POLAR_API_BASE=${OP_POLAR_API_BASE}")
    fi
    LIVE_PID="$(start_smoke_server "$live_port" "$live_db" "$live_log" "${live_env[@]}")"
    if ! wait_health "$live_base"; then
      if grep -q 'BLOCKED-SECRET: POLAR_ACCESS_TOKEN' "${live_log}"; then
        echo "BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
        record "live-checkout" "BLOCKED-SECRET" "POLAR_ACCESS_TOKEN"
      else
        record "live-checkout" "FAIL" "live Polar process did not become healthy"
      fi
    else
      live_body="${WORKDIR}/live-checkout.json"
      live_hdrs="${WORKDIR}/live-checkout.hdrs"
      live_code="$(http_post_json "$live_base" "/api/checkout" \
        "{\"business\":\"Live Polar Van\",\"category\":\"movers\",\"city\":\"london\",\"siteUrl\":\"https://live.example/van-${STAMP}\",\"amount\":5}" \
        "$live_body" "$live_hdrs" || true)"
      live_url="$(json_field "$live_body" "url" || true)"
      live_err="$(json_field "$live_body" "error" || true)"
      live_status="$(json_field "$live_body" "status" || true)"
      live_listing="$(json_field "$live_body" "listingId" || true)"
      live_board="${WORKDIR}/live-board.html"
      http_get "$live_base" "/c/london/movers" "$live_board" >/dev/null || true
      live_url_host=""
      if [[ "${live_url}" == https://* ]]; then
        live_url_host="${live_url#https://}"
        live_url_host="${live_url_host%%/*}"
      fi
      if html_has "$live_board" "Live Polar Van"; then
        record "live-checkout" "FAIL" "unpaid live Polar session appeared on the board"
      elif [[ -n "${live_listing}" && "${live_listing}" != "null" ]]; then
        record "live-checkout" "FAIL" "live checkout invented a paid listingId without webhook"
      elif [[ "$live_status" == "paid" ]]; then
        record "live-checkout" "FAIL" "live checkout returned fixture paid status"
      elif [[ "$live_url" == /return* ]]; then
        record "live-checkout" "FAIL" "live checkout returned fixture /return listing, not Polar"
      elif [[ "$live_code" == "200" && "$live_url" == https://sandbox.polar.sh/checkout/* ]]; then
        record "live-checkout" "PASS" "sandbox.polar.sh Checkout URL; unpaid session not listed"
      elif [[ "$live_code" == "200" && "$live_url_host" == *polar.sh ]]; then
        record "live-checkout" "FAIL" "live checkout host ${live_url_host} is not sandbox.polar.sh"
      elif [[ "$live_code" == "503" && "$live_err" == "polar_not_live" ]]; then
        record "live-checkout" "PASS-ERROR" "POLAR_LIVE=1 HTTP 503 polar_not_live; no invented paid rank"
      else
        record "live-checkout" "FAIL" "POLAR_LIVE=1 HTTP ${live_code} error=${live_err} host=${live_url_host:-none}; no invented paid rank"
      fi
    fi
    if [[ -n "${LIVE_PID}" ]]; then
      kill_tree "${LIVE_PID}"
      wait "${LIVE_PID}" 2>/dev/null || true
    fi
    LIVE_PID=""
  fi
else
  if [[ "${OP_POLAR_FIXTURE_ONLY}" == "1" ]]; then
    record "live-checkout" "PASS-ERROR" "POLAR_FIXTURE_ONLY=1 wins; live Polar not invoked"
  elif [[ -z "${OP_POLAR_ACCESS_TOKEN}" ]]; then
    echo "BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
    record "live-checkout" "BLOCKED-SECRET" "POLAR_ACCESS_TOKEN"
  else
    record "live-checkout" "PASS-ERROR" "POLAR_LIVE unset; token present but live Polar not invoked"
  fi
fi

# --- Fixture or live checkout: paid listing appears at the bid's rank ---
fix_body="${WORKDIR}/fixture-checkout.json"
fix_hdrs="${WORKDIR}/fixture-checkout.hdrs"
fix_code="$(http_post_json "$BASE" "/api/checkout" \
  "{\"business\":\"${BUSINESS}\",\"category\":\"movers\",\"city\":\"london\",\"siteUrl\":\"${TRACKED_URL}\",\"amount\":20}" \
  "$fix_body" "$fix_hdrs" || true)"
fix_status="$(json_field "$fix_body" "status" || true)"
fix_id="$(json_field "$fix_body" "listingId" || true)"
movers_paid="${WORKDIR}/movers-paid.html"
movers_paid_code="$(http_get "$BASE" "/c/london/movers" "$movers_paid" || true)"
paid_rank="$(rank_for_business "$movers_paid" "$BUSINESS" || true)"
if [[ "$fix_code" == "200" && "$fix_status" == "paid" && -n "$fix_id" ]] \
  && [[ "$movers_paid_code" == "200" ]] \
  && [[ "$paid_rank" == "1" ]] \
  && html_has "$movers_paid" "$BUSINESS" \
  && html_has "$movers_paid" '\$20' \
  && ! html_has "$movers_paid" 'utm_source' \
  && ! html_has "$movers_paid" 'data-empty-lane="true"' \
  && ! invented_stars "$movers_paid"; then
  record "checkout" "PASS" "fixture paid \$20 lists at rank 1; tracking query stripped"
else
  record "checkout" "FAIL" "fixture checkout HTTP ${fix_code} status=${fix_status} rank=${paid_rank}"
fi

# --- Raise: charged difference only ---
raise_body="${WORKDIR}/raise.json"
raise_hdrs="${WORKDIR}/raise.hdrs"
raise_code="$(http_post_json "$BASE" "/api/raise" \
  "{\"business\":\"${BUSINESS}\",\"category\":\"movers\",\"city\":\"london\",\"siteUrl\":\"${STRIPPED_URL}\",\"amount\":25}" \
  "$raise_body" "$raise_hdrs" || true)"
raise_charged="$(json_field "$raise_body" "chargedUsd" || true)"
raise_bid="$(json_field "$raise_body" "bidUsd" || true)"
movers_raised="${WORKDIR}/movers-raised.html"
http_get "$BASE" "/c/london/movers" "$movers_raised" >/dev/null || true
raised_rank="$(rank_for_business "$movers_raised" "$BUSINESS" || true)"
if [[ "$raise_code" == "200" && "$raise_charged" == "5" && "$raise_bid" == "25" ]] \
  && [[ "$raised_rank" == "1" ]] \
  && html_has "$movers_raised" '\$25'; then
  record "raise" "PASS" "raise \$20→\$25 charged \$5; stays #1"
else
  record "raise" "FAIL" "raise HTTP ${raise_code} charged=${raise_charged} bid=${raise_bid} rank=${raised_rank}"
fi

# --- Click: public count increments; destination has no tracking query ---
if [[ -z "$fix_id" ]]; then
  record "click" "FAIL" "no listing id for /go/:id"
else
  before_clicks="$(clicks_for_id "$movers_raised" "$fix_id" || echo "")"
  click_body="${WORKDIR}/click.body"
  click_hdrs="${WORKDIR}/click.hdrs"
  click_code="$(http_get_headers "$BASE" "/go/${fix_id}?utm_source=injected" "$click_body" "$click_hdrs" || true)"
  click_loc="$(header_value "$click_hdrs" "location" || true)"
  movers_clicked="${WORKDIR}/movers-clicked.html"
  http_get "$BASE" "/c/london/movers" "$movers_clicked" >/dev/null || true
  after_clicks="$(clicks_for_id "$movers_clicked" "$fix_id" || echo "")"
  if [[ "$click_code" == "302" \
    && "$click_loc" == "${STRIPPED_URL}" \
    && "$before_clicks" =~ ^[0-9]+$ \
    && "$after_clicks" =~ ^[0-9]+$ \
    && "$after_clicks" -eq $((before_clicks + 1)) ]]; then
    record "click" "PASS" "GET /go/${fix_id} 302 → cleaned URL; clicks ${before_clicks}→${after_clicks}"
  else
    record "click" "FAIL" "GET /go/${fix_id} HTTP ${click_code} loc=${click_loc} clicks ${before_clicks}→${after_clicks}"
  fi
fi

# --- Takedown: hidden listing absent from board ---
if [[ -z "$fix_id" ]]; then
  record "takedown" "FAIL" "no listing id for operator hide"
else
  hide_body="${WORKDIR}/takedown.json"
  hide_hdrs="${WORKDIR}/takedown.hdrs"
  hide_code="$(
    curl -sS -D "$hide_hdrs" -o "$hide_body" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
      --max-redirs 0 \
      -X POST \
      -H "content-type: application/json" \
      -H "accept: application/json" \
      -H "x-operator-secret: ${OPERATOR_SECRET:-live-smoke-operator}" \
      --data "{\"listingId\":\"${fix_id}\",\"reason\":\"complaint\",\"complaint\":\"Hide ${BUSINESS} london movers after smoke\"}" \
      "${BASE}/api/takedown" || true
  )"
  movers_hidden="${WORKDIR}/movers-hidden.html"
  http_get "$BASE" "/c/london/movers" "$movers_hidden" >/dev/null || true
  if [[ "$hide_code" == "200" ]] \
    && grep -q '"hidden":true' "$hide_body" \
    && ! html_has "$movers_hidden" "$BUSINESS" \
    && ! html_has "$movers_hidden" 'placeholder provider' \
    && ! html_has "$movers_hidden" 'placeholder clinic'; then
    record "takedown" "PASS" "hidden listing absent from London movers; no invented replacement"
  else
    record "takedown" "FAIL" "takedown HTTP ${hide_code} still listed=$(html_has "$movers_hidden" "$BUSINESS" && echo yes || echo no)"
  fi
fi

echo
echo "== summary =="
echo "PASS=${PASS} PASS-ERROR=${PASS_ERROR} BLOCKED-SECRET=${BLOCKED} FAIL=${FAIL}"
echo "base=${BASE}"
echo "weekId=${EXPECT_WEEK}"
if [[ -f "${RESULT_LOG}" ]]; then
  echo "----"
  while IFS=$'\t' read -r flow status note; do
    printf '%-18s %-16s %s\n' "$flow" "$status" "$note"
  done <"${RESULT_LOG}"
fi

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
