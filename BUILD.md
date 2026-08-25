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
| Week | `weekId` is Monday 00:00 Europe/London Polar/audit label. Occupied rank is rolling last 7 days from paid `createdAt`. Not London Monday midnight. Not a 24h lock on #1 |
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
| `week.ts` | `weekId` label in `Europe/London`. Occupied rank is rolling last 7 days from paid `createdAt`. Closed `weekId` rejects writes (`week_closed`). |
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
| week rollover | Monday 00:00 London rolls the `weekId` label; occupied rank is rolling last 7 days; a Sunday pay stays ranked across Monday midnight |
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
- **Acceptance:** Monday 00:00 Europe/London rolls the `weekId` label. Occupied rank is rolling last 7 days. Last week aged out of the window is not current #1. Ranker still keyed by city (London shipped).

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

### PR 40: first-time neighbor — empty paper stays Claim #1
- **Files:** `src/ui/edition.tsx`, `src/ui/city-hub.tsx`, `app/c/[city]/[category]/page.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`
- **Dependencies:** PR 39
- **Acceptance:** Empty London `/` wraps `paper-empty` (`data-paper-empty`). Occupied paper wraps `paper-occupied`. Occupied later-facts / Call this #1 CSS is scoped to `.paper-occupied`. Empty hide rules cover `.paper-empty` so that chrome cannot paint a week with no paid listing. Empty stays Claim #1. Occupied #1 name still reads before `$bid`. Call this #1 stays the first occupied click. Column tabs stay after the listing. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

### PR 41: first-time neighbor — empty paper has one first click
- **Files:** `src/ui/outbid-form.tsx`, `src/ui/lane-board.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`, `BUILD.md`
- **Dependencies:** PR 40
- **Acceptance:** Empty London `/c/:city/:category` keeps Claim #1 / Outbid as the first click. The listing name (`name="business"`) is a later write after that hop (`data-later-write`, “Then the listing name”), not same-weight fields fighting Outbid. Occupied lane keeps identity fields with Outbid. Empty `/` stays Claim #1 then a quieter column pick. Occupied Call this #1 stays the first occupied click. Column tabs stay after the listing. Empty lanes stay No #1 / no stars / no map. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Do not re-ship empty/occupied wraps. Stamp-only = REJECT.

### PR 42: first-time neighbor — occupied later Call stays quieter than Call this #1
- **Files:** `src/ui/listing-card.tsx`, `src/ui/lane-board.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`
- **Dependencies:** PR 41
- **Acceptance:** Occupied London `/` with #2+ groups later Call as a `later-call` block after identity (`data-later-call`), not a mute stamp on the same hop. Occupied #1 business name is the prize. Call this #1 stays the first occupied click. Later Call stays quieter via order / grouping / card anatomy. Empty stays Claim #1, then a quieter column pick. Column tabs stay after the listing. Rank stays the bid. Do not add another named hop. Do not stamp `call-after-claim-N`. Do not recolor. Do not rebuild the classified paper. Do not re-ship empty/occupied wraps or empty later-write. Stamp-only mute / `data-call-later-quiet` on the same node = REJECT.

### PR 43: first-time neighbor — occupied mixed paper keeps empty lanes honest
- **Files:** `src/ui/lane-board.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`, `BUILD.md`
- **Dependencies:** PR 42
- **Acceptance:** Occupied London `/` with one paid movers lane + three empty lanes wraps paid columns `lane-occupied` (`data-lane-occupied`) and empty columns `lane-empty` (`data-lane-empty`). Later-call CSS is scoped to `.lane-occupied` so later Call cannot leak onto No #1. Occupied #1 name stays the prize. Call this #1 stays the first occupied click. Later Call stays after identity. Empty lanes stay No #1 / no stars / no map / no Call hop. Column tabs stay after the listing. Rank stays the bid. Do not add another named hop. Do not stamp `call-after-claim-N`. Do not recolor. Do not rebuild the classified paper. Do not re-ship later-call grouping or empty later-write. Stamp-only = REJECT.

### PR 44: first-time neighbor — unpaid stays off the classified paper
- **Files:** `src/board.ts`, `src/ui/listing-card.tsx`, `src/ui/lane-board.tsx`, `src/ui/city-hub.tsx`, `src/ui/outbid-form.tsx`, `src/ui/claim-column.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`, `BUILD.md`
- **Dependencies:** PR 43
- **Acceptance:** Unpaid or abandoned listing stays off the board. Empty leftover London `/` stays No #1 / no stars / no map / no Call this #1. Occupied #1 name stays the prize only after Polar reports paid. Call this #1 stays the first occupied click. Rank stays the bid. Column tabs stay after the listing. Empty lanes stay No #1. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Do not re-ship empty-lane isolation or later-call grouping. Stamp-only = REJECT.

### PR 45: first-time neighbor — occupied paper keeps one first click
- **Files:** `src/ui/listing-card.tsx`, `src/ui/lane-board.tsx`, `src/ui/claim-column.tsx`, `src/ui/outbid-form.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`, `BUILD.md`
- **Dependencies:** PR 44
- **Acceptance:** Occupied London `/` keeps Call this #1 as the first occupied click (`data-first-click="call"`). Claim / Outbid my column is a later write after the listing (`later-claim`, `data-later-claim`, “Then Claim #1”), not a same-weight rail above the prize. Occupied #1 name stays the prize. Unpaid stays off the board. Empty lanes stay No #1 / no stars / no map. Column tabs stay after the listing. Empty paper stays Claim #1. Do not add another named hop. Do not stamp `call-after-claim-N`. Do not recolor. Do not rebuild the classified paper. Do not re-ship unpaid-off, empty-lane isolation, or later-call grouping. Stamp-only = REJECT.

### PR 46: first-time neighbor — occupied week window is rolling last-7-days
- **Files:** `src/week.ts`, `src/board.ts`, `src/ui/edition.tsx`, `src/ui/lane-board.tsx`, `app/globals.css`, `app/rules/page.tsx`, `tests/week.test.ts`, `tests/board.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 45
- **Acceptance:** Occupied London `/` names rolling last 7 days, not Monday 00:00 Europe/London. Live occupancy filters Polar-paid `createdAt` in that window; `weekId` stays a label. Empty lanes stay No #1. Occupied #1 name still reads before `$bid`. Call this #1 stays the first occupied click. Claim stays after the listing. Unpaid stays off. Column tabs stay after the listing. Not a 24h lock on #1. Do not add another named hop. Do not stamp `call-after-claim-N`. Do not recolor. Do not rebuild the classified paper. Do not re-ship unpaid-off, empty-lane isolation, later-call grouping, or Claim-after-listing. Stamp-only = REJECT.

### PR 47: first-time neighbor — empty paper copy is rolling last-7-days
- **Files:** `src/ui/edition.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 46
- **Acceptance:** Empty London `/` names rolling last 7 days, not Monday 00:00 Europe/London. Empty does not stamp occupied `data-rolling-week` or `week-window`. Empty lanes stay No #1. Occupied Call this #1 stays the first occupied click. Occupied rolling chrome stays off empty. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Do not retouch occupied Call this #1. Stamp-only = REJECT.

### PR 48: first-time neighbor — empty kicker matches rolling last-7-days
- **Files:** `src/ui/edition.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 47
- **Acceptance:** Empty London `/` masthead kicker names last 7 days, not "This week's" Monday paper. Empty does not stamp occupied `data-rolling-week` or `week-window`. Empty lanes stay No #1. Occupied Call this #1 stays the first occupied click. Occupied kicker stays. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Do not retouch occupied Call this #1. Stamp-only = REJECT.

### PR 49: first-time neighbor — occupied kicker matches rolling last-7-days
- **Files:** `src/ui/edition.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 48
- **Acceptance:** Occupied London `/` masthead kicker names last 7 days, not "This week's" Monday paper. Empty kicker stays last 7 days. Empty does not stamp occupied `data-rolling-week` or `week-window`. Empty lanes stay No #1. Occupied Call this #1 stays the first occupied click. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Do not retouch occupied Call this #1. Do not restamp empty last-7-days kicker. Stamp-only = REJECT.

### PR 51: first-time neighbor — about copy matches rolling last-7-days
- **Files:** `app/about/page.tsx`, `tests/board.test.ts`, `tests/urls.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 50 (site header last 7 days on `main`)
- **Acceptance:** About names rolling last 7 days, not "whoever paid the most this week" Monday paper. Site header stays last 7 days. Occupied kicker stays last 7 days. Empty kicker stays last 7 days. Empty does not stamp occupied `data-rolling-week` or `week-window`. Empty lanes stay No #1. Occupied Call this #1 stays the first occupied click. Do not retouch Call or site header. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

### PR 52: first-time neighbor — README copy matches rolling last-7-days
- **Files:** `README.md`, `tests/board.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 51 (about last 7 days on `main`)
- **Acceptance:** README names rolling last 7 days, not "Weekly pay-to-rank" Monday paper. About stays last 7 days. Site header stays last 7 days. Occupied kicker stays last 7 days. Empty kicker stays last 7 days. Empty does not stamp occupied `data-rolling-week` or `week-window`. Empty lanes stay No #1. Occupied Call this #1 stays the first occupied click. Do not retouch Call, About, or site header. Do not restamp about last-7-days. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

### PR 53: first-time neighbor — edition dek matches rolling last-7-days
- **Files:** `src/ui/edition.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 52 (README last 7 days on `main`)
- **Acceptance:** Edition dek names rolling last 7 days, not "this edition" / "whoever paid the most" Monday paper. README stays last 7 days. About stays last 7 days. Site header stays last 7 days. Occupied kicker stays last 7 days. Empty kicker stays last 7 days. Empty does not stamp occupied `data-rolling-week` or `week-window`. Empty lanes stay No #1. Occupied Call this #1 stays the first occupied click. Do not retouch Call, README, About, or site header. Do not restamp occupied/empty last-7-days kickers. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

### PR 54: first-time neighbor — last-week archive copy matches rolling last-7-days
- **Files:** `src/ui/lane-board.tsx`, `app/globals.css`, `tests/board.test.ts`, `tests/week.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 53 (edition dek last 7 days on `main`)
- **Acceptance:** Last-week archive names rolling last-7-days age-out, not "Not this week's #1" Monday paper. Edition dek stays last 7 days. README stays last 7 days. About stays last 7 days. Site header stays last 7 days. Occupied kicker stays last 7 days. Empty kicker stays last 7 days. Empty does not stamp occupied `data-rolling-week` or `week-window`. Empty lanes stay No #1. Occupied Call this #1 stays the first occupied click. Do not retouch Call, README, About, site header, kickers, or edition dek. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

### PR 55: first-time neighbor — rules lane copy matches rolling last-7-days
- **Files:** `app/rules/page.tsx`, `tests/board.test.ts`, `tests/urls.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 54 (last-week archive last 7 days on `main`)
- **Acceptance:** Rules keys the lane as city × category over rolling last 7 days, not "city × category × week" Monday paper. Identity is site + category + city; `weekId` stays a Polar/audit label. Last-week archive stays last 7 days. Edition dek stays last 7 days. README stays last 7 days. About stays last 7 days. Site header stays last 7 days. Occupied kicker stays last 7 days. Empty kicker stays last 7 days. Empty does not stamp occupied `data-rolling-week` or `week-window`. Empty lanes stay No #1. Occupied Call this #1 stays the first occupied click. Do not retouch Call, README, About, site header, kickers, edition dek, or last-week archive. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

### PR 56: first-time neighbor — rules Week heading matches rolling last-7-days
- **Files:** `app/rules/page.tsx`, `tests/board.test.ts`, `tests/urls.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 55 (rules lane last 7 days on `main`)
- **Acceptance:** Rules Week heading names last 7 days, not a Monday paper. Ranking still keys the lane as city × category over rolling last 7 days. Identity stays site + category + city; `weekId` stays a Polar/audit label. Last-week archive stays last 7 days. Edition dek stays last 7 days. README stays last 7 days. About stays last 7 days. Site header stays last 7 days. Occupied kicker stays last 7 days. Empty kicker stays last 7 days. Empty does not stamp occupied `data-rolling-week` or `week-window`. Empty lanes stay No #1. Occupied Call this #1 stays the first occupied click. Do not retouch Call, README, About, site header, kickers, edition dek, last-week archive, or the rules Ranking / Identity copy from #55. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

### PR 57: first-time neighbor — occupied raise copy names difference-only
- **Files:** `src/ui/outbid-form.tsx`, `src/ui/lane-board.tsx`, `src/ui/claim-column.tsx`, `app/globals.css`, `tests/board.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 56 (rules Week heading last 7 days on `main`)
- **Acceptance:** Occupied London `/` raise / Outbid copy names Polar charges only the difference, not a full rebid (`data-raise-difference`). Occupied Call this #1 stays the first occupied click. Empty lanes stay No #1 and do not name occupied raise-pays-difference. Empty does not stamp occupied `data-rolling-week` or `week-window`. README stays last 7 days. About stays last 7 days. Site header stays last 7 days. Occupied kicker stays last 7 days. Empty kicker stays last 7 days. Edition dek stays last 7 days. Last-week archive stays last 7 days. Rules Ranking / Identity from #55 stay. Rules Week heading from #56 stays last 7 days. Do not retouch Call, README, About, site header, kickers, edition dek, last-week archive, or the rules Week heading from #56. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

### PR 58: first-time neighbor — occupied Polar return names difference-only
- **Files:** `app/return/page.tsx`, `src/polar/port.ts`, `app/globals.css`, `tests/checkout.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 57 (occupied raise / Outbid difference-only on `main`)
- **Acceptance:** Occupied Polar `/return` after a raise names Polar charged only the difference, not a full rebid (`data-raise-return`). A new listing return still names listed at the bid and does not stamp a raise return. Occupied Call this #1 stays the first occupied click. Empty lanes stay No #1. Empty does not stamp occupied `data-rolling-week` or `week-window`. README stays last 7 days. About stays last 7 days. Site header stays last 7 days. Occupied kicker stays last 7 days. Empty kicker stays last 7 days. Edition dek stays last 7 days. Last-week archive stays last 7 days. Rules Ranking / Identity from #55 stay. Rules Week heading from #56 stays last 7 days. Occupied raise / Outbid difference-only copy from #57 stays. Do not retouch Call, README, About, site header, kickers, edition dek, last-week archive, the rules Week heading from #56, or occupied raise / Outbid from #57. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

### PR 59: first-time neighbor — occupied cancelled Polar return still occupies
- **Files:** `app/return/page.tsx`, `app/globals.css`, `tests/checkout.test.ts`, `scripts/test.sh`, `SPEC.md`, `BUILD.md`
- **Dependencies:** PR 58 (occupied Polar return difference-only on `main`)
- **Acceptance:** Occupied cancelled Polar `/return` after a raise names they still occupy at the old bid (`data-raise-cancel`). An abandoned raise does not unlist. A new listing cancelled return still names no rank claimed / does not list. Occupied paid Polar return after a raise still names Polar charged only the difference (`data-raise-return`). Occupied Call this #1 stays the first occupied click. Empty lanes stay No #1. Empty does not stamp occupied `data-rolling-week` or `week-window`. README stays last 7 days. About stays last 7 days. Site header stays last 7 days. Occupied kicker stays last 7 days. Empty kicker stays last 7 days. Edition dek stays last 7 days. Last-week archive stays last 7 days. Rules Ranking / Identity from #55 stay. Rules Week heading from #56 stays last 7 days. Occupied raise / Outbid difference-only copy from #57 stays. Occupied Polar return difference-only copy from #58 stays. Do not retouch Call, README, About, site header, kickers, edition dek, last-week archive, the rules Week heading from #56, occupied raise / Outbid from #57, or occupied Polar return difference-only from #58. Do not add another named hop. Do not stamp `*-after-*-N`. Do not recolor. Do not rebuild the classified paper. Stamp-only = REJECT.

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
