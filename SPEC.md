# Local Service Weekly — Product Development Spec

**Version:** 1.0  
**Status:** Ready to build  
**Repo:** https://github.com/tangpingqingwa/08-local-service-weekly  
**Market:** global English  
**Clone of:** [outbid.lol](https://outbid.lol) pay-to-rank mechanics  
**Forbidden:** invented ratings, stars, review counts, chat/invite links, NSFW, live Polar in CI

This document is the product contract. If README and SPEC disagree, SPEC wins until README is updated. If SPEC and code disagree, fix one of them in the same PR.

Implementation plan (stack, modules, PR DAG): [BUILD.md](./BUILD.md).

---

## 1. Product statement

A public weekly auction for the **#1 visible local-service provider** in a **city × category**. Ranking is money. There are no stars, no review scores, and no “top rated” badges.

v1 city lane is **London**. The data model and ranker are multi-city from day one: adding Manchester or New York is a city row, not a rewrite of ranking.

One-line pitch: **The #1 mover / dentist / immigration lawyer / tutor in town is whoever paid the most this week.**

---

## 2. Goals and non-goals

### Goals

- Public leaderboard. No ads, no API keys, no revenue share.
- Rank equals the bid. Nothing else (no recency boost, no quality score, no invented ratings).
- Whole US dollar bids. Minimum **$5**. Maximum **$999,999**. Increments of **$1**.
- Paying less than #1 still lists at the rank that bid can take.
- Equal bids: the **older** listing keeps the higher rank.
- The same business + category + city + canonical site can **raise**. Payer pays only the **difference**. Someone else cannot steal that rank by paying only that difference — they must bid a strictly higher amount.
- Strip tracking query strings from listing URLs.
- No chat or invite links. No NSFW.
- Clicks on the listing site are counted and **public**.
- Live payments via **Polar** (merchant of record). Tests use a **fixture** Polar adapter. CI never sets live Polar flags.
- Pages: board, about, rules, checkout return.
- USD. English UI. Global English market; v1 ships London only.

### Non-goals

- Fake Google / Yelp / Trustpilot stars or review counts.
- A marketplace, booking engine, or chat between customer and provider.
- Maps scraping, directory scraping, or invented “verified” badges.
- Multi-currency in v1.
- China-city default. No city is implied when none is selected — London is the documented v1 lane, not a hidden geo-guess.
- Accounts, follows, comments, DMs.
- Buying the whole city or every category in one checkout.

---

## 3. City × category

A **lane** is `(city, category, week)`. Ranking never mixes cities or categories.

### Cities

| Slug | Display | v1 |
|---|---|---|
| `london` | London | **yes** — only public city at launch |
| others | — | architecture must accept more rows without changing rank code |

Unknown city slug → `404 city_unknown`. Do not silently fall back to London.

### Categories (closed set in v1)

| Slug | Display | License field |
|---|---|---|
| `movers` | Movers | optional |
| `dentists` | Dentists | **required** (`licenseId`) |
| `immigration_lawyers` | Immigration lawyers | **required** (`licenseId`) |
| `tutors` | Tutors | optional |

Unknown category → `404 category_unknown`.

---

## 4. Listing schema

A listing is a **business + category + city + site**. That tuple is the identity used for raise-bid.

```ts
type Listing = {
  id: string
  business: string          // 1–80 chars, trimmed
  category: CategorySlug    // movers | dentists | immigration_lawyers | tutors
  city: string              // city slug; v1 public = london
  siteUrl: string           // https URL, tracking query stripped
  licenseId: string | null  // required for dentists + immigration_lawyers
  bidUsd: number            // integer, 5…999999
  weekId: string            // see §6
  createdAt: string         // ISO instant of first paid placement this week
  raisedAt: string | null
  clicks: number            // public, never invented
  hidden: boolean           // takedown
  hiddenReason: TakedownReason | null
}
```

**Identity key** (raise target): `canonical(siteUrl)` + `category` + `city` + `weekId`.  
Business name may change on raise; the key does not.

**Honesty:** never invent a rating, star, review count, “patients served”, or license verification status. `licenseId` is a claimed string the operator can use for a complaint. v1 does not call a government license API.

Empty board for a lane is valid. Show the empty state. Do not invent a placeholder provider.

---

## 5. Ranking rules (normative)

Inside one lane `(city, category, weekId)`:

1. Visible listings only (`hidden = false`).
2. Sort by `bidUsd` descending.
3. Ties: smaller `createdAt` (older) wins the higher rank.
4. Rank `#1` is the first row. Paying less than that bid still appears at the first index whose next-lower bid is `<` this bid (same as outbid.lol).
5. New listing minimum is **$5**. Existing amounts stay until raise or week reset.
6. **Raise:** same identity key, new amount `N`. Require `N >= currentBid + 1` and `N <= 999999`. Charge **`N - currentBid`** only. `createdAt` does **not** change (the older stamp still wins ties).
7. A **different** identity cannot take a rank by paying only the difference another listing would pay to raise. They must submit a bid **strictly greater** than the occupant’s `bidUsd`.
8. Completed Polar payment (or fixture `paid`) is what claims the rank. Unpaid checkout drafts never appear.

---

## 6. Weekly window

Week is **Monday 00:00 Europe/London** to the next Monday 00:00 Europe/London.  
`weekId` = that Monday’s ISO date, e.g. `2026-08-17`.

At rollover:

- Previous week’s listings freeze. They are not current rank.
- The new week starts empty. Last week’s #1 may be shown as “last week” archive copy. It is not this week’s #1 unless they pay again.
- Raise and new bids apply only to the **open** week.

The #1 **visible provider** for a city × category is the current open week’s rank `#1`. That is the product.

---

## 7. URL hygiene

On accept:

- Require `https:` (or resolve `http:` → `https:` when the host matches).
- Strip tracking / affiliate query keys (`utm_*`, `gclid`, `fbclid`, `ref`, `ref_id`, `affiliate`, `via`, `mc_cid`, `mc_eid`).
- Drop the fragment.
- Lowercase host. Trailing slash ignored for identity.
- Link shorteners are not stored: follow one redirect hop in live; fixture tests supply the final URL. If still a known shortener host → `400 url_shortener`.
- Chat / invite hosts rejected (`telegram`, `t.me`, `wa.me`, `whatsapp`, `discord.gg`, `discord.com/invite`, `m.me`, `signal.me`) → `400 chat_link`.
- NSFW / adult hosts (operator denylist + path keywords in BUILD) → `400 nsfw`.
- Store the cleaned URL. Clicks go to that URL with **no** query string added by us.

---

## 8. Payments

| Mode | When | Adapter |
|---|---|---|
| Fixture | `scripts/test.sh`, CI, default | `PolarPort` fake: checkout returns `paid` immediately, records amount |
| Live | `POLAR_LIVE=1` + Polar secrets | Polar checkout + webhook; merchant of record |

`POLAR_FIXTURE_ONLY=1` always wins over live.  
CI and `scripts/test.sh` must not set `POLAR_LIVE=1` or Polar secrets.

Currency is **USD**. Amounts are integers. No cents.

Checkout return page (`/return`) shows paid / cancelled / unknown. It does not invent a rank before the webhook (live) or fixture settle.

---

## 9. Public clicks

`GET /go/:id` (or equivalent) increments `clicks` by 1 and **302**s to the cleaned `siteUrl`.  
The board shows the integer. Never pre-seed, estimate, or “warm” the counter.

---

## 10. License and complaint takedown

Licensed categories (`dentists`, `immigration_lawyers`):

- `licenseId` required, 2–64 visible characters. Missing → `400 license_required`.
- The site does **not** assert the license is valid. Copy must say it is claimed, not verified.

Takedown (operator, shared secret or documented inbox):

| Reason | Effect |
|---|---|
| `unlicensed` | hide; rank vacated |
| `impersonation` | hide; rank vacated |
| `complaint` | hide after a written complaint naming the listing + city + category |
| `nsfw` | hide |
| `chat_link` | hide |
| `other` | hide; reason stored |

Hidden listings drop off the public board. Bid is **not** auto-refunded. A hidden listing cannot raise until unhidden. Do not replace a taken-down #1 with an invented business.

---

## 11. Pages

```
GET  /                         London board (v1 default city)
GET  /c/:city                  city hub — four categories
GET  /c/:city/:category        lane board + bid form
GET  /about
GET  /rules
GET  /return                   Polar / fixture return
GET  /go/:id                   click + 302
GET  /healthz                  200 if process up
POST /checkout                 start Polar or fixture
POST /raise                    same identity, pay difference
```

Board cards: rank, business, city, category, **$bid**, **public clicks**, site host.  
**No stars. No review snippet. No “rated X”.**

Bid form: business, category (if not in the URL), city (if not in the URL), site URL, license when required, amount, **Outbid** button.

---

## 12. Errors

| Code | HTTP | When |
|---|---|---|
| `bid_too_low` | 400 | amount < 5 or raise not ≥ current+1 |
| `bid_too_high` | 400 | amount > 999999 |
| `bid_not_integer` | 400 | not a whole USD amount |
| `city_unknown` | 404 | slug not in cities |
| `category_unknown` | 404 | not in the closed set |
| `license_required` | 400 | dentist / immigration lawyer missing license |
| `chat_link` | 400 | chat / invite URL |
| `nsfw` | 400 | adult URL |
| `url_shortener` | 400 | shortener not resolved |
| `listing_hidden` | 409 | raise on a taken-down listing |
| `week_closed` | 409 | bid on a non-open week |
| `polar_not_live` | 503 | live checkout requested without live Polar |
| `unpaid` | 402 | checkout not completed |

No stack traces on public pages.

---

## 13. Acceptance

| # | Case | Expected |
|---|---|---|
| 1 | London / movers, two businesses bid $20 and $15 | $20 is #1; both listed |
| 2 | Two $20 bids | older listing is #1 |
| 3 | #1 at $20 raises to $25 | charged $5; stays #1; `createdAt` unchanged |
| 4 | Rival pays $5 (the difference) | rejected or lists below; cannot take #1 |
| 5 | Rival pays $26 | becomes #1 |
| 6 | Site URL with `?utm_source=x` | stored and clicked URL has no utm |
| 7 | Telegram / NSFW URL | `400`, not listed |
| 8 | Dentist without license | `400 license_required` |
| 9 | Operator takedown on #1 | listing gone; next visible bid is #1; no invented replacement |
| 10 | Week rolls Monday 00:00 Europe/London | new week empty; last week not current #1 |
| 11 | Click `/go/:id` | `clicks` +1 public; 302 to cleaned site |
| 12 | Non-London city slug in v1 | `404 city_unknown` (ranker still keyed by city) |
| 13 | UI never shows stars / review counts | asserted in tests |
| 14 | Fixture checkout in tests; live Polar env-gated | CI unset `POLAR_LIVE` |

---

## 14. Live-smoke flows (operator only)

`scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or Actions. Missing Polar secret → `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` (or the exact env BUILD names). Honest empty London lane is allowed.

| Flow | Pass |
|---|---|
| Health | `GET /healthz` 200 |
| London board | 200, no invented listing if empty |
| About / rules | 200 |
| Fixture or live checkout | paid listing appears at the bid’s rank |
| Raise | charged difference only |
| Click | public count increments; destination has no tracking query |
| Takedown | hidden listing absent from board |

---

## 15. Layout

```
/
  SPEC.md
  BUILD.md
  README.md
  CONTRIBUTING.md
  scripts/test.sh
  .github/workflows/ci.yml
```

Application tree is defined in [BUILD.md](./BUILD.md). This unit does not add app code.

---

## 16. Git collaboration (normative)

Development is GitHub trunk-based. **`main` is always cloneable, buildable, and testable.**

| Rule | Requirement |
|---|---|
| Integration branch | `main` only. No long-lived `develop`. |
| How code lands | Pull request into `main`. No direct push. |
| Required check | GitHub Actions workflow `ci` (job id `ci`) must be green. |
| Local / CI test | `bash scripts/test.sh` — offline, no production secrets. |
| Branch names | `feat/` `fix/` `docs/` `chore/` `test/` + short slug. |
| Merge | Squash. Delete the head branch. |
| Broken `main` | Treat as an incident. Fix on `fix/…` via PR. |

Full process: [CONTRIBUTING.md](./CONTRIBUTING.md).

Until there is an application binary, `scripts/test.sh` still has to pass: contract files exist, SPEC/CONTRIBUTING agree, no tracked secrets. Adding a server means **extending** that script with unit/contract tests. Live Polar is optional and must not be required for `main` to stay green.
