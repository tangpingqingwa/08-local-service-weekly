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
grep -q '### PR 40:' BUILD.md || fail "BUILD.md missing ### PR 40:"
grep -q '### PR 41:' BUILD.md || fail "BUILD.md missing ### PR 41:"
grep -q '### PR 42:' BUILD.md || fail "BUILD.md missing ### PR 42:"
grep -q '### PR 43:' BUILD.md || fail "BUILD.md missing ### PR 43:"
grep -q '### PR 44:' BUILD.md || fail "BUILD.md missing ### PR 44:"
grep -q '### PR 45:' BUILD.md || fail "BUILD.md missing ### PR 45:"
grep -q '### PR 46:' BUILD.md || fail "BUILD.md missing ### PR 46:"
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
  src/ui/edition.tsx src/ui/claim-column.tsx src/ui/column-index.tsx tests/board.test.ts; do
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
grep -q 'data-empty-honest' src/ui/lane-board.tsx \
  || fail "empty lanes must stamp data-empty-honest after Claim #1 is the first click"
grep -q 'No #1' src/ui/lane-board.tsx \
  || fail "empty lanes must say No #1, not invent a provider"
grep -q 'No stars. No map.' src/ui/lane-board.tsx \
  || fail "empty lanes must refuse stars and maps"
grep -q 'empty-lane\[data-empty-honest\]' app/globals.css \
  || fail "classified CSS must keep occupied Call hops off empty lanes"
grep -q 'four empty lanes stay honest' tests/board.test.ts \
  || fail "board tests must cover four empty lanes staying honest"
grep -q 'lane-occupied' src/ui/lane-board.tsx \
  || fail "paid columns must wrap in lane-occupied so later Call stays off empty lanes"
grep -q 'lane-empty' src/ui/lane-board.tsx \
  || fail "empty columns must wrap in lane-empty so later Call cannot leak onto No #1"
grep -q 'data-lane-occupied' src/ui/lane-board.tsx \
  || fail "paid columns must stamp data-lane-occupied"
grep -q 'data-lane-empty' src/ui/lane-board.tsx \
  || fail "empty columns must stamp data-lane-empty"
grep -q 'lane-occupied\[data-lane-occupied\]' app/globals.css \
  || fail "classified CSS must keep later Call scoped to occupied lanes"
grep -q 'lane-empty\[data-lane-empty\]' app/globals.css \
  || fail "classified CSS must hide later Call on empty mixed-paper columns"
grep -q 'paper-occupied\[data-paper-occupied\] .lane-occupied\[data-lane-occupied\] .later-call\[data-later-call\]' app/globals.css \
  || fail "later-call CSS must stay scoped to occupied lanes on occupied paper"
grep -q 'paper-occupied\[data-paper-occupied\] .lane-empty\[data-lane-empty\] \[data-later-call\]' app/globals.css \
  || fail "classified CSS must hide later-call on empty mixed-paper columns"
if grep -qE '^\.paper-occupied\[data-paper-occupied\] \.later-call\[data-later-call\]' app/globals.css; then
  fail "later-call CSS must not paint paper-wide onto empty No #1 columns"
fi
grep -q 'occupied mixed paper keeps empty lanes honest' tests/board.test.ts \
  || fail "board tests must cover occupied mixed paper keeping empty lanes honest"
grep -q 'data-clicks' src/ui/listing-card.tsx || fail "cards must show public clicks"
grep -q 'data-bid' src/ui/listing-card.tsx || fail "cards must show \$bid"
grep -q 'data-classified' src/ui/city-hub.tsx \
  || grep -q 'ClassifiedEdition' src/ui/city-hub.tsx \
  || fail "city hub must render the classified edition"
grep -q 'data-classified' src/ui/edition.tsx || fail "edition must mark the classified paper"
grep -q 'edition-city' src/ui/edition.tsx || fail "city must be the edition masthead"
grep -q 'classified-columns' src/ui/city-hub.tsx \
  || fail "categories must render as classified columns"
grep -q 'Claim #1 for' src/ui/outbid-form.tsx || fail "bid form must clone Claim #1"
grep -q 'data-claim-pick' src/ui/claim-column.tsx \
  || fail "hub claim must pick a column before the want-ad fields"
grep -q 'data-claim-job' src/ui/claim-column.tsx \
  || fail "hub Outbid hops must name the column as a job the tradesperson owns"
grep -q 'Outbid my' src/ui/claim-column.tsx \
  || fail "hub hops must say Outbid my {job} column, not a generic Outbid {category}"
grep -q 'claim-first-click' src/ui/claim-column.tsx \
  || fail "empty paper must lead with one Claim #1 first click"
grep -q 'Then pick the column' src/ui/claim-column.tsx \
  || fail "empty paper must treat the trade pick as the next step after Claim #1"
grep -q 'claim-next' src/ui/claim-column.tsx \
  || fail "empty paper column pick must stay quieter than Claim #1"
grep -q 'emptyPaper' src/ui/city-hub.tsx \
  || fail "city hub must tell the empty paper to lead with one first click"
if grep -q 'showColumnIndex' src/ui/city-hub.tsx src/ui/edition.tsx; then
  fail "occupied column tabs must not hang in the edition masthead"
fi
if grep -q 'data-category-tabs' src/ui/edition.tsx; then
  fail "edition masthead must not print the four-tab column index"
fi
grep -q 'paper-empty' src/ui/edition.tsx \
  || fail "empty paper must wrap in paper-empty so occupied later-facts / Call this #1 cannot leak"
grep -q 'paper-occupied' src/ui/edition.tsx \
  || fail "occupied paper must wrap in paper-occupied so Call this #1 CSS stays scoped"
grep -q 'data-paper-empty' src/ui/edition.tsx \
  || fail "empty paper must stamp data-paper-empty"
grep -q 'data-paper-occupied' src/ui/edition.tsx \
  || fail "occupied paper must stamp data-paper-occupied"
grep -q 'emptyPaper={emptyPaper}' src/ui/city-hub.tsx \
  || fail "city hub must tell the edition when the paper is empty"
grep -q 'emptyPaper={!occupied}' app/c/\[city\]/\[category\]/page.tsx \
  || fail "empty lane page must wrap as empty paper"
grep -q 'paper-empty\[data-paper-empty\] \[data-later-fact\]' app/globals.css \
  || fail "classified CSS must hide later-fact \$bid on empty paper"
grep -q 'paper-empty\[data-paper-empty\] \[data-call-this-one\]' app/globals.css \
  || fail "classified CSS must hide Call this #1 on empty paper"
grep -q 'paper-occupied\[data-paper-occupied\] .card\[data-call-ad="lead"\] .later-facts\[data-later-fact\]' app/globals.css \
  || fail "occupied later-facts CSS must stay scoped to paper-occupied"
grep -q 'paper-occupied\[data-paper-occupied\] .call-this-one.call-after-claim-five' app/globals.css \
  || fail "occupied Call this #1 CSS must stay scoped to paper-occupied"
if grep -qE '^\.card\[data-call-ad="lead"\] \.later-facts|^\.call-this-one\.call-after-claim-five' app/globals.css; then
  fail "occupied later-facts / Call this #1 CSS must not apply outside paper-occupied"
fi
grep -q 'empty paper stays Claim #1 — later-facts / Call this #1 cannot leak' tests/board.test.ts \
  || fail "board tests must cover empty paper isolation from occupied later-facts / Call this #1"
grep -q 'data-category-tabs' src/ui/column-index.tsx \
  || fail "occupied column tabs must stay as one classified column index"
grep -q 'data-column-index-after' src/ui/column-index.tsx \
  || fail "occupied column tabs must stamp after the listing"
grep -q 'column-index-after' src/ui/column-index.tsx \
  || fail "occupied column tabs must use the after-listing column-index class"
grep -q 'ColumnIndex' src/ui/city-hub.tsx \
  || fail "occupied hub must keep column tabs after the listing"
grep -q '{emptyPaper ? null : <ColumnIndex city={city} />}' src/ui/city-hub.tsx \
  || fail "empty paper must not print occupied column tabs"
grep -q '{occupied ? <ColumnIndex city={city.value} /> : null}' app/c/\[city\]/\[category\]/page.tsx \
  || fail "empty lane page must not print occupied column tabs"
if grep -q 'data-later-fact' src/ui/column-index.tsx src/ui/city-hub.tsx src/ui/edition.tsx; then
  fail "column tabs must not stamp later-fact on \$bid"
fi
if grep -qE 'data-call-after-claim-six|data-claim-after-call-six|tabs-after-listing-N' src/ui/column-index.tsx src/ui/city-hub.tsx src/ui/edition.tsx; then
  fail "column tabs must not stamp *-after-*-N"
fi
grep -q 'column-index-after\[data-column-index-after\]' app/globals.css \
  || fail "classified CSS must keep occupied column tabs after the listing"
python3 - app/globals.css <<'PY' || fail "occupied column tabs must stay quieter than Call this #1"
import re
import sys

css = open(sys.argv[1], encoding="utf-8").read()

def first(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit("missing " + pattern)
    return match.group(1)

lead = first(r"\.paper-occupied\[data-paper-occupied\] \.call-this-one\.call-after-claim-five\s*,\s*\.paper-occupied\[data-paper-occupied\] \.call-this-one\[data-call-after-claim-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
tabs = first(r"\.paper-occupied\[data-paper-occupied\] \.column-index\.column-index-after\[data-column-index-after\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
if float(tabs) >= float(lead):
    raise SystemExit("column tabs shout like Call this #1")
block = re.search(r"\.paper-occupied\[data-paper-occupied\] \.column-index\.column-index-after\[data-column-index-after\]\s*\{[^}]*\}", css, re.S)
if not block or "var(--accent)" in block.group(0):
    raise SystemExit("do not recolor occupied column tabs")
PY
grep -q 'occupied paper keeps column tabs after the listing' tests/board.test.ts \
  || fail "board tests must cover occupied column tabs after the listing"
grep -q 'claim-first-click' app/globals.css \
  || fail "classified CSS must make Claim #1 the empty-paper first click"
grep -q 'claim-columns.claim-next a' app/globals.css \
  || fail "classified CSS must keep the empty-paper trade pick quieter than Outbid"
grep -q 'empty paper has one first click' tests/board.test.ts \
  || fail "board tests must cover one first click on empty paper"
grep -q 'Then the listing name' src/ui/outbid-form.tsx \
  || fail "empty-lane form must treat the listing name as the next write after Claim #1"
grep -q 'data-later-write' src/ui/outbid-form.tsx \
  || fail "empty-lane form must stamp the listing name as a later write"
grep -q 'data-listing-identity' src/ui/outbid-form.tsx \
  || fail "empty-lane form must group listing identity after Outbid"
grep -q 'data-empty-claim-first' src/ui/outbid-form.tsx \
  || fail "empty-lane form must stamp empty Claim #1 as the first click"
grep -q 'data-first-click": "claim"' src/ui/outbid-form.tsx \
  || fail "empty-lane Claim #1 must stamp the first click"
grep -q 'emptyPaper={paid.length === 0}' src/ui/lane-board.tsx \
  || fail "empty lane page must tell the form the paper is empty after Polar-paid occupancy"
grep -q 'listing-identity\[data-later-write\]' app/globals.css \
  || fail "classified CSS must keep the empty-paper listing name quieter than Outbid"
grep -q 'Empty paper: listing name is a later write' app/globals.css \
  || fail "classified CSS must document the empty-paper listing-name later write"
grep -q 'empty paper has one first click: Claim #1, then the listing name' tests/board.test.ts \
  || fail "board tests must cover Claim #1 then the listing name on empty paper"
if grep -q 'data-later-write' src/ui/claim-column.tsx src/ui/listing-card.tsx src/ui/column-index.tsx; then
  fail "later-write listing name must stay on the empty-lane form, not occupied chrome"
fi
if grep -qE 'data-claim-after-empty|data-empty-after-claim|listing-after-claim-N' src/ui/outbid-form.tsx src/ui/lane-board.tsx; then
  fail "empty-lane later write must not stamp *-after-*-N"
fi
python3 - app/globals.css <<'PY' || fail "empty-paper listing name must stay quieter than Claim #1"
import re
import sys

css = open(sys.argv[1], encoding="utf-8").read()
claim = re.search(
    r"\.claim-pick\.claim-first summary\.claim-first-click\s*\{[^}]*font-size:\s*clamp\(([\d.]+)rem",
    css,
    re.S,
)
later = re.search(
    r"\.paper-empty\[data-paper-empty\] \.claim\.empty-claim-first\[data-empty-claim-first\] \.later-write-label\s*\{[^}]*font-size:\s*([\d.]+)rem",
    css,
    re.S,
)
if not claim or not later:
    raise SystemExit("missing empty-paper later-write type")
if float(later.group(1)) >= float(claim.group(1)):
    raise SystemExit("listing name later-write shouts like Claim #1")
block = re.search(
    r"\.paper-empty\[data-paper-empty\] \.claim\.empty-claim-first\[data-empty-claim-first\] \.listing-identity\[data-later-write\]\s*\{[^}]*\}",
    css,
    re.S,
)
if not block or "var(--accent)" in block.group(0):
    raise SystemExit("do not recolor the empty-paper listing-name later write")
PY
grep -q 'ClaimColumn' src/ui/city-hub.tsx \
  || fail "city hub must send first-time locals into one column"
grep -q 'amount-field' src/ui/outbid-form.tsx || fail "bid form must keep the dashed amount"
grep -q 'Decrease bid by one dollar' src/ui/outbid-form.tsx \
  || fail "bid form must expose a minus stepper"
grep -q 'Increase bid by one dollar' src/ui/outbid-form.tsx \
  || fail "bid form must expose a plus stepper"
grep -q 'data-classified-ad' src/ui/listing-card.tsx \
  || fail "listing card must read as a classified ad"
grep -q 'data-prize' src/ui/listing-card.tsx \
  || fail "occupied #1 must stamp the business name as the prize"
grep -q 'data-prize' app/globals.css \
  || fail "classified CSS must make the #1 business name larger than \$bid"
grep -q 'occupied #1 names the business as the prize before \$bid' tests/board.test.ts \
  || fail "board tests must cover prize-before-price on occupied #1"
grep -q 'later-facts' src/ui/listing-card.tsx \
  || fail "occupied #1 must group \$bid as a later-facts block"
grep -q 'data-later-fact' src/ui/listing-card.tsx \
  || fail "occupied #1 later-facts group must stamp data-later-fact"
if grep -qE 'className=\{lead \? "bid later-fact" : "bid"\}|className="bid later-fact"|bid later-fact' src/ui/listing-card.tsx; then
  fail "occupied #1 must not stamp class=bid later-fact on the same \$bid span (PR #37 REJECT)"
fi
if grep -n 'data-empty-lane' -A 20 src/ui/lane-board.tsx | grep -qE 'data-later-fact|later-facts|bid later-fact'; then
  fail "empty lanes must not stamp later-fact \$bid"
fi
if grep -n 'Call #${listing.rank}' -B 20 src/ui/listing-card.tsx | grep -qE 'data-later-fact|later-facts|bid later-fact'; then
  fail "later ranks must not stamp later-fact \$bid"
fi
if grep -qE 'data-later-fact-first|data-later-fact-six|later-fact-after-|later-facts-after-' src/ui/listing-card.tsx src/ui/lane-board.tsx; then
  fail "later-fact \$bid must not add another numbered hop stamp"
fi
python3 - src/ui/listing-card.tsx <<'PY' || fail "occupied #1 \$bid must change grouping, not a muted twin span"
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()
if 'className="bid later-fact"' in src or "bid later-fact" in src:
    raise SystemExit("stamp-only later-fact class on $bid")
facts = re.search(
    r"<p className=\"later-facts\"[^>]*>[\s\S]*?</p>",
    src,
)
if not facts:
    raise SystemExit("later-facts group missing")
group = facts.group(0)
if 'data-later-fact=""' not in group:
    raise SystemExit("later-facts group must carry data-later-fact")
if 'data-bid=""' not in group or 'data-clicks=""' not in group:
    raise SystemExit("$bid and clicks must share the later-facts group")
if "data-host" in group:
    raise SystemExit("host is identity, not later-fact money")
before = src.split("later-facts", 1)[0]
if "data-prize" not in before:
    raise SystemExit("occupied #1 prize name must stay before the later-fact group")
if "Call this #1" not in before:
    raise SystemExit("Call this #1 must stay before the later-fact group")
if re.search(r"<p className=\"meta\">[\s\S]*data-bid=\"\"[\s\S]*data-clicks=\"\"", before):
    raise SystemExit("$bid is still a sibling meta line beside the prize")
PY
grep -q 'occupied #1 \$bid stays a later fact in grouping, not a muted stamp on the same \$bid span' tests/board.test.ts \
  || fail "board tests must cover later-fact grouping on occupied #1"
grep -q 'Claimed license' src/ui/listing-card.tsx \
  || fail "cards must show claimed license when present"
grep -q 'href={`/go/${listing.id}`}' src/ui/listing-card.tsx \
  || fail "ad host must click through /go/:id"
grep -q 'Call this #1' src/ui/listing-card.tsx \
  || fail "paid #1 must offer Call this #1"
grep -q 'data-call-this-one' src/ui/listing-card.tsx \
  || fail "paid #1 call hop must stamp data-call-this-one"
grep -q 'data-first-click": "call"' src/ui/listing-card.tsx \
  || grep -q 'data-first-click="call"' src/ui/listing-card.tsx \
  || fail "paid #1 Call this #1 must stamp the occupied first click"
grep -q 'outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five' src/ui/listing-card.tsx \
  || fail "paid #1 call hop must reuse Outbid button chrome"
grep -q 'data-call-after-claim-one' src/ui/listing-card.tsx \
  || fail "paid #1 call hop must concentrate after Outbid my column"
grep -q 'data-call-after-claim-two' src/ui/listing-card.tsx \
  || fail "paid #1 call hop must concentrate after Outbid my column is re-concentrated"
grep -q 'data-call-after-claim-three' src/ui/listing-card.tsx \
  || fail "paid #1 call hop must concentrate after Outbid my column is re-concentrated again"
grep -q 'data-call-after-claim-four' src/ui/listing-card.tsx \
  || fail "paid #1 call hop must concentrate after Outbid my column is re-concentrated again after claim-four"
grep -q 'data-call-after-claim-five' src/ui/listing-card.tsx \
  || fail "paid #1 call hop must concentrate after Outbid my column is re-concentrated again"
grep -q 'data-call-ad' src/ui/listing-card.tsx \
  || fail "paid #1 ad must stamp data-call-ad"
grep -q 'call-this-one' app/globals.css \
  || fail "classified CSS must style the concentrated Call this #1 hop"
grep -q 'call-after-claim-one' app/globals.css \
  || fail "classified CSS must concentrate Call this #1 after Outbid my column"
grep -q 'call-after-claim-two' app/globals.css \
  || fail "classified CSS must concentrate Call this #1 after Outbid my column is re-concentrated"
grep -q 'call-after-claim-three' app/globals.css \
  || fail "classified CSS must concentrate Call this #1 after Outbid my column is re-concentrated again"
grep -q 'call-after-claim-four' app/globals.css \
  || fail "classified CSS must concentrate Call this #1 after Outbid my column is re-concentrated again after claim-four"
grep -q 'call-after-claim-five' app/globals.css \
  || fail "classified CSS must concentrate Call this #1 after Outbid my column is re-concentrated again"
grep -q 'Call this #1' tests/board.test.ts \
  || fail "board tests must cover Call this #1"
grep -q 'outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five' tests/board.test.ts \
  || fail "board tests must keep Call this #1 on Outbid chrome"
grep -q 'concentrates Call this #1' tests/board.test.ts \
  || fail "board tests must cover concentrating Call this #1 without another #1 hop"
grep -q 'concentrates Call this #1 after Outbid my column' tests/board.test.ts \
  || fail "board tests must cover concentrating Call this #1 after Outbid my column"
grep -q 'concentrates Call this #1 after Outbid my column is re-concentrated' tests/board.test.ts \
  || fail "board tests must cover concentrating Call this #1 after Outbid my column is re-concentrated"
grep -q 'concentrates Call this #1 after Outbid my column is re-concentrated again' tests/board.test.ts \
  || fail "board tests must cover concentrating Call this #1 after Outbid my column is re-concentrated again"
grep -q 'concentrates Call this #1 after Outbid my column is re-concentrated again after claim-four' tests/board.test.ts \
  || fail "board tests must cover concentrating Call this #1 after Outbid my column is re-concentrated again after claim-four"
grep -q 'concentrates Call this #1 after Outbid my column is re-concentrated again after claim-five' tests/board.test.ts \
  || fail "board tests must cover concentrating Call this #1 after Outbid my column is re-concentrated again after claim-five"
grep -q 'Call #' src/ui/listing-card.tsx \
  || fail "later ranks must offer Call #N"
grep -q 'data-call-later' src/ui/listing-card.tsx \
  || fail "later-rank call hop must stamp data-call-later"
grep -q 'later-call' src/ui/listing-card.tsx \
  || fail "later-rank Call #N must sit in a later-call group"
grep -q 'data-later-call' src/ui/listing-card.tsx \
  || fail "later-rank later-call group must stamp data-later-call"
grep -q 'data-call-ad": "later"' src/ui/listing-card.tsx \
  || fail "later-rank ad must stamp data-call-ad=later"
if grep -q 'data-call-later-quiet' src/ui/listing-card.tsx src/ui/lane-board.tsx src/ui/claim-column.tsx; then
  fail "later Call must not stamp data-call-later-quiet on the same hop (PR 42 REJECT)"
fi
if grep -n 'data-call-this-one' -A 20 src/ui/listing-card.tsx | grep -qE 'data-later-call|later-call'; then
  fail "occupied Call this #1 must not sit in a later-call group"
fi
if grep -q 'data-later-call' src/ui/claim-column.tsx; then
  fail "empty-paper Claim #1 must not stamp later-call grouping"
fi
if grep -q 'call-after-claim-six\|claim-after-call-six' src/ui/listing-card.tsx src/ui/lane-board.tsx; then
  fail "later-rank quiet must not stamp *-after-*-N"
fi
grep -q 'data-later-call' src/ui/lane-board.tsx \
  || fail "later Call after the claim hop must stay in a later-call group"
if awk '/data-claim-after-call=/{flag=1} flag{print} /after Call this #1/{exit}' src/ui/lane-board.tsx | grep -qE 'data-later-call|data-call-later-quiet'; then
  fail "Outbid my column must not stamp later-call grouping"
fi
grep -q 'Call #2' tests/board.test.ts \
  || fail "board tests must cover later-rank Call #N"
grep -q 'occupied later Call #N stays quieter than Call this #1' tests/board.test.ts \
  || fail "board tests must keep later Call #N quieter than Call this #1"
grep -q 'occupied later Call stays quieter in grouping, not a mute of the same hop' tests/board.test.ts \
  || fail "board tests must cover later-call grouping, not a mute stamp"
grep -q 'data-claim-after-call' src/ui/lane-board.tsx \
  || fail "occupied later ranks must offer a claim-after-call hop"
grep -q 'later-claim claim-after-call-line' src/ui/lane-board.tsx \
  || fail "occupied claim hop must sit in a later-claim group after the listing"
grep -q 'data-later-claim' src/ui/lane-board.tsx \
  || fail "occupied claim hop must stamp later-claim grouping"
grep -q 'after Call this #1' src/ui/lane-board.tsx \
  || fail "claim-after-call hop must sit after Call this #1"
grep -q 'data-claim-after-call-one' src/ui/lane-board.tsx \
  || fail "occupied claim hop must concentrate after Call this #1"
grep -q 'data-claim-after-call-two' src/ui/lane-board.tsx \
  || fail "occupied claim hop must concentrate after Call this #1 is re-concentrated"
grep -q 'data-claim-after-call-three' src/ui/lane-board.tsx \
  || fail "occupied claim hop must concentrate after Call this #1 is re-concentrated again"
grep -q 'data-claim-after-call-four' src/ui/lane-board.tsx \
  || fail "occupied claim hop must concentrate after the louder Call this #1"
grep -q 'data-claim-after-call-five' src/ui/lane-board.tsx \
  || fail "occupied claim hop must concentrate after the louder Call this #1 is re-concentrated again"
grep -q 'Outbid my' src/ui/lane-board.tsx \
  || fail "occupied lane hop must name Outbid my {job} column"
grep -q 'claim-after-call' app/globals.css \
  || fail "classified CSS must style the claim-after-call hop"
grep -q 'claim-after-call-one' app/globals.css \
  || fail "classified CSS must concentrate the claim hop after Call this #1"
grep -q 'claim-after-call-two' app/globals.css \
  || fail "classified CSS must concentrate the claim hop after Call this #1 is re-concentrated"
grep -q 'claim-after-call-three' app/globals.css \
  || fail "classified CSS must concentrate the claim hop after Call this #1 is re-concentrated again"
grep -q 'claim-after-call-four' app/globals.css \
  || fail "classified CSS must concentrate the claim hop after the louder Call this #1"
grep -q 'claim-after-call-five' app/globals.css \
  || fail "classified CSS must concentrate the claim hop after the louder Call this #1 is re-concentrated again"
grep -q 'data-claim-after-call' tests/board.test.ts \
  || fail "board tests must cover claiming after Call #N"
grep -q 'after Call this #1' tests/board.test.ts \
  || fail "board tests must keep the claim hop after Call this #1"
grep -q 'concentrates Outbid my column after Call this #1' tests/board.test.ts \
  || fail "board tests must cover concentrating Outbid my column after Call this #1"
grep -q 'concentrates Outbid my column after Call this #1 is re-concentrated' tests/board.test.ts \
  || fail "board tests must cover concentrating Outbid my column after Call this #1 is re-concentrated"
grep -q 'concentrates Outbid my column after Call this #1 is re-concentrated again' tests/board.test.ts \
  || fail "board tests must cover concentrating Outbid my column after Call this #1 is re-concentrated again"
grep -q 'concentrates Outbid my column after the louder Call this #1' tests/board.test.ts \
  || fail "board tests must cover concentrating Outbid my column after the louder Call this #1"
grep -q 'concentrates Outbid my column after the louder Call this #1 is re-concentrated again' tests/board.test.ts \
  || fail "board tests must cover concentrating Outbid my column after the louder Call this #1 is re-concentrated again"
if grep -q 'claim-after-call-two' src/ui/listing-card.tsx; then
  fail "listing cards must not stamp claim-after-call-two"
fi
if grep -q 'claim-after-call-three' src/ui/listing-card.tsx; then
  fail "listing cards must not stamp claim-after-call-three"
fi
if grep -q 'claim-after-call-four' src/ui/listing-card.tsx; then
  fail "listing cards must not stamp claim-after-call-four"
fi
if grep -q 'claim-after-call-five' src/ui/listing-card.tsx; then
  fail "listing cards must not stamp claim-after-call-five"
fi
if grep -q 'claim-after-call-two' src/ui/claim-column.tsx; then
  fail "hub pick hops must not stamp claim-after-call-two"
fi
if grep -q 'claim-after-call-three' src/ui/claim-column.tsx; then
  fail "hub pick hops must not stamp claim-after-call-three"
fi
if grep -q 'claim-after-call-four' src/ui/claim-column.tsx; then
  fail "hub pick hops must not stamp claim-after-call-four"
fi
if grep -q 'claim-after-call-five' src/ui/claim-column.tsx; then
  fail "hub pick hops must not stamp claim-after-call-five"
fi
grep -q 'later-claim' src/ui/claim-column.tsx \
  || fail "occupied hub Claim must sit in a later-claim group after the listing"
grep -q 'data-later-claim' src/ui/claim-column.tsx \
  || fail "occupied hub Claim must stamp later-claim grouping"
grep -q 'Then Claim #1' src/ui/claim-column.tsx \
  || fail "occupied hub Claim must name itself a later write after Call this #1"
if grep -n 'emptyPaper ? undefined : "outbid"' src/ui/claim-column.tsx >/dev/null; then
  fail "occupied hub Claim must not reuse Outbid chrome of Call this #1"
fi
if grep -n 'data-call-after-claim' src/ui/lane-board.tsx | grep -q 'claim-after-call-two'; then
  fail "later-rank Call hop must not stamp claim-after-call-two"
fi
if grep -n 'data-call-after-claim' src/ui/lane-board.tsx | grep -q 'claim-after-call-three'; then
  fail "later-rank Call hop must not stamp claim-after-call-three"
fi
if grep -n 'data-call-after-claim' src/ui/lane-board.tsx | grep -q 'claim-after-call-four'; then
  fail "later-rank Call hop must not stamp claim-after-call-four"
fi
if grep -n 'data-call-after-claim' src/ui/lane-board.tsx | grep -q 'claim-after-call-five'; then
  fail "later-rank Call hop must not stamp claim-after-call-five"
fi
if grep -q 'call-after-claim-two' src/ui/lane-board.tsx; then
  fail "later-rank Call hop must not stamp call-after-claim-two"
fi
if grep -q 'call-after-claim-three' src/ui/lane-board.tsx; then
  fail "later-rank Call hop must not stamp call-after-claim-three"
fi
if grep -q 'call-after-claim-four' src/ui/lane-board.tsx; then
  fail "later-rank Call hop must not stamp call-after-claim-four"
fi
if grep -q 'call-after-claim-five' src/ui/lane-board.tsx; then
  fail "later-rank Call hop must not stamp call-after-claim-five"
fi
if grep -q 'call-after-claim-two' src/ui/claim-column.tsx; then
  fail "hub pick hops must not stamp call-after-claim-two"
fi
if grep -q 'call-after-claim-three' src/ui/claim-column.tsx; then
  fail "hub pick hops must not stamp call-after-claim-three"
fi
if grep -q 'call-after-claim-four' src/ui/claim-column.tsx; then
  fail "hub pick hops must not stamp call-after-claim-four"
fi
if grep -q 'call-after-claim-five' src/ui/claim-column.tsx; then
  fail "hub pick hops must not stamp call-after-claim-five"
fi
grep -q 'data-call-after-claim' src/ui/lane-board.tsx \
  || fail "occupied later ranks must offer a call-after-claim hop"
grep -q 'after the claim hop' src/ui/lane-board.tsx \
  || fail "call-after-claim hop must sit after the claim hop"
grep -q 'href={`/go/${lastCall.id}`}' src/ui/lane-board.tsx \
  || fail "call-after-claim hop must go through /go/:id"
if grep -q 'outbid call-after-claim' src/ui/lane-board.tsx; then
  fail "later Call after the claim hop must not reuse Outbid chrome of Call this #1"
fi
grep -q 'later-call call-after-claim-line' src/ui/lane-board.tsx \
  || fail "call-after-claim hop must sit in a later-call group"
grep -q 'call-after-claim' app/globals.css \
  || fail "classified CSS must style the call-after-claim hop"
grep -q 'later-call\[data-later-call\]' app/globals.css \
  || fail "classified CSS must keep later-rank Call #N in a later-call group"
if grep -qE 'call-later\[data-call-later-quiet\]|call-after-claim\[data-call-later-quiet\]' app/globals.css; then
  fail "classified CSS must not mute later Call via data-call-later-quiet (PR 42 REJECT)"
fi
python3 - app/globals.css <<'PY' || fail "later Call #N must stay quieter than occupied Call this #1"
import re
import sys

css = open(sys.argv[1], encoding="utf-8").read()

def first(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit("missing " + pattern)
    return match.group(1)

lead = first(r"\.paper-occupied\[data-paper-occupied\] \.call-this-one\.call-after-claim-five\s*,\s*\.paper-occupied\[data-paper-occupied\] \.call-this-one\[data-call-after-claim-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
later_group = first(r"\.paper-occupied\[data-paper-occupied\] \.lane-occupied\[data-lane-occupied\] \.later-call\[data-later-call\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
if float(later_group) >= float(lead):
    raise SystemExit("later Call #N shouts like Call this #1")
later_block = re.search(r"\.paper-occupied\[data-paper-occupied\] \.lane-occupied\[data-lane-occupied\] \.later-call\[data-later-call\]\s*\{[^}]*\}", css, re.S)
if not later_block or "var(--accent)" in later_block.group(0):
    raise SystemExit("do not recolor later Call #N")
if "color: var(--muted)" not in later_block.group(0):
    raise SystemExit("later-call group must recede")
if "data-call-later-quiet" in css:
    raise SystemExit("stamp-only data-call-later-quiet mute")
if re.search(r"\.paper-occupied\[data-paper-occupied\] \.later-call\[data-later-call\]\s*\{", css) and not re.search(r"\.paper-occupied\[data-paper-occupied\] \.lane-occupied\[data-lane-occupied\] \.later-call\[data-later-call\]\s*\{", css):
    raise SystemExit("later-call CSS must not apply paper-wide")
inner = re.search(
    r"\.paper-occupied\[data-paper-occupied\] \.lane-occupied\[data-lane-occupied\] \.later-call\[data-later-call\] \.call-later\s*\{[^}]*\}",
    css,
    re.S,
)
if inner and "font-size:" in inner.group(0) and "inherit" not in inner.group(0):
    raise SystemExit("later Call hop must inherit group type, not a second mute stamp")
PY
python3 - src/ui/listing-card.tsx <<'PY' || fail "later Call must change grouping, not a muted twin hop"
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()
if "data-call-later-quiet" in src:
    raise SystemExit("stamp-only later-quiet on Call hop")
group = re.search(r"<p className=\"later-call\"[^>]*>[\s\S]*?</p>", src)
if not group:
    raise SystemExit("later-call group missing")
block = group.group(0)
if 'data-later-call=""' not in block:
    raise SystemExit("later-call group must carry data-later-call")
if 'data-call-later=""' not in block:
    raise SystemExit("Call #N must sit inside the later-call group")
if "Call this #1" in block:
    raise SystemExit("Call this #1 must not sit in the later-call group")
if "data-bid" in block:
    raise SystemExit("$bid is money, not the later-call hop")
before = src.split("later-call", 1)[0]
if "listing.business" not in before:
    raise SystemExit("later-rank business name must stay before the later-call group")
if "Call this #1" not in before:
    raise SystemExit("Call this #1 must stay on occupied #1, before later Call grouping")
card_top = re.search(r"<div className=\"card-top\">([\s\S]*?)</div>", src)
if card_top and "data-call-later" in card_top.group(1):
    raise SystemExit("later Call is still a sibling card-top hop beside the name")
PY
grep -q 'later-facts\[data-later-fact\]' app/globals.css \
  || fail "classified CSS must keep occupied #1 \$bid in a later-facts group"
grep -q 'empty-lane\[data-empty-honest\] \[data-later-fact\]' app/globals.css \
  || fail "classified CSS must keep later-fact \$bid off empty lanes"
grep -q 'empty-lane\[data-empty-honest\] \.later-facts' app/globals.css \
  || fail "classified CSS must keep later-facts class off empty lanes"
if grep -qE '\.bid\.later-fact|class="bid later-fact"' app/globals.css; then
  fail "classified CSS must not mute \$bid via class=bid later-fact (PR #37 REJECT)"
fi
python3 - app/globals.css <<'PY' || fail "occupied #1 later-facts \$bid must stay quieter than the listing name"
import re
import sys

css = open(sys.argv[1], encoding="utf-8").read()

def first(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit("missing " + pattern)
    return match.group(1)

prize = first(r'\.paper-occupied\[data-paper-occupied\] \.card\[data-call-ad="lead"\] \.business\[data-prize\]\s*\{[^}]*font-size:\s*([\d.]+)rem')
facts = re.search(
    r'\.paper-occupied\[data-paper-occupied\] \.card\[data-call-ad="lead"\] \.later-facts\[data-later-fact\]\s*\{[^}]*\}',
    css,
    re.S,
)
if not facts:
    raise SystemExit("occupied #1 later-facts CSS missing")
if "color: var(--muted)" not in facts.group(0):
    raise SystemExit("occupied #1 later-facts money must recede")
if "color: var(--accent)" in facts.group(0):
    raise SystemExit("occupied #1 later-facts money must not shout accent")
if ".bid.later-fact" in css:
    raise SystemExit("stamp-only .bid.later-fact mute")
bid_size = first(
    r'\.paper-occupied\[data-paper-occupied\] \.card\[data-call-ad="lead"\] \.later-facts\[data-later-fact\]\s*\{[^}]*font-size:\s*([\d.]+)rem'
)
if float(bid_size) >= float(prize):
    raise SystemExit("occupied #1 later-facts $bid shouts like the listing name")
inner = re.search(
    r'\.paper-occupied\[data-paper-occupied\] \.card\[data-call-ad="lead"\] \.later-facts\[data-later-fact\] \.bid[\s\S]*?\{[^}]*\}',
    css,
    re.S,
)
if inner and "font-size:" in inner.group(0) and "inherit" not in inner.group(0):
    raise SystemExit("later-facts $bid must inherit group type, not a second mute stamp")
PY
grep -q 'data-call-after-claim' tests/board.test.ts \
  || fail "board tests must cover calling after the claim hop"
grep -q 'after the claim hop' tests/board.test.ts \
  || fail "board tests must keep Call after the claim hop"
grep -q 'local classified' tests/board.test.ts \
  || fail "board tests must cover the classified edition"
if grep -RInE '★|⭐|top rated|review count|top rated in London' app src >/dev/null 2>&1; then
  fail "board UI must not render stars or review counts"
fi

echo "== UX: unpaid stays off the classified paper — No #1 until Polar reports paid =="
grep -q 'export function isPolarPaidListing' src/board.ts \
  || fail "board.ts must export isPolarPaidListing"
grep -q 'export function paidListings' src/board.ts \
  || fail "board.ts must drop unpaid Polar checkout before ranking"
grep -q 'paidListings(listings)' src/board.ts \
  || fail "rankLane must rank Polar-paid rows only"
grep -q 'if (!isPolarPaidListing(listing)) return null' src/ui/listing-card.tsx \
  || fail "listing card must not print unpaid Call this #1"
grep -q 'data-polar-paid' src/ui/listing-card.tsx \
  || fail "paid listing card must stamp Polar-paid occupancy"
grep -q 'const paid = rankLane(listings)' src/ui/lane-board.tsx \
  || fail "lane occupancy must compose Polar-paid rows only"
grep -q 'rankLane(lanes\[category.slug\] ?? \[\])' src/ui/city-hub.tsx \
  || fail "city hub occupancy must compose Polar-paid rows only"
grep -q 'Unpaid' src/ui/lane-board.tsx \
  || fail "empty leftover lane must mention unpaid checkout"
grep -q 'checkout stays off the board until Polar reports paid' src/ui/lane-board.tsx \
  || fail "empty leftover lane must say unpaid checkout stays off the board"
grep -q 'An abandoned' src/ui/lane-board.tsx \
  || fail "empty leftover lane must mention abandoned leftover"
grep -q 'listing is not #1' src/ui/lane-board.tsx \
  || fail "empty leftover lane must say an abandoned listing is not #1"
grep -q 'Unpaid checkout stays off' src/ui/outbid-form.tsx \
  || fail "claim form must mention unpaid checkout stays off"
grep -q 'the board until Polar reports paid' src/ui/outbid-form.tsx \
  || fail "claim form must say unpaid checkout stays off the board"
grep -q 'An abandoned listing is not #1' src/ui/outbid-form.tsx \
  || fail "claim form must say an abandoned listing is not #1"
grep -q 'Unpaid checkout stays off the board until Polar reports paid' src/ui/claim-column.tsx \
  || fail "hub claim must say unpaid checkout stays off the board"
grep -q 'abandoned listing is not #1' src/ui/claim-column.tsx \
  || fail "occupied hub claim must say an abandoned listing is not #1"
grep -q 'card:not(\[data-polar-paid\])' app/globals.css \
  || fail "classified CSS must hide unpaid leftover cards"
python3 - app/globals.css <<'PY' || fail "unpaid leftover CSS must hide unpaid cards, not recolor the paper"
import re
import sys

css = open(sys.argv[1], encoding="utf-8").read()
block = re.search(
    r"\.paper-occupied\[data-paper-occupied\] \.card:not\(\[data-polar-paid\]\),\s*\.paper-empty\[data-paper-empty\] \.card:not\(\[data-polar-paid\]\)\s*\{([^}]*)\}",
    css,
    re.S,
)
if not block:
    raise SystemExit("unpaid leftover hide rule missing")
if "display: none" not in block.group(1):
    raise SystemExit("unpaid leftover must hide unpaid cards")
if "background:" in block.group(1) or "var(--accent)" in block.group(1):
    raise SystemExit("do not recolor unpaid leftover")
PY
if grep -qE 'data-unpaid-off|data-unpaid-off-board|data-call-after-claim-six|data-claim-after-call-six' \
  src/ui/listing-card.tsx src/ui/lane-board.tsx src/ui/city-hub.tsx src/ui/outbid-form.tsx src/ui/claim-column.tsx; then
  fail "unpaid-off occupancy must not add another named hop"
fi
grep -q 'unpaid stays off the classified paper' tests/board.test.ts \
  || fail "board tests must keep unpaid occupancy off the classified paper"
grep -q 'No #1 until Polar reports paid' tests/board.test.ts \
  || fail "board tests must wait for Polar paid before #1"
grep -q 'An abandoned listing is not #1' tests/board.test.ts \
  || fail "board tests must keep abandoned leftover off Call this #1"
grep -q 'data-prize' src/ui/listing-card.tsx \
  || fail "unpaid-off cut must keep occupied #1 name as the prize"
grep -q 'Call this #1' src/ui/listing-card.tsx \
  || fail "unpaid-off cut must keep occupied Call this #1"
grep -q 'data-later-call' src/ui/listing-card.tsx \
  || fail "unpaid-off cut must keep later-call grouping"
grep -q 'data-lane-occupied' src/ui/lane-board.tsx \
  || fail "unpaid-off cut must keep occupied mixed-paper lane wraps"
grep -q 'data-later-write' src/ui/outbid-form.tsx \
  || fail "unpaid-off cut must keep empty later-write listing name"
grep -q 'Claim #1' src/ui/outbid-form.tsx \
  || fail "unpaid-off cut must keep Claim #1"

echo "== UX: occupied paper keeps one first click — Call this #1, Claim stays after the listing =="
grep -q 'data-first-click": "call"' src/ui/listing-card.tsx \
  || grep -q 'data-first-click="call"' src/ui/listing-card.tsx \
  || fail "occupied Call this #1 must stamp the first click"
grep -q 'data-later-claim' src/ui/lane-board.tsx \
  || fail "occupied lane Claim must stamp later-claim grouping"
grep -q 'later-claim claim-after-call-line' src/ui/lane-board.tsx \
  || fail "occupied lane Claim must sit in a later-claim group"
grep -q 'data-later-claim' src/ui/claim-column.tsx \
  || fail "occupied hub Claim must stamp later-claim grouping"
grep -q 'Then Claim #1' src/ui/claim-column.tsx \
  || fail "occupied hub Claim must name itself a later write"
grep -q 'data-later-claim' src/ui/outbid-form.tsx \
  || fail "occupied lane form must stamp later-claim grouping"
grep -q 'Then Claim #1' src/ui/outbid-form.tsx \
  || fail "occupied lane form must name Claim a later write"
grep -q 'Occupied paper: Call this #1 is the only first click' app/globals.css \
  || fail "classified CSS must document occupied Call this #1 as the only first click"
grep -q 'later-claim\[data-later-claim\]' app/globals.css \
  || fail "classified CSS must keep occupied Claim in a later-claim group"
python3 - app/globals.css <<'PY' || fail "occupied later Claim must stay quieter than Call this #1"
import re
import sys

css = open(sys.argv[1], encoding="utf-8").read()

def first(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit("missing " + pattern)
    return match.group(1)

lead = first(r"\.paper-occupied\[data-paper-occupied\] \.call-this-one\.call-after-claim-five\s*,\s*\.paper-occupied\[data-paper-occupied\] \.call-this-one\[data-call-after-claim-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
later = first(r"\.paper-occupied\[data-paper-occupied\] \.later-claim\[data-later-claim\] h2\s*\{[^}]*font-size:\s*([\d.]+)rem")
line = first(r"\.paper-occupied\[data-paper-occupied\] \.later-claim\.claim-after-call-line\[data-later-claim\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
if float(later) >= float(lead):
    raise SystemExit("occupied later Claim shouts like Call this #1")
if float(line) >= float(lead):
    raise SystemExit("occupied later Outbid my column shouts like Call this #1")
block = re.search(
    r"\.paper-occupied\[data-paper-occupied\] \.later-claim\[data-later-claim\]\s*\{[^}]*\}",
    css,
    re.S,
)
if not block or "var(--accent)" in block.group(0):
    raise SystemExit("do not recolor occupied later Claim")
if "color: var(--muted)" not in block.group(0):
    raise SystemExit("occupied later Claim must recede")
if "data-later-claim-quiet" in css:
    raise SystemExit("stamp-only data-later-claim-quiet mute")
inner = re.search(
    r"\.paper-occupied\[data-paper-occupied\] \.later-claim\[data-later-claim\] \.claim-after-call\s*\{[^}]*\}",
    css,
    re.S,
)
if inner and "font-size:" in inner.group(0) and "inherit" not in inner.group(0):
    raise SystemExit("occupied later Claim hop must inherit group type, not a second mute stamp")
PY
if grep -qE 'data-later-claim-quiet|data-call-after-claim-six|data-claim-after-call-six' \
  src/ui/listing-card.tsx src/ui/lane-board.tsx src/ui/city-hub.tsx src/ui/outbid-form.tsx src/ui/claim-column.tsx; then
  fail "occupied later Claim must not add another named hop"
fi
if grep -q 'outbid claim-after-call' src/ui/lane-board.tsx; then
  fail "occupied later Claim must not reuse Outbid chrome of Call this #1"
fi
grep -q 'occupied paper keeps one first click' tests/board.test.ts \
  || fail "board tests must cover occupied one first click: Call this #1, Claim after the listing"
grep -q 'Call this #1, Claim stays after the listing' tests/board.test.ts \
  || fail "board tests must keep Claim after the listing"
grep -q 'data-prize' src/ui/listing-card.tsx \
  || fail "occupied first-click cut must keep occupied #1 name as the prize"
grep -q 'Call this #1' src/ui/listing-card.tsx \
  || fail "occupied first-click cut must keep occupied Call this #1"
grep -q 'data-later-call' src/ui/listing-card.tsx \
  || fail "occupied first-click cut must keep later-call grouping"
grep -q 'data-lane-occupied' src/ui/lane-board.tsx \
  || fail "occupied first-click cut must keep occupied mixed-paper lane wraps"
grep -q 'data-later-write' src/ui/outbid-form.tsx \
  || fail "occupied first-click cut must keep empty later-write listing name"
grep -q 'isPolarPaidListing' src/board.ts \
  || fail "occupied first-click cut must keep unpaid leftover off the board"
grep -q 'Claim #1' src/ui/outbid-form.tsx \
  || fail "occupied first-click cut must keep empty Claim #1"

echo "== UX: occupied week window is rolling last-7-days — not Monday 00:00 Europe/London =="
grep -q 'export function rollingWeekStart' src/week.ts \
  || fail "week.ts must export rollingWeekStart"
grep -q 'export function bidInRollingWeek' src/week.ts \
  || fail "week.ts must export bidInRollingWeek"
grep -q 'ROLLING_WEEK_MS' src/week.ts \
  || fail "week.ts must name the rolling last-7-days length"
grep -q 'created_at >=' src/board.ts \
  || fail "live board must filter Polar-paid createdAt in the rolling window"
grep -q 'week_id = ?' src/board.ts \
  || fail "board must still read labeled week_id archive copies"
grep -q 'bidInRollingWeek' src/board.ts \
  || fail "live occupancy must use bidInRollingWeek, not Monday midnight"
grep -q 'data-rolling-week' src/ui/edition.tsx \
  || fail "occupied edition must name the rolling week window"
grep -q 'folio week-window' src/ui/edition.tsx \
  || fail "occupied edition must compose a week-window folio, not a stamp on Monday midnight"
grep -q 'Rolling last 7 days. Not Monday 00:00 Europe/London.' src/ui/edition.tsx \
  || fail "occupied edition must say rolling last 7 days, not London Monday midnight"
grep -q 'data-rolling-week' src/ui/lane-board.tsx \
  || fail "occupied leaderboard must be the rolling week window"
if grep -q 'data-rolling-week' src/ui/claim-column.tsx src/ui/outbid-form.tsx src/ui/listing-card.tsx; then
  fail "rolling week must not re-ship Claim / Call hops"
fi
if grep -q '24h lock' src/ui/edition.tsx src/ui/lane-board.tsx src/ui/claim-column.tsx src/ui/city-hub.tsx; then
  fail "rolling week must not become a 24h lock on #1"
fi
grep -q 'folio.week-window\[data-rolling-week\]' app/globals.css \
  || fail "occupied CSS must style the rolling week-window folio"
grep -q 'lane-occupied\[data-lane-occupied\] .leaderboard\[data-rolling-week\]' app/globals.css \
  || fail "occupied CSS must scope the rolling window to occupied columns"
grep -q 'paper-empty\[data-paper-empty\] \[data-rolling-week\]' app/globals.css \
  || fail "empty paper CSS must hide rolling-week chrome"
grep -q 'lane-empty\[data-lane-empty\] \[data-rolling-week\]' app/globals.css \
  || fail "empty-lane CSS must hide rolling-week chrome"
python3 - app/globals.css <<'PY' || fail "rolling-week CSS must name the window, not recolor the paper"
import re
import sys

css = open(sys.argv[1], encoding="utf-8").read()
block = re.search(
    r"\.paper-occupied\[data-paper-occupied\] \.folio\.week-window\[data-rolling-week\]\s*\{([^}]*)\}",
    css,
    re.S,
)
if not block:
    raise SystemExit("occupied week-window folio rule missing")
if "background:" in block.group(1) or "var(--accent)" in block.group(1):
    raise SystemExit("do not recolor the rolling week window")
if "text-transform: none" not in block.group(1):
    raise SystemExit("occupied week-window must drop Monday folio uppercase")
PY
grep -q 'Rolling last 7 days' app/rules/page.tsx \
  || fail "rules must state rolling last 7 days"
grep -q 'Not Monday 00:00 Europe/London' app/rules/page.tsx \
  || fail "rules must say the window is not London Monday midnight"
grep -q 'occupied week window is rolling last-7-days' tests/board.test.ts \
  || fail "board tests must cover occupied rolling last-7-days"
grep -q 'not Monday 00:00 Europe/London' tests/board.test.ts \
  || fail "board tests must keep occupied window off London Monday midnight"
grep -q 'Monday 00:00 Europe/London does not drop a bid still inside the rolling week' tests/week.test.ts \
  || fail "week tests must keep Sunday pays across London Monday midnight"
if grep -qE 'data-call-after-claim-six|data-claim-after-call-six|call-after-claim-N' \
  src/ui/edition.tsx src/ui/lane-board.tsx src/week.ts src/board.ts; then
  fail "rolling week must not stamp call-after-claim-N"
fi

echo "== UX: empty paper copy is rolling last-7-days — not Monday 00:00 Europe/London =="
python3 - src/ui/edition.tsx <<'PY' || fail "empty paper must name rolling last 7 days without occupied chrome"
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()
block = re.search(r"emptyPaper \? \((.*?)\) : \(", src, re.S)
if not block:
    raise SystemExit("emptyPaper folio branch missing")
empty = block.group(1)
if "Rolling last 7 days. Not Monday 00:00 Europe/London." not in empty:
    raise SystemExit("empty paper must name rolling last 7 days")
if "data-rolling-week" in empty:
    raise SystemExit("empty paper must not stamp occupied data-rolling-week")
if "week-window" in empty:
    raise SystemExit("empty paper must not use occupied week-window chrome")
if "Week of" in empty or "formatWeekLabel" in empty:
    raise SystemExit("empty paper must not present Monday 00:00 as the drop")
PY
grep -q 'empty paper copy is rolling last-7-days' tests/board.test.ts \
  || fail "board tests must cover empty paper rolling last-7-days copy"
grep -q 'paper-empty\[data-paper-empty\] .folio' app/globals.css \
  || fail "empty paper CSS must make the fair-window folio readable"
python3 - app/globals.css <<'PY' || fail "empty fair-window folio must name the window, not recolor the paper"
import re
import sys

css = open(sys.argv[1], encoding="utf-8").read()
block = re.search(
    r"\.paper-empty\[data-paper-empty\] \.folio\s*\{([^}]*)\}",
    css,
    re.S,
)
if not block:
    raise SystemExit("empty folio fair-window rule missing")
if "background:" in block.group(1) or "var(--accent)" in block.group(1):
    raise SystemExit("do not recolor the empty fair-window folio")
if "text-transform: none" not in block.group(1):
    raise SystemExit("empty folio must drop Monday folio uppercase so the window is readable")
PY
if grep -q 'Week of ' src/ui/edition.tsx; then
  fail "empty paper must not keep Monday week-of copy"
fi
if grep -qE 'data-call-after-claim-six|data-claim-after-call-six|call-after-claim-N' \
  src/ui/edition.tsx app/globals.css; then
  fail "empty rolling copy must not stamp call-after-claim-N"
fi
if grep -q 'data-rolling-week' src/ui/claim-column.tsx src/ui/outbid-form.tsx src/ui/listing-card.tsx; then
  fail "empty rolling copy must not re-ship Claim / Call hops"
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
grep -q 'bid_too_low' tests/checkout.test.ts || fail "checkout tests must cover bid_too_low"
grep -q 'bid_not_integer' tests/checkout.test.ts || fail "checkout tests must cover bid_not_integer"
if grep -nE 'fetch\(|polar\.sh|api\.polar' src/polar/fake.ts src/polar/port.ts >/dev/null; then
  fail "fixture/port must not call Polar over the network"
fi
if grep -RInE 'https?://([^/]*\.)?polar\.sh' app src tests \
  | grep -v 'src/polar/live.ts:' \
  | grep -v 'tests/live-smoke.test.ts:' >/dev/null; then
  fail "app/src/tests must not hard-code polar.sh HTTP (live.ts excepted)"
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
grep -q 'week_id = ?' src/board.ts || fail "board must filter labeled archive lanes by weekId"
grep -q 'created_at >=' src/board.ts || fail "live board must filter rolling createdAt, not Monday midnight"
grep -q 'lastWeekNumberOne' src/board.ts || fail "board must expose last-week archive, not current #1"
grep -q 'Monday 00:00' tests/week.test.ts || fail "week tests must pin Monday 00:00 London rollover"
grep -q 'rolling last-7-days' tests/week.test.ts || fail "week tests must cover rolling last-7-days occupancy"
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
echo "== live Polar gate + live-smoke =="
for f in src/polar/live.ts scripts/live-smoke.sh docs/live-smoke.md tests/live-smoke.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
[[ -x scripts/live-smoke.sh ]] || fail "scripts/live-smoke.sh must be executable"
grep -q 'export class LivePolarPort' src/polar/live.ts \
  || fail "live.ts must export LivePolarPort"
grep -q 'BLOCKED-SECRET: POLAR_ACCESS_TOKEN' src/polar/live.ts \
  || fail "live.ts must fail closed without POLAR_ACCESS_TOKEN"
grep -q 'POLAR_LIVE' src/polar/live.ts || fail "live.ts must gate on POLAR_LIVE"
grep -q 'POLAR_FIXTURE_ONLY' src/polar/live.ts \
  || fail "live.ts must honor POLAR_FIXTURE_ONLY"
grep -q 'export function polarApiBase' src/polar/live.ts \
  || fail "live.ts must honor POLAR_API_BASE override"
grep -q 'https://api.polar.sh' src/polar/live.ts \
  || fail "live.ts default Polar API must stay production"
if grep -Eq '^(export )?POLAR_LIVE=1' scripts/test.sh; then
  fail "test.sh must not set POLAR_LIVE=1"
fi
grep -q 'getPolarPort' src/polar/fake.ts || fail "fake.ts must select the Polar port"
grep -q 'LivePolarPort' src/polar/fake.ts \
  || fail "getPolarPort must select LivePolarPort when live"
grep -q 'BLOCKED-SECRET: POLAR_ACCESS_TOKEN' scripts/live-smoke.sh \
  || fail "live-smoke.sh must name BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
grep -q 'POLAR_LIVE' scripts/live-smoke.sh \
  || fail "live-smoke.sh must gate live Polar on POLAR_LIVE"
grep -q 'sandbox.polar.sh/checkout' scripts/live-smoke.sh \
  || fail "live-smoke.sh must require a sandbox.polar.sh Checkout URL"
grep -q 'POLAR_API_BASE' scripts/live-smoke.sh \
  || fail "live-smoke.sh must pass POLAR_API_BASE to the live process"
if grep -nE '^[[:space:]]+local assignment=' scripts/live-smoke.sh >/dev/null; then
  fail "live-smoke.sh must not local-scope Polar env exports"
fi
grep -q 'live-smoke refuses CI=true' scripts/live-smoke.sh \
  || fail "live-smoke.sh must refuse CI=true"
grep -q 'live-smoke must not run in GitHub Actions' scripts/live-smoke.sh \
  || fail "live-smoke.sh must refuse GITHUB_ACTIONS"
grep -q 'data-empty-lane' scripts/live-smoke.sh \
  || fail "live-smoke.sh must keep an empty London lane honest"
grep -q 'PASS-ERROR' docs/live-smoke.md || fail "docs/live-smoke.md missing PASS-ERROR"
grep -q 'BLOCKED-SECRET' docs/live-smoke.md || fail "docs/live-smoke.md missing BLOCKED-SECRET"
grep -q 'London' docs/live-smoke.md || fail "docs/live-smoke.md must name London"
if grep -Eq '^\s*(bash )?(\./)?scripts/live-smoke\.sh' scripts/test.sh; then
  fail "test.sh must not invoke live-smoke.sh"
fi
if grep -q 'live-smoke.sh' .github/workflows/ci.yml; then
  fail "live-smoke.sh must not be called from Actions"
fi
if grep -Eqi 'POLAR_LIVE=1|POLAR_ACCESS_TOKEN=' .github/workflows/ci.yml; then
  fail "CI must not set live Polar flags or secrets"
fi
grep -q 'BLOCKED-SECRET' tests/live-smoke.test.ts \
  || fail "live-smoke tests must cover BLOCKED-SECRET"
grep -q 'POLAR_FIXTURE_ONLY' tests/live-smoke.test.ts \
  || fail "live-smoke tests must cover POLAR_FIXTURE_ONLY wins"
if grep -nE 'fetch\(|polar\.sh|api\.polar' tests/live-smoke.test.ts \
  | grep -v 'polarApiBase' \
  | grep -v 'POLAR_API_BASE' \
  | grep -v 'sandbox-api' \
  | grep -v 'sandbox.polar.sh' \
  | grep -v 'api.polar.sh' \
  | grep -v 'stubFetch' >/dev/null; then
  fail "live-smoke tests must stay offline (no Polar HTTP)"
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
  grep -q 'occupied later Call #N stays quieter than Call this #1' "$test_log" \
    || fail "occupied later-rank quiet test did not run"
  grep -q 'occupied later Call stays quieter in grouping, not a mute of the same hop' "$test_log" \
    || fail "occupied later-call grouping test did not run"
  grep -q 'occupied mixed paper keeps empty lanes honest — later Call cannot leak onto No #1' "$test_log" \
    || fail "occupied mixed-paper empty-lane honesty test did not run"
  grep -q 'occupied paper keeps column tabs after the listing' "$test_log" \
    || fail "occupied column-tabs-after-listing test did not run"
  grep -q 'occupied #1 \$bid stays a later fact in grouping, not a muted stamp on the same \$bid span' "$test_log" \
    || fail "occupied later-fact grouping test did not run"
  grep -q 'empty paper stays Claim #1 — later-facts / Call this #1 cannot leak' "$test_log" \
    || fail "empty-paper isolation test did not run"
  grep -q 'empty paper has one first click: Claim #1, then the listing name' "$test_log" \
    || fail "empty-paper listing-name later-write test did not run"
  grep -q 'unpaid stays off the classified paper — No #1 until Polar reports paid' "$test_log" \
    || fail "unpaid stays off the classified paper leftover test did not run"
  grep -q 'occupied paper keeps one first click — Call this #1, Claim stays after the listing' "$test_log" \
    || fail "occupied one-first-click leftover test did not run"
  grep -q 'occupied week window is rolling last-7-days — not Monday 00:00 Europe/London' "$test_log" \
    || fail "occupied rolling last-7-days window test did not run"
  grep -q 'empty paper copy is rolling last-7-days — not Monday 00:00 Europe/London' "$test_log" \
    || fail "empty paper rolling last-7-days copy test did not run"

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
  grep -q 'data-classified=""' "${home_body}" || fail "GET / must render the classified edition"
  grep -q 'class="paper classified paper-empty"' "${home_body}" \
    || fail "GET / empty paper must wrap in paper-empty"
  grep -q 'data-paper-empty="true"' "${home_body}" \
    || fail "GET / empty paper must stamp data-paper-empty"
  if grep -q 'paper-occupied' "${home_body}"; then
    fail "GET / empty paper must not wrap as occupied"
  fi
  if grep -q 'data-paper-occupied' "${home_body}"; then
    fail "GET / empty paper must not stamp occupied"
  fi
  grep -q 'data-edition=""' "${home_body}" || fail "GET / must stamp the city edition header"
  grep -q 'edition-city' "${home_body}" || fail "GET / city must be the edition masthead"
  grep -q 'data-classified-columns=""' "${home_body}" || fail "GET / categories must be classified columns"
  grep -q 'data-empty-lane="true"' "${home_body}" || fail "GET / empty London lane must be empty"
  grep -q 'class="lane classified-column lane-empty"' "${home_body}" \
    || fail "GET / empty paper must wrap columns as lane-empty"
  grep -q 'data-lane-empty="true"' "${home_body}" \
    || fail "GET / empty paper must stamp data-lane-empty"
  if grep -q 'lane-occupied' "${home_body}"; then
    fail "GET / empty paper must not wrap columns as occupied lanes"
  fi
  if grep -q 'data-lane-occupied' "${home_body}"; then
    fail "GET / empty paper must not stamp occupied lanes"
  fi
  grep -q 'data-empty-honest=""' "${home_body}" || fail "GET / empty lanes must stamp honest empty"
  home_empty_honest="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-empty-honest=\"\""))' "${home_body}")"
  [[ "${home_empty_honest}" == "4" ]] \
    || fail "GET / must keep four honest empty lanes (got ${home_empty_honest})"
  grep -q 'No #1' "${home_body}" || fail "GET / empty lanes must say No #1"
  grep -q 'No stars. No map.' "${home_body}" || fail "GET / empty lanes must refuse stars and maps"
  grep -q 'class="outbid claim-first-click"' "${home_body}" \
    || fail "GET / empty paper must keep Outbid chrome on the one Claim #1 first click"
  grep -q 'Claim #1' "${home_body}" || fail "GET / must keep Claim #1 after the classified columns"
  grep -q 'data-claim-pick' "${home_body}" || fail "GET / must pick a column before the want-ad fields"
  grep -q 'claim-first-click' "${home_body}" || fail "GET / empty paper must lead with one Claim #1 first click"
  grep -q 'Then pick the column' "${home_body}" || fail "GET / empty paper must treat the trade pick as the next step"
  grep -q 'claim-columns claim-next' "${home_body}" || fail "GET / empty paper must keep the trade pick quieter than Claim #1"
  home_empty_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-empty-lane"))' "${home_body}")"
  home_claim_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-pick"))' "${home_body}")"
  home_first_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("claim-first-click"))' "${home_body}")"
  home_pick_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("Then pick the column"))' "${home_body}")"
  [[ "${home_empty_at}" -ge 0 && "${home_claim_at}" -gt "${home_empty_at}" ]] \
    || fail "GET / must show empty columns before the Outbid claim"
  [[ "${home_first_at}" -gt "${home_empty_at}" && "${home_pick_at}" -gt "${home_first_at}" ]] \
    || fail "GET / empty paper must show Claim #1 before the quieter column pick"
  grep -q 'href="/c/london/movers#claim"' "${home_body}" \
    || fail "GET / claim must send a first-time local into one column"
  grep -q 'data-claim-job="movers"' "${home_body}" \
    || fail "GET / hop must stamp the movers job on the claim link"
  if grep -q 'Outbid my movers column' "${home_body}"; then
    fail "GET / empty paper must not print four same-weight Outbid-my-column buttons"
  fi
  if grep -q 'data-category-tabs' "${home_body}"; then
    fail "GET / empty paper must not print a same-weight four-tab column index"
  fi
  if grep -q 'data-column-index-after' "${home_body}"; then
    fail "GET / empty paper must not hang occupied column tabs after the listing"
  fi
  if grep -q 'Outbid Movers' "${home_body}"; then
    fail "GET / must not keep generic Outbid {category} hops"
  fi
  if grep -q 'name="business"' "${home_body}"; then
    fail "GET / must not print the tall want-ad field grid"
  fi
  if grep -qE 'data-later-write|Then the listing name|data-empty-claim-first' "${home_body}"; then
    fail "GET / empty hub must keep the listing name off the column pick"
  fi
  if grep -q 'Call this #1' "${home_body}"; then
    fail "empty GET / must not invent Call this #1"
  fi
  if grep -q 'data-prize' "${home_body}"; then
    fail "empty GET / must not invent a prize business name"
  fi
  if grep -qE 'data-later-fact|later-facts|later-fact' "${home_body}"; then
    fail "empty GET / must not invent later-fact \$bid"
  fi
  if grep -qE 'Call #[0-9]|data-call-later|data-later-call|data-call-ad="later"' "${home_body}"; then
    fail "empty GET / must not invent a later-rank call"
  fi
  if grep -qE 'data-claim-after-call|after Call #|after Call this #1' "${home_body}"; then
    fail "empty GET / must not invent a claim-after-call hop"
  fi
  if grep -q 'data-rolling-week' "${home_body}"; then
    fail "empty GET / must not stamp occupied data-rolling-week"
  fi
  if grep -q 'week-window' "${home_body}"; then
    fail "empty GET / must not use occupied week-window chrome"
  fi
  if grep -q 'Week of ' "${home_body}"; then
    fail "empty GET / must not present Monday week-of as the drop"
  fi
  grep -q 'Rolling last 7 days. Not Monday 00:00 Europe/London.' "${home_body}" \
    || fail "empty GET / must name rolling last 7 days, not London Monday midnight"
  if grep -q '24h lock' "${home_body}"; then
    fail "empty GET / must not become a 24h lock on #1"
  fi
  if grep -qE 'data-claim-after-call-two|claim-after-call-two' "${home_body}"; then
    fail "empty GET / must not invent a claim-after-call-two hop"
  fi
  if grep -qE 'data-claim-after-call-three|claim-after-call-three' "${home_body}"; then
    fail "empty GET / must not invent a claim-after-call-three hop"
  fi
  if grep -qE 'data-claim-after-call-four|claim-after-call-four' "${home_body}"; then
    fail "empty GET / must not invent a claim-after-call-four hop"
  fi
  if grep -qE 'data-claim-after-call-five|claim-after-call-five' "${home_body}"; then
    fail "empty GET / must not invent a claim-after-call-five hop"
  fi
  if grep -qE 'data-call-after-claim=""|after the claim hop' "${home_body}"; then
    fail "empty GET / must not invent a call-after-claim hop"
  fi
  if grep -qE 'data-call-after-claim-one|call-after-claim-one' "${home_body}"; then
    fail "empty GET / must not invent Call this #1 after the claim hop"
  fi
  if grep -qE 'data-call-after-claim-two|call-after-claim-two' "${home_body}"; then
    fail "empty GET / must not invent Call this #1 after Outbid my column is re-concentrated"
  fi
  if grep -qE 'data-call-after-claim-three|call-after-claim-three' "${home_body}"; then
    fail "empty GET / must not invent Call this #1 after Outbid my column is re-concentrated again"
  fi
  if grep -qE 'data-call-after-claim-four|call-after-claim-four' "${home_body}"; then
    fail "empty GET / must not invent Call this #1 after Outbid my column is re-concentrated again after claim-four"
  fi
  if grep -qE 'data-call-after-claim-five|call-after-claim-five' "${home_body}"; then
    fail "empty GET / must not invent Call this #1 after Outbid my column is re-concentrated again"
  fi
  if grep -qiE '★|⭐|top rated|review count|top rated in London' "${home_body}"; then
    fail "GET / must not show stars or review counts"
  fi
  if grep -qiE 'google map|map pin|leaflet|OpenStreetMap' "${home_body}"; then
    fail "GET / must not invent a map"
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
  grep -q 'class="lane classified-column lane-empty"' "${lane_body}" \
    || fail "empty movers lane must wrap as lane-empty"
  grep -q 'data-lane-empty="true"' "${lane_body}" \
    || fail "empty movers lane must stamp data-lane-empty"
  if grep -q 'lane-occupied\|data-lane-occupied' "${lane_body}"; then
    fail "empty movers lane must not wrap as occupied"
  fi
  grep -q 'data-empty-honest=""' "${lane_body}" || fail "empty movers lane must stamp honest empty"
  grep -q 'No #1' "${lane_body}" || fail "empty movers lane must say No #1"
  grep -q 'No stars. No map.' "${lane_body}" || fail "empty movers lane must refuse stars and maps"
  if grep -qE 'Call #[0-9]|data-call-later|data-later-call|data-call-ad="later"' "${lane_body}"; then
    fail "empty movers lane must not invent a later-rank call"
  fi
  if grep -qE 'data-claim-after-call|after Call #|after Call this #1' "${lane_body}"; then
    fail "empty movers lane must not invent a claim-after-call hop"
  fi
  if grep -qE 'data-claim-after-call-two|claim-after-call-two' "${lane_body}"; then
    fail "empty movers lane must not invent a claim-after-call-two hop"
  fi
  if grep -qE 'data-claim-after-call-three|claim-after-call-three' "${lane_body}"; then
    fail "empty movers lane must not invent a claim-after-call-three hop"
  fi
  if grep -qE 'data-claim-after-call-four|claim-after-call-four' "${lane_body}"; then
    fail "empty movers lane must not invent a claim-after-call-four hop"
  fi
  if grep -qE 'data-claim-after-call-five|claim-after-call-five' "${lane_body}"; then
    fail "empty movers lane must not invent a claim-after-call-five hop"
  fi
  if grep -qE 'data-call-after-claim=""|after the claim hop' "${lane_body}"; then
    fail "empty movers lane must not invent a call-after-claim hop"
  fi
  if grep -qE 'data-call-after-claim-one|call-after-claim-one' "${lane_body}"; then
    fail "empty movers lane must not invent Call this #1 after the claim hop"
  fi
  if grep -qE 'data-call-after-claim-two|call-after-claim-two' "${lane_body}"; then
    fail "empty movers lane must not invent Call this #1 after Outbid my column is re-concentrated"
  fi
  if grep -qE 'data-call-after-claim-three|call-after-claim-three' "${lane_body}"; then
    fail "empty movers lane must not invent Call this #1 after Outbid my column is re-concentrated again"
  fi
  if grep -qE 'data-call-after-claim-four|call-after-claim-four' "${lane_body}"; then
    fail "empty movers lane must not invent Call this #1 after Outbid my column is re-concentrated again after claim-four"
  fi
  if grep -qE 'data-call-after-claim-five|call-after-claim-five' "${lane_body}"; then
    fail "empty movers lane must not invent Call this #1 after Outbid my column is re-concentrated again"
  fi
  if grep -qE 'data-later-fact|later-facts|later-fact' "${lane_body}"; then
    fail "empty movers lane must not invent later-fact \$bid"
  fi
  grep -q 'Outbid' "${lane_body}" || fail "lane board must show Outbid form chrome"
  grep -q 'class="claim empty-claim-first"' "${lane_body}" \
    || fail "empty movers lane must stamp empty Claim #1 as the first click"
  grep -q 'data-empty-claim-first=""' "${lane_body}" \
    || fail "empty movers lane must stamp data-empty-claim-first"
  grep -q 'data-first-click="claim"' "${lane_body}" \
    || fail "empty movers lane must keep Claim #1 as the first click"
  grep -q 'data-later-write=""' "${lane_body}" \
    || fail "empty movers lane must stamp the listing name as a later write"
  grep -q 'Then the listing name' "${lane_body}" \
    || fail "empty movers lane must treat the listing name as the next write after Claim #1"
  grep -q 'data-listing-identity=""' "${lane_body}" \
    || fail "empty movers lane must group listing identity after Outbid"
  grep -q 'name="business"' "${lane_body}" \
    || fail "empty movers lane must still collect the listing name after Outbid"
  lane_write_order="$(python3 -c '
import sys
html = open(sys.argv[1]).read()
print(
    html.find("Claim #1 for"),
    html.find(">Outbid<"),
    html.find("data-later-write"),
    html.find("Then the listing name"),
    html.find("name=\"business\""),
    sep=" ",
)
' "${lane_body}")"
  read -r lane_claim_at lane_outbid_at lane_later_at lane_label_at lane_name_at <<< "${lane_write_order}"
  [[ "${lane_claim_at}" -ge 0 && "${lane_outbid_at}" -gt "${lane_claim_at}" ]] \
    || fail "empty movers lane must keep Outbid with Claim #1"
  [[ "${lane_later_at}" -gt "${lane_outbid_at}" && "${lane_label_at}" -gt "${lane_later_at}" ]] \
    || fail "empty movers lane must keep the listing name after Outbid"
  [[ "${lane_name_at}" -gt "${lane_label_at}" ]] \
    || fail "empty movers lane must not put the listing name in the same-weight field grid as Outbid"
  grep -q 'data-classified=""' "${lane_body}" || fail "lane page must stay inside the classified edition"
  grep -q 'class="paper classified paper-empty"' "${lane_body}" \
    || fail "empty movers lane must wrap in paper-empty"
  grep -q 'data-paper-empty="true"' "${lane_body}" \
    || fail "empty movers lane must stamp data-paper-empty"
  grep -q 'Rolling last 7 days. Not Monday 00:00 Europe/London.' "${lane_body}" \
    || fail "empty movers lane paper must name rolling last 7 days"
  if grep -q 'data-rolling-week' "${lane_body}"; then
    fail "empty movers lane must not stamp occupied data-rolling-week"
  fi
  if grep -q 'week-window' "${lane_body}"; then
    fail "empty movers lane must not use occupied week-window chrome"
  fi
  if grep -q 'Week of ' "${lane_body}"; then
    fail "empty movers lane must not present Monday week-of as the drop"
  fi
  if grep -q 'paper-occupied' "${lane_body}"; then
    fail "empty movers lane must not wrap as occupied"
  fi
  grep -q 'edition-city' "${lane_body}" || fail "lane page must keep the city edition masthead"
  if grep -q 'data-category-tabs' "${lane_body}"; then
    fail "empty movers lane must not hang a four-tab column index"
  fi
  if grep -q 'data-column-index-after' "${lane_body}"; then
    fail "empty movers lane must not hang occupied column tabs after the listing"
  fi

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
  grep -q 'class="lane classified-column lane-occupied"' "${movers_paid}" \
    || fail "paid movers lane must wrap as lane-occupied"
  grep -q 'data-lane-occupied="true"' "${movers_paid}" \
    || fail "paid movers lane must stamp data-lane-occupied"
  if grep -q 'lane-empty\|data-lane-empty' "${movers_paid}"; then
    fail "paid movers lane must not wrap as empty"
  fi
  grep -q 'North London Movers' "${movers_paid}" || fail "paid listing must appear on the board"
  grep -q '\$20' "${movers_paid}" || fail "paid listing must show \$20"
  grep -q 'class="paper classified paper-occupied"' "${movers_paid}" \
    || fail "paid movers lane must wrap in paper-occupied"
  grep -q 'data-paper-occupied="true"' "${movers_paid}" \
    || fail "paid movers lane must stamp data-paper-occupied"
  if grep -q 'paper-empty' "${movers_paid}"; then
    fail "paid movers lane must not wrap as empty paper"
  fi
  grep -q 'data-prize' "${movers_paid}" || fail "paid #1 must stamp the business name as the prize"
  grep -q 'class="business" data-prize' "${movers_paid}" \
    || fail "paid #1 prize must be the business name"
  grep -q 'class="later-facts"' "${movers_paid}" \
    || fail "paid #1 \$bid must sit in a later-facts group"
  grep -q 'data-later-fact=""' "${movers_paid}" \
    || fail "paid #1 must stamp the later-facts group"
  if grep -q 'class="bid later-fact"' "${movers_paid}"; then
    fail "paid #1 must not stamp class=bid later-fact on the same \$bid span"
  fi
  prize_order="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"1\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print(chunk.find("data-prize"), chunk.find("North London Movers"), chunk.find("class=\"later-facts\""), chunk.find("data-later-fact"), chunk.find("$20"), chunk.find("0 clicks"), sep=" ")
' "${movers_paid}")"
  read -r prize_at name_at paid_facts_at paid_later_at paid_bid_at paid_clicks_at <<< "${prize_order}"
  [[ "${prize_at}" -ge 0 && "${name_at}" -ge 0 && "${name_at}" -lt "${paid_bid_at}" ]] \
    || fail "paid #1 business name must read before \$bid"
  [[ "${prize_at}" -lt "${paid_bid_at}" && "${prize_at}" -lt "${paid_clicks_at}" ]] \
    || fail "paid #1 prize must read before \$bid and clicks"
  [[ "${paid_facts_at}" -ge 0 && "${paid_later_at}" -ge 0 && "${paid_facts_at}" -lt "${paid_bid_at}" ]] \
    || fail "paid #1 later-facts \$bid must sit after the listing name"
  paid_later_count="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"1\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print(chunk.count("data-later-fact=\"\""), chunk.count("class=\"later-facts\""), chunk.count("class=\"bid later-fact\""), sep=" ")
' "${movers_paid}")"
  read -r paid_later_stamps paid_later_groups paid_later_span <<< "${paid_later_count}"
  [[ "${paid_later_stamps}" == "1" ]] \
    || fail "lone paid #1 must keep one later-fact group stamp (got ${paid_later_stamps})"
  [[ "${paid_later_groups}" == "1" ]] \
    || fail "lone paid #1 must keep one later-facts group (got ${paid_later_groups})"
  [[ "${paid_later_span}" == "0" ]] \
    || fail "lone paid #1 must not stamp class=bid later-fact (got ${paid_later_span})"
  grep -q 'Call this #1' "${movers_paid}" || fail "paid #1 must offer Call this #1"
  grep -q 'data-call-this-one' "${movers_paid}" || fail "paid #1 must stamp data-call-this-one"
  grep -q 'data-first-click="call"' "${movers_paid}" \
    || fail "paid #1 must stamp Call this #1 as the occupied first click"
  grep -q 'class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"' "${movers_paid}" \
    || fail "paid #1 must concentrate Call this #1 on Outbid chrome"
  grep -q 'data-call-after-claim-one' "${movers_paid}" \
    || fail "paid #1 must concentrate Call this #1 after Outbid my column"
  grep -q 'data-call-after-claim-two' "${movers_paid}" \
    || fail "paid #1 must concentrate Call this #1 after Outbid my column is re-concentrated"
  grep -q 'data-call-after-claim-three' "${movers_paid}" \
    || fail "paid #1 must concentrate Call this #1 after Outbid my column is re-concentrated again"
  grep -q 'data-call-after-claim-four' "${movers_paid}" \
    || fail "paid #1 must concentrate Call this #1 after Outbid my column is re-concentrated again after claim-four"
  grep -q 'data-call-after-claim-five' "${movers_paid}" \
    || fail "paid #1 must concentrate Call this #1 after Outbid my column is re-concentrated again"
  grep -q 'data-call-ad="lead"' "${movers_paid}" || fail "paid #1 must stamp data-call-ad=lead"
  grep -q 'href="/go/' "${movers_paid}" || fail "Call this #1 must hop through /go/:id"
  one_call_count="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"1\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print(chunk.count("data-call-this-one"), chunk.count("data-call-after-claim-one"), chunk.count("data-call-after-claim-two"), chunk.count("data-call-after-claim-three"), chunk.count("data-call-after-claim-four"), chunk.count("data-call-after-claim-five"), sep=" ")
' "${movers_paid}")"
  read -r one_call_hops one_call_stamps one_call_two one_call_three one_call_four one_call_five <<< "${one_call_count}"
  [[ "${one_call_hops}" == "1" ]] \
    || fail "lone paid #1 must keep one Call this #1 hop (got ${one_call_hops})"
  [[ "${one_call_stamps}" == "1" ]] \
    || fail "lone paid #1 must keep one Call this #1 after-claim stamp (got ${one_call_stamps})"
  [[ "${one_call_two}" == "1" ]] \
    || fail "lone paid #1 must keep one Call this #1 after-claim-two stamp (got ${one_call_two})"
  [[ "${one_call_three}" == "1" ]] \
    || fail "lone paid #1 must keep one Call this #1 after-claim-three stamp (got ${one_call_three})"
  [[ "${one_call_four}" == "1" ]] \
    || fail "lone paid #1 must keep one Call this #1 after-claim-four stamp (got ${one_call_four})"
  [[ "${one_call_five}" == "1" ]] \
    || fail "lone paid #1 must keep one Call this #1 after-claim-five stamp (got ${one_call_five})"
  call_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("Call this #1"))' "${movers_paid}")"
  bid_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("$20"))' "${movers_paid}")"
  paid_call_one="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-one"))' "${movers_paid}")"
  paid_call_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-two"))' "${movers_paid}")"
  paid_call_three="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-three"))' "${movers_paid}")"
  paid_call_four="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-four"))' "${movers_paid}")"
  paid_call_five="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-five"))' "${movers_paid}")"
  [[ "${paid_call_one}" -ge 0 && "${paid_call_two}" -ge 0 && $((paid_call_two - paid_call_one)) -lt 80 && $((paid_call_one - paid_call_two)) -lt 80 ]] \
    || fail "lone paid #1 must keep call-after-claim-two on the same hop"
  [[ "${paid_call_two}" -ge 0 && "${paid_call_three}" -ge 0 && $((paid_call_three - paid_call_two)) -lt 80 && $((paid_call_two - paid_call_three)) -lt 80 ]] \
    || fail "lone paid #1 must keep call-after-claim-three on the same hop"
  [[ "${paid_call_three}" -ge 0 && "${paid_call_four}" -ge 0 && $((paid_call_four - paid_call_three)) -lt 80 && $((paid_call_three - paid_call_four)) -lt 80 ]] \
    || fail "lone paid #1 must keep call-after-claim-four on the same hop"
  [[ "${paid_call_four}" -ge 0 && "${paid_call_five}" -ge 0 && $((paid_call_five - paid_call_four)) -lt 80 && $((paid_call_four - paid_call_five)) -lt 80 ]] \
    || fail "lone paid #1 must keep call-after-claim-five on the same hop"
  [[ "${call_at}" -ge 0 && "${bid_at}" -gt "${call_at}" ]] \
    || fail "occupied movers ad must show Call this #1 before \$bid"
  grep -q 'data-category-tabs' "${movers_paid}" \
    || fail "paid movers lane must keep the classified column index"
  grep -q 'data-column-index-after=""' "${movers_paid}" \
    || fail "paid movers lane must keep column tabs after the listing"
  paid_tabs_order="$(python3 -c '
import sys
html = open(sys.argv[1]).read()
header = html.find("</header>")
print(html.find("Call this #1"), html.find("North London Movers"), html.find("data-category-tabs"), html.find("data-column-index-after"), header, sep=" ")
' "${movers_paid}")"
  read -r paid_call_pos paid_name_pos paid_tabs_pos paid_after_pos paid_header_pos <<< "${paid_tabs_order}"
  [[ "${paid_header_pos}" -ge 0 && "${paid_name_pos}" -gt "${paid_header_pos}" ]] \
    || fail "paid movers listing must sit after the edition masthead"
  [[ "${paid_call_pos}" -ge 0 && "${paid_tabs_pos}" -gt "${paid_call_pos}" ]] \
    || fail "paid movers column tabs must stay after Call this #1"
  [[ "${paid_after_pos}" -gt "${paid_name_pos}" ]] \
    || fail "paid movers column tabs must stay after the listing"
  paid_header_has_tabs="$(python3 -c '
import sys
html = open(sys.argv[1]).read()
header = html[:html.find("</header>")] if "</header>" in html else html
print("yes" if "data-category-tabs" in header or "data-column-index-after" in header else "no")
' "${movers_paid}")"
  [[ "${paid_header_has_tabs}" == "no" ]] \
    || fail "paid movers masthead must not hang the four-tab column index"
  if grep -q 'data-empty-lane="true"' "${movers_paid}"; then
    fail "paid lane must not stay empty"
  fi
  if grep -qE 'Call #[0-9]|data-call-later|data-later-call|data-call-ad="later"' "${movers_paid}"; then
    fail "lone paid #1 must not invent a later-rank call"
  fi
  grep -q 'data-claim-after-call' "${movers_paid}" \
    || fail "lone paid #1 must offer Outbid my column after Call this #1"
  grep -q 'data-claim-after-call-one' "${movers_paid}" \
    || fail "lone paid #1 must concentrate the claim hop after Call this #1"
  grep -q 'data-claim-after-call-two' "${movers_paid}" \
    || fail "lone paid #1 must concentrate the claim hop after Call this #1 is re-concentrated"
  grep -q 'data-claim-after-call-three' "${movers_paid}" \
    || fail "lone paid #1 must concentrate the claim hop after Call this #1 is re-concentrated again"
  grep -q 'data-claim-after-call-four' "${movers_paid}" \
    || fail "lone paid #1 must concentrate the claim hop after the louder Call this #1"
  grep -q 'data-claim-after-call-five' "${movers_paid}" \
    || fail "lone paid #1 must concentrate the claim hop after the louder Call this #1 is re-concentrated again"
  grep -q 'class="claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"' "${movers_paid}" \
    || fail "lone paid #1 must keep Outbid my column on one later-claim hop"
  grep -q 'class="later-claim claim-after-call-line"' "${movers_paid}" \
    || fail "lone paid #1 must keep Outbid my column in a later-claim group"
  grep -q 'data-later-claim=""' "${movers_paid}" \
    || fail "lone paid #1 must stamp later-claim grouping"
  grep -q 'class="claim later-claim"' "${movers_paid}" \
    || fail "lone paid #1 form must sit in a later-claim group"
  grep -q 'Then Claim #1' "${movers_paid}" \
    || fail "lone paid #1 form must name Claim a later write"
  grep -q 'Outbid my movers column' "${movers_paid}" \
    || fail "lone paid #1 hop must name Outbid my movers column"
  grep -q 'after Call this #1' "${movers_paid}" \
    || fail "lone paid #1 hop must sit after Call this #1"
  grep -q 'href="/c/london/movers#claim"' "${movers_paid}" \
    || fail "lone paid #1 hop must land on the lane claim form"
  if grep -qE 'data-later-write|Then the listing name|data-empty-claim-first|data-first-click="claim"' "${movers_paid}"; then
    fail "paid movers lane must not use the empty-paper listing-name later write"
  fi
  paid_form_business="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<form[^>]*data-bid-form=\"\"[\s\S]*?</form>", html)
chunk = m.group(0) if m else ""
print(chunk.find("name=\"business\""), chunk.find(">Outbid<"), sep=" ")
' "${movers_paid}")"
  read -r paid_business_at paid_outbid_in_form <<< "${paid_form_business}"
  [[ "${paid_business_at}" -ge 0 && "${paid_outbid_in_form}" -gt "${paid_business_at}" ]] \
    || fail "occupied movers form must keep the listing name with Outbid"
  paid_claim_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-one"))' "${movers_paid}")"
  paid_claim_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-two"))' "${movers_paid}")"
  paid_claim_three="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-three"))' "${movers_paid}")"
  paid_claim_four="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-four"))' "${movers_paid}")"
  paid_claim_five="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-five"))' "${movers_paid}")"
  paid_form_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-bid-form"))' "${movers_paid}")"
  [[ "${call_at}" -ge 0 && "${paid_claim_at}" -gt "${call_at}" ]] \
    || fail "lone paid #1 claim hop must follow Call this #1"
  [[ "${paid_claim_two}" -ge 0 && $((paid_claim_two - paid_claim_at)) -lt 80 && $((paid_claim_at - paid_claim_two)) -lt 80 ]] \
    || fail "lone paid #1 must keep claim-after-call-two on the same hop"
  [[ "${paid_claim_three}" -ge 0 && $((paid_claim_three - paid_claim_two)) -lt 80 && $((paid_claim_two - paid_claim_three)) -lt 80 ]] \
    || fail "lone paid #1 must keep claim-after-call-three on the same hop"
  [[ "${paid_claim_four}" -ge 0 && $((paid_claim_four - paid_claim_three)) -lt 80 && $((paid_claim_three - paid_claim_four)) -lt 80 ]] \
    || fail "lone paid #1 must keep claim-after-call-four on the same hop"
  [[ "${paid_claim_five}" -ge 0 && $((paid_claim_five - paid_claim_four)) -lt 80 && $((paid_claim_four - paid_claim_five)) -lt 80 ]] \
    || fail "lone paid #1 must keep claim-after-call-five on the same hop"
  [[ "${paid_form_at}" -lt 0 || "${paid_form_at}" -gt "${paid_claim_at}" ]] \
    || fail "lone paid #1 DNA form must stay after the claim hop"
  if grep -qE 'after Call #' "${movers_paid}"; then
    fail "lone paid #1 must not invent a later-rank claim-after-call hop"
  fi
  if grep -qE 'data-call-after-claim=""|after the claim hop' "${movers_paid}"; then
    fail "lone paid #1 must not invent a call-after-claim hop"
  fi

  occupied_home="$(mktemp)"
  occupied_home_code="$(curl -sS -o "${occupied_home}" -w '%{http_code}' "http://127.0.0.1:${port}/")"
  [[ "${occupied_home_code}" == "200" ]] || fail "GET / after pay expected 200 got ${occupied_home_code}"
  grep -q 'class="paper classified paper-occupied"' "${occupied_home}" \
    || fail "GET / after pay must wrap occupied paper"
  grep -q 'data-paper-occupied="true"' "${occupied_home}" \
    || fail "GET / after pay must stamp data-paper-occupied"
  if grep -q 'paper-empty' "${occupied_home}"; then
    fail "GET / after pay must not keep the empty-paper wrap"
  fi
  grep -q 'Call this #1' "${occupied_home}" || fail "GET / paid movers column must offer Call this #1"
  grep -q 'data-call-this-one' "${occupied_home}" || fail "GET / paid #1 must stamp data-call-this-one"
  grep -q 'data-first-click="call"' "${occupied_home}" \
    || fail "GET / paid #1 must stamp Call this #1 as the occupied first click"
  grep -q 'class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate Call this #1 on Outbid chrome"
  grep -q 'data-call-after-claim-one' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate Call this #1 after Outbid my column"
  grep -q 'data-call-after-claim-two' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate Call this #1 after Outbid my column is re-concentrated"
  grep -q 'data-call-after-claim-three' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate Call this #1 after Outbid my column is re-concentrated again"
  grep -q 'data-call-after-claim-four' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate Call this #1 after Outbid my column is re-concentrated again after claim-four"
  grep -q 'data-call-after-claim-five' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate Call this #1 after Outbid my column is re-concentrated again"
  grep -q 'North London Movers' "${occupied_home}" || fail "GET / must show the paid movers ad"
  grep -q 'data-prize' "${occupied_home}" || fail "GET / paid #1 must stamp the business prize"
  grep -q 'class="later-facts"' "${occupied_home}" \
    || fail "GET / paid #1 \$bid must sit in a later-facts group"
  grep -q 'data-later-fact=""' "${occupied_home}" \
    || fail "GET / paid #1 must stamp the later-facts group"
  if grep -q 'class="bid later-fact"' "${occupied_home}"; then
    fail "GET / paid #1 must not stamp class=bid later-fact on the same \$bid span"
  fi
  home_prize_order="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"1\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print(chunk.find("data-prize"), chunk.find("North London Movers"), chunk.find("class=\"later-facts\""), chunk.find("data-later-fact"), chunk.find("$20"), sep=" ")
' "${occupied_home}")"
  read -r home_prize_at home_name_at home_facts_at home_later_at home_bid_at <<< "${home_prize_order}"
  [[ "${home_prize_at}" -ge 0 && "${home_name_at}" -ge 0 && "${home_name_at}" -lt "${home_bid_at}" ]] \
    || fail "GET / paid #1 business name must read before \$bid"
  [[ "${home_facts_at}" -ge 0 && "${home_later_at}" -ge 0 && "${home_name_at}" -lt "${home_facts_at}" && "${home_facts_at}" -lt "${home_bid_at}" ]] \
    || fail "GET / paid #1 later-facts \$bid must sit after the listing name"
  empty_after_pay="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-empty-lane=\"true\""))' "${occupied_home}")"
  [[ "${empty_after_pay}" == "3" ]] || fail "GET / after one paid lane must keep three honest empty lanes (got ${empty_after_pay})"
  occupied_lanes_after_pay="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-lane-occupied=\"true\""))' "${occupied_home}")"
  [[ "${occupied_lanes_after_pay}" == "1" ]] \
    || fail "GET / after one paid lane must wrap one occupied column (got ${occupied_lanes_after_pay})"
  empty_lane_wraps_after_pay="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-lane-empty=\"true\""))' "${occupied_home}")"
  [[ "${empty_lane_wraps_after_pay}" == "3" ]] \
    || fail "GET / after one paid lane must wrap three empty columns (got ${empty_lane_wraps_after_pay})"
  grep -q 'class="lane classified-column lane-occupied"' "${occupied_home}" \
    || fail "GET / paid movers column must wrap as lane-occupied"
  grep -q 'class="lane classified-column lane-empty"' "${occupied_home}" \
    || fail "GET / mixed paper must wrap empty columns as lane-empty"
  empty_honest_after_pay="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-empty-honest=\"\""))' "${occupied_home}")"
  [[ "${empty_honest_after_pay}" == "3" ]] \
    || fail "GET / after one paid lane must keep three empty-honest stamps (got ${empty_honest_after_pay})"
  empty_honest_on_movers="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<section[^>]*data-category=\"movers\"[\s\S]*?</section>", html)
chunk = m.group(0) if m else ""
print("yes" if "data-empty-honest" in chunk or "No #1" in chunk else "no")
' "${occupied_home}")"
  [[ "${empty_honest_on_movers}" == "no" ]] \
    || fail "GET / paid movers column must keep Call this #1, not empty-honest No #1"
  home_call_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("Call this #1"))' "${occupied_home}")"
  home_claim_after="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-pick"))' "${occupied_home}")"
  [[ "${home_call_at}" -ge 0 && "${home_claim_after}" -gt "${home_call_at}" ]] \
    || fail "GET / paid column must show Call this #1 before the Outbid claim"
  if grep -qE 'Call #[0-9]|data-call-later|data-later-call|data-call-ad="later"' "${occupied_home}"; then
    fail "GET / with only paid #1 must not invent a later-rank call"
  fi
  grep -q 'data-claim-after-call' "${occupied_home}" \
    || fail "GET / paid movers column must offer claim after Call this #1"
  grep -q 'data-claim-after-call-one' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate the claim hop after Call this #1"
  grep -q 'data-claim-after-call-two' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate the claim hop after Call this #1 is re-concentrated"
  grep -q 'data-claim-after-call-three' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate the claim hop after Call this #1 is re-concentrated again"
  grep -q 'data-claim-after-call-four' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate the claim hop after the louder Call this #1"
  grep -q 'data-claim-after-call-five' "${occupied_home}" \
    || fail "GET / paid #1 must concentrate the claim hop after the louder Call this #1 is re-concentrated again"
  grep -q 'class="claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"' "${occupied_home}" \
    || fail "GET / paid #1 must keep Outbid my column on one later-claim hop"
  grep -q 'class="later-claim claim-after-call-line"' "${occupied_home}" \
    || fail "GET / paid #1 must keep Outbid my column in a later-claim group"
  grep -q 'data-later-claim=""' "${occupied_home}" \
    || fail "GET / paid #1 must stamp later-claim grouping"
  grep -q 'Then Claim #1' "${occupied_home}" \
    || fail "GET / occupied Claim must name itself a later write"
  grep -q 'data-rolling-week=""' "${occupied_home}" \
    || fail "GET / occupied paper must name the rolling week window"
  grep -q 'class="folio week-window"' "${occupied_home}" \
    || fail "GET / occupied paper must compose a week-window folio"
  grep -q 'Rolling last 7 days. Not Monday 00:00 Europe/London.' "${occupied_home}" \
    || fail "GET / occupied paper must say rolling last 7 days, not London Monday midnight"
  if grep -q '24h lock' "${occupied_home}"; then
    fail "GET / occupied paper must not become a 24h lock on #1"
  fi
  grep -q 'Outbid my movers column' "${occupied_home}" \
    || fail "GET / paid hop must name Outbid my movers column"
  grep -q 'data-category-tabs' "${occupied_home}" \
    || fail "GET / occupied paper must keep the classified column index"
  grep -q 'data-column-index-after=""' "${occupied_home}" \
    || fail "GET / occupied paper must keep column tabs after the listing"
  grep -q 'class="column-index column-index-after"' "${occupied_home}" \
    || fail "GET / occupied paper must keep the after-listing column index class"
  grep -q 'Pick one column' "${occupied_home}" \
    || fail "GET / occupied paper must keep the named column pick"
  home_tabs_order="$(python3 -c '
import sys
html = open(sys.argv[1]).read()
header = html.find("</header>")
print(html.find("Call this #1"), html.find("data-first-click=\"call\""), html.find("North London Movers"), html.find("data-category-tabs"), html.find("data-column-index-after"), html.find("data-claim-pick"), html.find("data-later-claim"), html.find("Then Claim #1"), header, sep=" ")
' "${occupied_home}")"
  read -r home_call_pos home_first_pos home_name_pos home_tabs_pos home_after_pos home_claim_pos home_later_claim_pos home_then_claim_pos home_header_pos <<< "${home_tabs_order}"
  [[ "${home_header_pos}" -ge 0 && "${home_name_pos}" -gt "${home_header_pos}" ]] \
    || fail "GET / occupied listing must sit after the edition masthead"
  [[ "${home_call_pos}" -ge 0 && "${home_tabs_pos}" -gt "${home_call_pos}" ]] \
    || fail "GET / occupied column tabs must stay after Call this #1"
  [[ "${home_first_pos}" -ge 0 && $((home_first_pos - home_call_pos)) -lt 400 && $((home_call_pos - home_first_pos)) -lt 400 ]] \
    || fail "GET / occupied first click must stay on Call this #1"
  [[ "${home_after_pos}" -gt "${home_name_pos}" && "${home_after_pos}" -gt "${home_call_pos}" ]] \
    || fail "GET / occupied column tabs must stay after the listing"
  [[ "${home_claim_pos}" -gt "${home_tabs_pos}" ]] \
    || fail "GET / occupied named column pick must stay after the listing tabs"
  [[ "${home_later_claim_pos}" -gt "${home_call_pos}" && "${home_then_claim_pos}" -gt "${home_tabs_pos}" ]] \
    || fail "GET / occupied Claim must stay a later write after Call this #1 and the listing tabs"
  home_header_has_tabs="$(python3 -c '
import sys
html = open(sys.argv[1]).read()
header = html[:html.find("</header>")] if "</header>" in html else html
print("yes" if "data-category-tabs" in header or "data-column-index-after" in header else "no")
' "${occupied_home}")"
  [[ "${home_header_has_tabs}" == "no" ]] \
    || fail "GET / occupied masthead must not hang the four-tab column index"
  if grep -qE 'claim-first-click|Then pick the column' "${occupied_home}"; then
    fail "GET / occupied paper must not use the empty-paper first-click chrome"
  fi
  if grep -qE 'data-later-write|Then the listing name|data-empty-claim-first|data-first-click="claim"' "${occupied_home}"; then
    fail "GET / occupied paper must not use the empty-paper listing-name later write"
  fi
  if grep -q 'class="bid later-fact"' "${occupied_home}"; then
    fail "GET / occupied paper must not stamp later-fact on the same \$bid span"
  fi
  home_later_group="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"1\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print("yes" if "class=\"later-facts\"" in chunk and "data-later-fact=\"\"" in chunk else "no")
' "${occupied_home}")"
  [[ "${home_later_group}" == "yes" ]] \
    || fail "GET / occupied paper must group \$bid as a later fact"
  grep -q 'after Call this #1' "${occupied_home}" \
    || fail "GET / paid hop must sit after Call this #1"
  home_claim_one="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-one"))' "${occupied_home}")"
  home_claim_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-two"))' "${occupied_home}")"
  home_claim_three="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-three"))' "${occupied_home}")"
  home_claim_four="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-four"))' "${occupied_home}")"
  home_claim_five="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-five"))' "${occupied_home}")"
  [[ "${home_call_at}" -ge 0 && "${home_claim_one}" -gt "${home_call_at}" ]] \
    || fail "GET / paid column must show Call this #1 before the claim hop"
  [[ "${home_claim_two}" -ge 0 && $((home_claim_two - home_claim_one)) -lt 80 && $((home_claim_one - home_claim_two)) -lt 80 ]] \
    || fail "GET / paid #1 must keep claim-after-call-two on the same hop"
  [[ "${home_claim_three}" -ge 0 && $((home_claim_three - home_claim_two)) -lt 80 && $((home_claim_two - home_claim_three)) -lt 80 ]] \
    || fail "GET / paid #1 must keep claim-after-call-three on the same hop"
  [[ "${home_claim_four}" -ge 0 && $((home_claim_four - home_claim_three)) -lt 80 && $((home_claim_three - home_claim_four)) -lt 80 ]] \
    || fail "GET / paid #1 must keep claim-after-call-four on the same hop"
  [[ "${home_claim_five}" -ge 0 && $((home_claim_five - home_claim_four)) -lt 80 && $((home_claim_four - home_claim_five)) -lt 80 ]] \
    || fail "GET / paid #1 must keep claim-after-call-five on the same hop"
  [[ "${home_claim_after}" -gt "${home_claim_one}" ]] \
    || fail "GET / named hub hops must stay after the occupied-lane claim hop"
  empty_claim_two="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}claim-after-call-two", html) else "no")
' "${occupied_home}")"
  [[ "${empty_claim_two}" == "no" ]] \
    || fail "GET / empty lanes must not pick up claim-after-call-two"
  empty_claim_three="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}claim-after-call-three", html) else "no")
' "${occupied_home}")"
  [[ "${empty_claim_three}" == "no" ]] \
    || fail "GET / empty lanes must not pick up claim-after-call-three"
  empty_claim_four="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}claim-after-call-four", html) else "no")
' "${occupied_home}")"
  [[ "${empty_claim_four}" == "no" ]] \
    || fail "GET / empty lanes must not pick up claim-after-call-four"
  empty_claim_five="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}claim-after-call-five", html) else "no")
' "${occupied_home}")"
  [[ "${empty_claim_five}" == "no" ]] \
    || fail "GET / empty lanes must not pick up claim-after-call-five"
  empty_prize="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}data-prize", html) else "no")
' "${occupied_home}")"
  [[ "${empty_prize}" == "no" ]] \
    || fail "GET / empty lanes must not invent a prize business name"
  empty_later_fact="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}(data-later-fact|later-facts|later-fact)", html) else "no")
' "${occupied_home}")"
  [[ "${empty_later_fact}" == "no" ]] \
    || fail "GET / empty lanes must not invent later-fact \$bid"
  empty_call_two="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}call-after-claim-two", html) else "no")
' "${occupied_home}")"
  [[ "${empty_call_two}" == "no" ]] \
    || fail "GET / empty lanes must not pick up call-after-claim-two"
  empty_call_three="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}call-after-claim-three", html) else "no")
' "${occupied_home}")"
  [[ "${empty_call_three}" == "no" ]] \
    || fail "GET / empty lanes must not pick up call-after-claim-three"
  empty_call_four="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}call-after-claim-four", html) else "no")
' "${occupied_home}")"
  [[ "${empty_call_four}" == "no" ]] \
    || fail "GET / empty lanes must not pick up call-after-claim-four"
  empty_call_five="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-lane=\"true\"[\s\S]{0,800}call-after-claim-five", html) else "no")
' "${occupied_home}")"
  [[ "${empty_call_five}" == "no" ]] \
    || fail "GET / empty lanes must not pick up call-after-claim-five"
  home_call_one="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-one"))' "${occupied_home}")"
  home_call_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-two"))' "${occupied_home}")"
  home_call_three="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-three"))' "${occupied_home}")"
  home_call_four="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-four"))' "${occupied_home}")"
  home_call_five="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-five"))' "${occupied_home}")"
  [[ "${home_call_one}" -ge 0 && "${home_call_two}" -ge 0 && $((home_call_two - home_call_one)) -lt 80 && $((home_call_one - home_call_two)) -lt 80 ]] \
    || fail "GET / paid #1 must keep call-after-claim-two on the same hop"
  [[ "${home_call_two}" -ge 0 && "${home_call_three}" -ge 0 && $((home_call_three - home_call_two)) -lt 80 && $((home_call_two - home_call_three)) -lt 80 ]] \
    || fail "GET / paid #1 must keep call-after-claim-three on the same hop"
  [[ "${home_call_three}" -ge 0 && "${home_call_four}" -ge 0 && $((home_call_four - home_call_three)) -lt 80 && $((home_call_three - home_call_four)) -lt 80 ]] \
    || fail "GET / paid #1 must keep call-after-claim-four on the same hop"
  [[ "${home_call_four}" -ge 0 && "${home_call_five}" -ge 0 && $((home_call_five - home_call_four)) -lt 80 && $((home_call_four - home_call_five)) -lt 80 ]] \
    || fail "GET / paid #1 must keep call-after-claim-five on the same hop"
  if grep -qE 'after Call #' "${occupied_home}"; then
    fail "GET / with only paid #1 must not invent a later-rank claim-after-call hop"
  fi
  if grep -qE 'data-call-after-claim=""|after the claim hop' "${occupied_home}"; then
    fail "GET / with only paid #1 must not invent a call-after-claim hop"
  fi
  if grep -qiE '★|⭐|top rated|review count|google map|map pin' "${occupied_home}"; then
    fail "GET / occupied must not invent stars or maps"
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
  grep -q 'class="lane classified-column lane-occupied"' "${movers_two}" \
    || fail "occupied movers with #2 must wrap as lane-occupied"
  grep -q 'data-lane-occupied="true"' "${movers_two}" \
    || fail "occupied movers with #2 must stamp data-lane-occupied"
  grep -q 'Call #2' "${movers_two}" || fail "rank 2 must offer Call #2"
  grep -q 'data-call-later' "${movers_two}" || fail "rank 2 must stamp data-call-later"
  grep -q 'data-later-call' "${movers_two}" || fail "rank 2 Call #N must sit in a later-call group"
  grep -q 'class="later-call"' "${movers_two}" || fail "rank 2 Call #N must use later-call grouping"
  grep -q 'data-call-ad="later"' "${movers_two}" || fail "rank 2 must stamp data-call-ad=later"
  if grep -q 'data-call-later-quiet' "${movers_two}"; then
    fail "rank 2 must not mute Call #N with data-call-later-quiet"
  fi
  later_call_count="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-later-call=\"\""))' "${movers_two}")"
  [[ "${later_call_count}" == "2" ]] \
    || fail "occupied movers must keep two later-call groups (got ${later_call_count})"
  later_lead_quiet="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"1\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print("yes" if "data-later-call" in chunk or "data-call-later" in chunk else "no")
' "${movers_two}")"
  [[ "${later_lead_quiet}" == "no" ]] \
    || fail "occupied Call this #1 must not pick up later-call grouping"
  later_has_lead="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"data-rank=\"2\"[\s\S]{0,900}South London Movers[\s\S]{0,900}</article>", html)
print("yes" if m and ("Call this #1" in m.group(0) or "data-call-this-one" in m.group(0)) else "no")
' "${movers_two}")"
  [[ "${later_has_lead}" == "no" ]] || fail "rank 2 must not invent Call this #1"
  later_call_at="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"2\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print(chunk.find("South London Movers"), chunk.find("class=\"later-call\""), chunk.find("Call #2"), chunk.find("$15"), sep=" ")
' "${movers_two}")"
  read -r later_name_pos later_group_pos later_call_pos later_bid_pos <<< "${later_call_at}"
  [[ "${later_name_pos}" -ge 0 && "${later_group_pos}" -gt "${later_name_pos}" ]] \
    || fail "rank 2 later-call group must sit after the business name"
  [[ "${later_call_pos}" -ge 0 && "${later_call_pos}" -gt "${later_group_pos}" && "${later_bid_pos}" -gt "${later_call_pos}" ]] \
    || fail "rank 2 must show Call #2 in the later-call group before \$bid"
  grep -q 'data-claim-after-call' "${movers_two}" \
    || fail "occupied movers lane must offer claim after Call this #1"
  grep -q 'data-claim-after-call-one' "${movers_two}" \
    || fail "occupied movers hop must concentrate after Call this #1"
  grep -q 'data-claim-after-call-two' "${movers_two}" \
    || fail "occupied movers hop must concentrate after Call this #1 is re-concentrated"
  grep -q 'data-claim-after-call-three' "${movers_two}" \
    || fail "occupied movers hop must concentrate after Call this #1 is re-concentrated again"
  grep -q 'data-claim-after-call-four' "${movers_two}" \
    || fail "occupied movers hop must concentrate after the louder Call this #1"
  grep -q 'data-claim-after-call-five' "${movers_two}" \
    || fail "occupied movers hop must concentrate after the louder Call this #1 is re-concentrated again"
  grep -q 'class="claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"' "${movers_two}" \
    || fail "occupied movers hop must keep Outbid my column on one later-claim hop"
  grep -q 'class="later-claim claim-after-call-line"' "${movers_two}" \
    || fail "occupied movers hop must sit in a later-claim group"
  grep -q 'data-later-claim=""' "${movers_two}" \
    || fail "occupied movers hop must stamp later-claim grouping"
  grep -q 'Outbid my movers column' "${movers_two}" \
    || fail "occupied movers hop must name Outbid my movers column"
  grep -q 'after Call this #1' "${movers_two}" \
    || fail "occupied movers hop must sit after Call this #1"
  grep -q 'href="/c/london/movers#claim"' "${movers_two}" \
    || fail "occupied movers hop must land on the lane claim form"
  later_claim_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call"))' "${movers_two}")"
  later_claim_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-two"))' "${movers_two}")"
  later_claim_three="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-three"))' "${movers_two}")"
  later_claim_four="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-four"))' "${movers_two}")"
  later_claim_five="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-five"))' "${movers_two}")"
  later_call_one="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("Call this #1"))' "${movers_two}")"
  later_call_page="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("Call #2"))' "${movers_two}")"
  later_form_at="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-bid-form"))' "${movers_two}")"
  [[ "${later_call_one}" -ge 0 && "${later_claim_at}" -gt "${later_call_one}" ]] \
    || fail "occupied movers claim hop must follow Call this #1"
  [[ "${later_call_page}" -ge 0 && "${later_claim_at}" -gt "${later_call_page}" ]] \
    || fail "occupied movers claim hop must follow Call #2"
  [[ "${later_claim_two}" -ge 0 && $((later_claim_two - later_claim_at)) -lt 80 && $((later_claim_at - later_claim_two)) -lt 80 ]] \
    || fail "occupied movers hop must keep claim-after-call-two on the same hop"
  [[ "${later_claim_three}" -ge 0 && $((later_claim_three - later_claim_two)) -lt 80 && $((later_claim_two - later_claim_three)) -lt 80 ]] \
    || fail "occupied movers hop must keep claim-after-call-three on the same hop"
  [[ "${later_claim_four}" -ge 0 && $((later_claim_four - later_claim_three)) -lt 80 && $((later_claim_three - later_claim_four)) -lt 80 ]] \
    || fail "occupied movers hop must keep claim-after-call-four on the same hop"
  [[ "${later_claim_five}" -ge 0 && $((later_claim_five - later_claim_four)) -lt 80 && $((later_claim_four - later_claim_five)) -lt 80 ]] \
    || fail "occupied movers hop must keep claim-after-call-five on the same hop"
  [[ "${later_form_at}" -lt 0 || "${later_form_at}" -gt "${later_claim_at}" ]] \
    || fail "occupied movers DNA form must stay after the claim hop"
  if grep -qE 'after Call #' "${movers_two}"; then
    fail "occupied movers hop must not keep a quieter after Call #N line"
  fi
  grep -q 'data-call-after-claim=""' "${movers_two}" \
    || fail "occupied movers lane must offer Call after the claim hop"
  grep -q 'after the claim hop' "${movers_two}" \
    || fail "occupied movers Call hop must sit after the claim hop"
  later_call_after="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim=\"\""))' "${movers_two}")"
  later_call_one_stamp="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-one"))' "${movers_two}")"
  later_call_two_stamp="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-two"))' "${movers_two}")"
  later_call_three_stamp="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-three"))' "${movers_two}")"
  later_call_four_stamp="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-four"))' "${movers_two}")"
  later_call_five_stamp="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-five"))' "${movers_two}")"
  [[ "${later_call_one_stamp}" -ge 0 && "${later_claim_at}" -gt "${later_call_one_stamp}" ]] \
    || fail "occupied movers Call this #1 stamp must sit before the claim hop"
  [[ "${later_call_two_stamp}" -ge 0 && $((later_call_two_stamp - later_call_one_stamp)) -lt 80 && $((later_call_one_stamp - later_call_two_stamp)) -lt 80 ]] \
    || fail "occupied movers must keep call-after-claim-two on the same hop"
  [[ "${later_call_three_stamp}" -ge 0 && $((later_call_three_stamp - later_call_two_stamp)) -lt 80 && $((later_call_two_stamp - later_call_three_stamp)) -lt 80 ]] \
    || fail "occupied movers must keep call-after-claim-three on the same hop"
  [[ "${later_call_four_stamp}" -ge 0 && $((later_call_four_stamp - later_call_three_stamp)) -lt 80 && $((later_call_three_stamp - later_call_four_stamp)) -lt 80 ]] \
    || fail "occupied movers must keep call-after-claim-four on the same hop"
  [[ "${later_call_five_stamp}" -ge 0 && $((later_call_five_stamp - later_call_four_stamp)) -lt 80 && $((later_call_four_stamp - later_call_five_stamp)) -lt 80 ]] \
    || fail "occupied movers must keep call-after-claim-five on the same hop"
  [[ "${later_call_after}" -gt "${later_claim_at}" ]] \
    || fail "occupied movers Call hop must follow the claim hop"
  [[ "${later_form_at}" -lt 0 || "${later_form_at}" -gt "${later_call_after}" ]] \
    || fail "occupied movers DNA form must stay after the call-after-claim hop"
  later_call_href="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"data-call-after-claim=\"\"[^>]*href=\"(/go/[^\"]+)\"|href=\"(/go/[^\"]+)\"[^>]*data-call-after-claim=\"\"", html)
print((m.group(1) or m.group(2)) if m else "")
' "${movers_two}")"
  [[ "${later_call_href}" == /go/* ]] \
    || fail "occupied movers call-after-claim hop must go through /go/:id got ${later_call_href}"
  later_rank_stamp="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"2\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print("yes" if "data-call-after-claim-one" in chunk or "data-call-after-claim-two" in chunk or "data-call-after-claim-three" in chunk or "data-call-after-claim-four" in chunk or "data-call-after-claim-five" in chunk or "data-claim-after-call-two" in chunk or "data-claim-after-call-three" in chunk or "data-claim-after-call-four" in chunk or "data-claim-after-call-five" in chunk else "no")
' "${movers_two}")"
  [[ "${later_rank_stamp}" == "no" ]] \
    || fail "rank 2 must not pick up the Call this #1 after-claim stamp"
  later_prize="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"2\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print("yes" if "data-prize" in chunk else "no")
' "${movers_two}")"
  [[ "${later_prize}" == "no" ]] \
    || fail "rank 2 must stay quieter than the #1 prize"
  later_fact_on_two="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"2\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print("yes" if "data-later-fact" in chunk or "later-facts" in chunk or "later-fact" in chunk else "no")
' "${movers_two}")"
  [[ "${later_fact_on_two}" == "no" ]] \
    || fail "rank 2 must not stamp later-fact \$bid"

  occupied_later_home="$(mktemp)"
  occupied_later_home_code="$(curl -sS -o "${occupied_later_home}" -w '%{http_code}' "http://127.0.0.1:${port}/")"
  [[ "${occupied_later_home_code}" == "200" ]] \
    || fail "GET / after two movers expected 200 got ${occupied_later_home_code}"
  grep -q 'Call this #1' "${occupied_later_home}" || fail "GET / must keep Call this #1 on #1"
  grep -q 'class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"' "${occupied_later_home}" \
    || fail "GET / later-rank movers must keep Call this #1 on Outbid chrome"
  grep -q 'data-call-after-claim-one' "${occupied_later_home}" \
    || fail "GET / later-rank movers must concentrate Call this #1 after Outbid my column"
  grep -q 'data-call-after-claim-two' "${occupied_later_home}" \
    || fail "GET / later-rank movers must concentrate Call this #1 after Outbid my column is re-concentrated"
  grep -q 'data-call-after-claim-three' "${occupied_later_home}" \
    || fail "GET / later-rank movers must concentrate Call this #1 after Outbid my column is re-concentrated again"
  grep -q 'data-call-after-claim-four' "${occupied_later_home}" \
    || fail "GET / later-rank movers must concentrate Call this #1 after Outbid my column is re-concentrated again after claim-four"
  grep -q 'data-call-after-claim-five' "${occupied_later_home}" \
    || fail "GET / later-rank movers must concentrate Call this #1 after Outbid my column is re-concentrated again"
  later_one_call_count="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"1\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print(chunk.count("data-call-this-one"), chunk.count("data-call-after-claim-one"), chunk.count("data-call-after-claim-two"), chunk.count("data-call-after-claim-three"), chunk.count("data-call-after-claim-four"), chunk.count("data-call-after-claim-five"), sep=" ")
' "${occupied_later_home}")"
  read -r later_one_hops later_one_stamps later_one_two later_one_three later_one_four later_one_five <<< "${later_one_call_count}"
  [[ "${later_one_hops}" == "1" ]] \
    || fail "GET / later-rank movers must not stack another Call this #1 (got ${later_one_hops})"
  [[ "${later_one_stamps}" == "1" ]] \
    || fail "GET / later-rank movers must keep one Call this #1 after-claim stamp (got ${later_one_stamps})"
  [[ "${later_one_two}" == "1" ]] \
    || fail "GET / later-rank movers must keep one Call this #1 after-claim-two stamp (got ${later_one_two})"
  [[ "${later_one_three}" == "1" ]] \
    || fail "GET / later-rank movers must keep one Call this #1 after-claim-three stamp (got ${later_one_three})"
  [[ "${later_one_four}" == "1" ]] \
    || fail "GET / later-rank movers must keep one Call this #1 after-claim-four stamp (got ${later_one_four})"
  [[ "${later_one_five}" == "1" ]] \
    || fail "GET / later-rank movers must keep one Call this #1 after-claim-five stamp (got ${later_one_five})"
  later_rank_has_one="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"2\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print("yes" if "Call this #1" in chunk or "data-call-this-one" in chunk or "data-call-after-claim-one" in chunk or "data-call-after-claim-two" in chunk or "data-call-after-claim-three" in chunk or "data-call-after-claim-four" in chunk or "data-call-after-claim-five" in chunk else "no")
' "${occupied_later_home}")"
  [[ "${later_rank_has_one}" == "no" ]] \
    || fail "GET / rank 2 must not invent Call this #1"
  grep -q 'Call #2' "${occupied_later_home}" || fail "GET / paid movers column must offer Call #2"
  grep -q 'data-call-later' "${occupied_later_home}" || fail "GET / rank 2 must stamp data-call-later"
  grep -q 'data-later-call' "${occupied_later_home}" \
    || fail "GET / later Call #N must sit in a later-call group"
  grep -q 'class="later-call"' "${occupied_later_home}" \
    || fail "GET / later Call #N must use later-call grouping"
  if grep -q 'data-call-later-quiet' "${occupied_later_home}"; then
    fail "GET / later Call #N must not mute the same hop"
  fi
  home_later_quiet="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-later-call=\"\""))' "${occupied_later_home}")"
  [[ "${home_later_quiet}" == "2" ]] \
    || fail "GET / later-rank movers must keep two later-call groups (got ${home_later_quiet})"
  home_lead_quiet="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<article[^>]*data-rank=\"1\"[\s\S]*?</article>", html)
chunk = m.group(0) if m else ""
print("yes" if "data-later-call" in chunk or "data-call-later" in chunk else "no")
' "${occupied_later_home}")"
  [[ "${home_lead_quiet}" == "no" ]] \
    || fail "GET / Call this #1 must not pick up later-call grouping"
  home_empty_quiet="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
print("yes" if re.search(r"data-empty-honest=\"\"[\s\S]{0,800}data-later-call", html) else "no")
' "${occupied_later_home}")"
  [[ "${home_empty_quiet}" == "no" ]] \
    || fail "GET / empty lanes must not pick up later-call grouping"
  grep -q 'data-claim-after-call' "${occupied_later_home}" \
    || fail "GET / later-rank movers column must offer claim after Call this #1"
  grep -q 'data-claim-after-call-one' "${occupied_later_home}" \
    || fail "GET / later-rank movers hop must concentrate after Call this #1"
  grep -q 'data-claim-after-call-two' "${occupied_later_home}" \
    || fail "GET / later-rank movers hop must concentrate after Call this #1 is re-concentrated"
  grep -q 'data-claim-after-call-three' "${occupied_later_home}" \
    || fail "GET / later-rank movers hop must concentrate after Call this #1 is re-concentrated again"
  grep -q 'data-claim-after-call-four' "${occupied_later_home}" \
    || fail "GET / later-rank movers hop must concentrate after the louder Call this #1"
  grep -q 'data-claim-after-call-five' "${occupied_later_home}" \
    || fail "GET / later-rank movers hop must concentrate after the louder Call this #1 is re-concentrated again"
  grep -q 'class="claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"' "${occupied_later_home}" \
    || fail "GET / later-rank movers must keep Outbid my column on one later-claim hop"
  grep -q 'class="later-claim claim-after-call-line"' "${occupied_later_home}" \
    || fail "GET / later-rank movers must keep Outbid my column in a later-claim group"
  grep -q 'data-later-claim=""' "${occupied_later_home}" \
    || fail "GET / later-rank movers must stamp later-claim grouping"
  grep -q 'Then Claim #1' "${occupied_later_home}" \
    || fail "GET / later-rank occupied Claim must name itself a later write"
  grep -q 'after Call this #1' "${occupied_later_home}" \
    || fail "GET / later-rank movers hop must sit after Call this #1"
  if grep -qE 'after Call #' "${occupied_later_home}"; then
    fail "GET / later-rank movers hop must not keep a quieter after Call #N line"
  fi
  empty_after_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-empty-lane=\"true\""))' "${occupied_later_home}")"
  [[ "${empty_after_two}" == "3" ]] || fail "GET / after two movers must keep three honest empty lanes (got ${empty_after_two})"
  occupied_lanes_after_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-lane-occupied=\"true\""))' "${occupied_later_home}")"
  [[ "${occupied_lanes_after_two}" == "1" ]] \
    || fail "GET / after two movers must wrap one occupied column (got ${occupied_lanes_after_two})"
  empty_lane_wraps_after_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-lane-empty=\"true\""))' "${occupied_later_home}")"
  [[ "${empty_lane_wraps_after_two}" == "3" ]] \
    || fail "GET / after two movers must wrap three empty columns (got ${empty_lane_wraps_after_two})"
  mixed_empty_later="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
chunks = re.findall(r"<section class=\"lane classified-column lane-empty\"[\s\S]*?</section>", html)
print(len(chunks), end=" ")
print("yes" if any("later-call" in chunk or "data-later-call" in chunk or "Call #" in chunk or "Call this #1" in chunk for chunk in chunks) else "no")
' "${occupied_later_home}")"
  read -r mixed_empty_count mixed_empty_call <<< "${mixed_empty_later}"
  [[ "${mixed_empty_count}" == "3" ]] \
    || fail "GET / mixed paper must keep three lane-empty wraps (got ${mixed_empty_count})"
  [[ "${mixed_empty_call}" == "no" ]] \
    || fail "GET / empty mixed-paper columns must not pick up later Call"
  empty_honest_after_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().count("data-empty-honest=\"\""))' "${occupied_later_home}")"
  [[ "${empty_honest_after_two}" == "3" ]] \
    || fail "GET / after two movers must keep three empty-honest stamps (got ${empty_honest_after_two})"
  empty_honest_on_later_movers="$(python3 -c '
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r"<section[^>]*data-category=\"movers\"[\s\S]*?</section>", html)
chunk = m.group(0) if m else ""
print("yes" if "data-empty-honest" in chunk or "No #1" in chunk else "no")
' "${occupied_later_home}")"
  [[ "${empty_honest_on_later_movers}" == "no" ]] \
    || fail "GET / occupied movers must keep Call this #1 / Call #N, not empty-honest No #1"
  home_later_call="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("Call #2"))' "${occupied_later_home}")"
  home_later_claim="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call"))' "${occupied_later_home}")"
  home_later_claim_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-two"))' "${occupied_later_home}")"
  home_later_claim_three="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-three"))' "${occupied_later_home}")"
  home_later_claim_four="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-four"))' "${occupied_later_home}")"
  home_later_claim_five="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-after-call-five"))' "${occupied_later_home}")"
  home_later_pick="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-claim-pick"))' "${occupied_later_home}")"
  home_later_call_one="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("Call this #1"))' "${occupied_later_home}")"
  [[ "${home_later_call_one}" -ge 0 && "${home_later_claim}" -gt "${home_later_call_one}" ]] \
    || fail "GET / claim-after-call hop must follow Call this #1"
  [[ "${home_later_call}" -ge 0 && "${home_later_claim}" -gt "${home_later_call}" ]] \
    || fail "GET / claim-after-call hop must follow Call #2"
  [[ "${home_later_claim_two}" -ge 0 && $((home_later_claim_two - home_later_claim)) -lt 80 && $((home_later_claim - home_later_claim_two)) -lt 80 ]] \
    || fail "GET / later-rank movers must keep claim-after-call-two on the same hop"
  [[ "${home_later_claim_three}" -ge 0 && $((home_later_claim_three - home_later_claim_two)) -lt 80 && $((home_later_claim_two - home_later_claim_three)) -lt 80 ]] \
    || fail "GET / later-rank movers must keep claim-after-call-three on the same hop"
  [[ "${home_later_claim_four}" -ge 0 && $((home_later_claim_four - home_later_claim_three)) -lt 80 && $((home_later_claim_three - home_later_claim_four)) -lt 80 ]] \
    || fail "GET / later-rank movers must keep claim-after-call-four on the same hop"
  [[ "${home_later_claim_five}" -ge 0 && $((home_later_claim_five - home_later_claim_four)) -lt 80 && $((home_later_claim_four - home_later_claim_five)) -lt 80 ]] \
    || fail "GET / later-rank movers must keep claim-after-call-five on the same hop"
  [[ "${home_later_pick}" -gt "${home_later_claim}" ]] \
    || fail "GET / named hub hops must stay after the occupied-lane claim hop"
  grep -q 'data-call-after-claim=""' "${occupied_later_home}" \
    || fail "GET / later-rank movers column must offer Call after the claim hop"
  grep -q 'after the claim hop' "${occupied_later_home}" \
    || fail "GET / later-rank movers Call hop must sit after the claim hop"
  home_later_call_after="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim=\"\""))' "${occupied_later_home}")"
  home_later_call_stamp="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-one"))' "${occupied_later_home}")"
  home_later_call_two="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-two"))' "${occupied_later_home}")"
  home_later_call_three="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-three"))' "${occupied_later_home}")"
  home_later_call_four="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-four"))' "${occupied_later_home}")"
  home_later_call_five="$(python3 -c 'import sys; print(open(sys.argv[1]).read().find("data-call-after-claim-five"))' "${occupied_later_home}")"
  [[ "${home_later_call_stamp}" -ge 0 && "${home_later_claim}" -gt "${home_later_call_stamp}" ]] \
    || fail "GET / Call this #1 stamp must sit before the claim hop"
  [[ "${home_later_call_two}" -ge 0 && $((home_later_call_two - home_later_call_stamp)) -lt 80 && $((home_later_call_stamp - home_later_call_two)) -lt 80 ]] \
    || fail "GET / later-rank movers must keep call-after-claim-two on the same hop"
  [[ "${home_later_call_three}" -ge 0 && $((home_later_call_three - home_later_call_two)) -lt 80 && $((home_later_call_two - home_later_call_three)) -lt 80 ]] \
    || fail "GET / later-rank movers must keep call-after-claim-three on the same hop"
  [[ "${home_later_call_four}" -ge 0 && $((home_later_call_four - home_later_call_three)) -lt 80 && $((home_later_call_three - home_later_call_four)) -lt 80 ]] \
    || fail "GET / later-rank movers must keep call-after-claim-four on the same hop"
  [[ "${home_later_call_five}" -ge 0 && $((home_later_call_five - home_later_call_four)) -lt 80 && $((home_later_call_four - home_later_call_five)) -lt 80 ]] \
    || fail "GET / later-rank movers must keep call-after-claim-five on the same hop"
  [[ "${home_later_call_after}" -gt "${home_later_claim}" ]] \
    || fail "GET / call-after-claim hop must follow the claim hop"
  [[ "${home_later_pick}" -gt "${home_later_call_after}" ]] \
    || fail "GET / named hub hops must stay after the call-after-claim hop"
  if grep -qiE '★|⭐|top rated|review count|google map|map pin' "${occupied_later_home}"; then
    fail "GET / later-rank occupied must not invent stars or maps"
  fi

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
  grep -q 'Call #3' "${movers_rival}" || fail "rival \$5 at later rank must offer Call #3"
  grep -q 'data-call-later' "${movers_rival}" || fail "rival later rank must stamp data-call-later"
  grep -q 'data-later-call' "${movers_rival}" \
    || fail "rival later Call #N must sit in a later-call group"
  if grep -q 'data-call-later-quiet' "${movers_rival}"; then
    fail "rival later Call #N must not mute the same hop"
  fi

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
  grep -q 'Rolling last 7 days' "${rules_body}" || fail "GET /rules must state rolling last 7 days"
  grep -q 'Not Monday 00:00 Europe/London' "${rules_body}" \
    || fail "GET /rules must say the window is not London Monday midnight"

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
  if grep -qiE 'Chat Van|Adult Clinic|Short Van|t\.me/|onlyfans|bit\.ly' "${movers_hygiene}"; then
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
    db.prepare(
      `INSERT INTO listings (
         id, business, category, city, site_url, license_id, bid_usd, week_id,
         created_at, raised_at, clicks, hidden, hidden_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "lst_still_live",
      "Still Live Van",
      "movers",
      "london",
      "https://still-live.example",
      null,
      15,
      last,
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
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
  current_one="$(python3 -c 'import re,sys; html=open(sys.argv[1]).read(); m=re.search(r"data-rank=\"1\"[\s\S]{0,400}<h3 class=\"business\"(?: data-prize=\"\")?>([^<]+)", html); print(m.group(1) if m else "")' "${movers_week}")"
  [[ "${current_one}" != "Last Week Van" ]] || fail "last week occupant must not be this week #1"
  grep -q 'North London Movers' "${movers_week}" || fail "current-week occupant must remain listed"
  grep -q 'Still Live Van' "${movers_week}" \
    || fail "a last-week label still inside 7 days must stay on the rolling board"
  still_live_rank="$(python3 -c 'import re,sys; html=open(sys.argv[1]).read(); m=re.search(r"data-rank=\"(\d)\"[\s\S]{0,400}Still Live Van", html); print(m.group(1) if m else "")' "${movers_week}")"
  [[ "${still_live_rank}" == "2" ]] \
    || fail "rolling last-7-days occupant with a last-week label must still list (rank=${still_live_rank})"
  grep -q 'data-rolling-week=""' "${movers_week}" \
    || fail "occupied lane must name the rolling week window"
  grep -q 'Rolling last 7 days. Not Monday 00:00 Europe/London.' "${movers_week}" \
    || fail "occupied lane must say rolling last 7 days, not London Monday midnight"

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
    "${paid_body}" "${movers_paid}" "${occupied_home}" "${low_body}" "${frac_body}" \
    "${return_unknown}" "${form_headers}" "${form_body}" "${return_paid}" \
    "${movers_two}" "${occupied_later_home}" "${raise_body}" "${movers_raised}" "${rival_body}" \
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
