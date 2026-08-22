# Local Service Weekly — Detailed Specification and Build Plan

**Contract:** [SPEC.md](./SPEC.md)  
**Git:** [CONTRIBUTING.md](./CONTRIBUTING.md)

Pay-to-rank clone of outbid.lol for **city × category** local services. Rank is the bid. No invented ratings. v1 city lane is London; ranker is multi-city.

---

## 1. Stack

| Layer | Choice |
|---|---|
| App | Node 22, TypeScript strict, Next.js App Router |
| DB | SQLite (`better-sqlite3`) — listings, weeks, clicks, takedowns. City is a column, not a fork |
| Payments | `PolarPort`. Fixture adapter in tests. Live Polar when `POLAR_LIVE=1` + secrets. `POLAR_FIXTURE_ONLY=1` always wins |
| Rank | Pure function `rankLane(listings) → ordered[]` — bid desc, older `createdAt` wins ties |
| Week | `weekId(now, "Europe/London")` — Monday 00:00 London |
| URLs | `canonicalizeSiteUrl` strips tracking, rejects chat/NSFW/shorteners |
| Tests | `node:test` + fixture Polar. Offline. No polar.sh in `scripts/test.sh` |
| Host | One box / Vercel-shaped Node later. Not in this docs unit |

No auth in v1. Payment creates the listing.

---

## 2. Target tree (later PRs)

```
app/
  page.tsx                 # GET /  London default
  c/[city]/page.tsx
  c/[city]/[category]/page.tsx
  about/page.tsx
  rules/page.tsx
  return/page.tsx
  go/[id]/route.ts         # click + 302
  healthz/route.ts
  api/checkout/route.ts
  api/raise/route.ts
src/
  rank.ts
  week.ts
  urls.ts
  listings.ts
  clicks.ts
  takedown.ts
  cities.ts                # london shipped; more rows without rank edits
  polar/port.ts
  polar/fake.ts
  polar/live.ts
  db.ts
tests/
  rank.test.ts
  week.test.ts
  urls.test.ts
  checkout.test.ts
  raise.test.ts
  clicks.test.ts
  takedown.test.ts
  board.test.ts
scripts/test.sh
scripts/live-smoke.sh      # PR 9 only; never from test.sh / CI
```

This docs unit does **not** create that tree.

---

## 3. Modules

| Module | Rule |
|---|---|
| `rank.ts` | Input: listings in one `(city, category, weekId)`. Output: sorted visible rows. No IO. |
| `week.ts` | Open week in `Europe/London`. Closed week rejects writes (`week_closed`). |
| `urls.ts` | Strip `utm_*` / gclid / fbclid / ref / affiliate. Reject chat, NSFW, unresolved shorteners. |
| `listings.ts` | Identity = canonical URL + category + city + weekId. Dentist / immigration lawyer require `licenseId`. |
| `PolarPort` | `createCheckout({ amountUsd, listing })`, `settle(id)`. Fake settles in-process. Live talks to Polar only if live-enabled. |
| `clicks.ts` | Increment then redirect. Never invent a starting count. |
| `takedown.ts` | Hide + reason. Vacate rank. No auto-refund. No invented replacement #1. |
| `cities.ts` | Catalog. v1 public list is `["london"]`. Rank code takes `city` as a string key. |

UI copy: “Rank is the bid.” Never render stars, `★`, or review counts.

---

## 4. Tests (offline)

| Test | Assert |
|---|---|
| rank money | $20 above $15 in London / movers |
| older wins ties | two $20; earlier `createdAt` is #1 |
| raise = difference | $20 → $25 charges $5; `createdAt` unchanged |
| cannot steal with difference | rival $5 while #1 is $20 does not take #1 |
| strip tracking | `?utm_source=x` gone on store + click |
| no chat / NSFW | telegram / adult host → `400` |
| license required | dentist without `licenseId` → `license_required` |
| takedown | hidden #1 gone; next bid is #1; no invented row |
| week rollover | Monday 00:00 London opens a new empty week |
| multi-city key | same URL in `london` vs future city are different lanes |
| no invented ratings | board HTML has no star / review-count affordance |
| Polar fixture | checkout without network; `POLAR_FIXTURE_ONLY=1` wins |
| live Polar gate | unset / `0` stay fixture; CI must not set `POLAR_LIVE=1` |

---

## 5. PR plan

Each heading is one fleet unit. Do not start the next PR in the same change.

### PR 1: Skeleton + schema + healthz
- **Files:** `package.json`, SQLite migration (listings, cities, weeks), `app/healthz`, `src/db.ts`, `src/cities.ts` (London row)
- **Dependencies:** None
- **Acceptance:** `GET /healthz` 200. `scripts/test.sh` extended, still offline.

### PR 2: Board UI for city × category
- **Files:** `app/page.tsx`, `app/c/[city]/…`, rank display cards (`$bid`, public clicks placeholder `0`), Outbid form chrome
- **Dependencies:** PR 1
- **Acceptance:** London default. Unknown city `404 city_unknown`. No stars. Empty lane is empty.

### PR 3: Polar checkout + fixture adapter
- **Files:** `src/polar/port.ts`, `src/polar/fake.ts`, `app/api/checkout`, `app/return`, `tests/checkout.test.ts`
- **Dependencies:** PR 2
- **Acceptance:** Fixture `paid` places the listing at the bid’s rank. Min $5. Whole USD. SPEC errors `bid_too_low` / `bid_not_integer`.

### PR 4: Raise-bid difference
- **Files:** `app/api/raise`, `src/listings.ts` raise path, `tests/raise.test.ts`
- **Dependencies:** PR 3
- **Acceptance:** Pay difference only. Older stamp kept. Rival cannot take rank by paying only that difference.

### PR 5: About, rules, and URL hygiene
- **Files:** `app/about`, `app/rules`, `src/urls.ts`, `tests/urls.test.ts`
- **Dependencies:** PR 4
- **Acceptance:** About + rules 200. Tracking stripped. Chat / NSFW / shortener rejected.

### PR 6: Weekly window + London v1 lane
- **Files:** `src/week.ts`, `tests/week.test.ts`, board filter by `weekId`
- **Dependencies:** PR 5
- **Acceptance:** Monday 00:00 Europe/London rollover. Last week is not current #1. Ranker still keyed by city (London shipped).

### PR 7: License and complaint takedown
- **Files:** `src/takedown.ts`, license guard on dentists / immigration lawyers, operator hide path, `tests/takedown.test.ts`
- **Dependencies:** PR 6
- **Acceptance:** `license_required`. Takedown hides listing and vacates rank. No invented replacement. No invented license verification.

### PR 8: Public click counts
- **Files:** `app/go/[id]/route.ts`, `src/clicks.ts`, `tests/clicks.test.ts`
- **Dependencies:** PR 7
- **Acceptance:** Click increments public count and 302s to cleaned URL with no tracking query.

### PR 9: Live Polar gate + live-smoke
- **Files:** `src/polar/live.ts`, `scripts/live-smoke.sh`, `docs/live-smoke.md`, `tests/live-smoke.test.ts` (offline gate only)
- **Dependencies:** PR 8
- **Acceptance:** `POLAR_LIVE=1` + secrets selects Polar. `POLAR_FIXTURE_ONLY=1` wins. `scripts/live-smoke.sh` is executable and is **not** called from `scripts/test.sh` or `.github/workflows/ci.yml`. Missing secret → `BLOCKED-SECRET` naming the env var. Empty London board is honest (no invented provider). CI never sets `POLAR_LIVE`.

---

## 6. Live-smoke (operator)

Local process, live flag on if secrets exist, otherwise fixture path documented as `BLOCKED-SECRET` for Polar.

Walk SPEC §14: healthz, London board, about/rules, checkout, raise, click, takedown.  
Record each flow `PASS` / `PASS-ERROR` / `BLOCKED-SECRET` / `FAIL` in `docs/live-smoke.md`.  
`FAIL` (crash, wrong shape, invented rating or listing) blocks merge of PR 9.

---

## 7. Out of scope until after launch

- More cities as a marketing push (the **column** is already there)
- License registry API
- Refunds via Polar portal (manual)
- Accounts, comments, chat
- Non-USD
