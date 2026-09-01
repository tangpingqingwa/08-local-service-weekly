# Live smoke — Local Service Weekly

Operator-only. `bash scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or GitHub Actions. CI and `scripts/test.sh` stay offline.

`100%` for this unit means a **local process** walked every SPEC §14 flow. Fixture checkout is the default development path. A Waffo operator run requires an explicit `PAYMENT_MODE=waffo-test` or `PAYMENT_MODE=waffo-prod`, complete matching secrets, an isolated database, and a stable HTTPS public URL. Missing Waffo configuration is `BLOCKED-SECRET` naming the env var — that is not a fixture success and not a paid listing. Do not invent a provider. An empty London lane is valid.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` and `GITHUB_ACTIONS=true`.
2. Starts a local development process that serves the same App Router handlers on a free loopback port with explicit `PAYMENT_MODE=fixture`.
3. Or attaches to `LIVE_SMOKE_BASE` if that server already answers `GET /healthz`.
4. Walks SPEC §14: healthz, London board, about/rules, checkout, raise, click, takedown.
5. Waffo checkout: if an explicit Waffo mode is requested without a required secret, prints `BLOCKED-SECRET` for the live-checkout row. Board, about/rules, fixture checkout, raise, click, and takedown still run on the fixture process.
6. Kills the process it started and deletes the temp workdir.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`.

Waffo operator checkout (operator machine; source secrets from a private store, never commit them):

```bash
set -a
# shellcheck disable=SC1091
source /private/path/waffo.env
set +a
export PAYMENT_MODE=waffo-test
export WAFFO_API_BASE=https://api.waffo.ai
bash scripts/live-smoke.sh
```

The canonical signed webhook endpoint is `/api/webhooks/waffo`. Return-page navigation never settles a live checkout; only a verified Waffo `order.completed` event matching the immutable intent can rank.

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | Documented product error; nothing invented. |
| `BLOCKED-SECRET` | Live Waffo secret missing. Exact env var named. |
| `FAIL` | Broken product or invented listing / rating. |

## This session

The current offline gate runs the fixture process only. Any prior provider-specific smoke record is historical and non-executable; repeat an operator Waffo run only with explicit mode, isolated credentials, and an authorized HTTPS endpoint.

| Flow | Result | Note |
|---|---|---|
| Health | **PASS** | `GET /healthz` 200 `{ ok: true }` |
| London board | **PASS** | `GET /` and `GET /c/london/movers` 200. Empty lane. No invented provider. Week `2026-08-17`. |
| About / rules | **PASS** | `GET /about` and `GET /rules` 200. Rank is the bid. Min $5. Older wins. Raise pays difference. |
| Bid $4 | **PASS-ERROR** | `POST /api/checkout` $4 → 400 `bid_too_low` |
| Telegram URL | **PASS-ERROR** | `POST /api/checkout` `t.me` → 400 `chat_link` |
| Dentist, no license | **PASS-ERROR** | `POST /api/checkout` → 400 `license_required` |
| Waffo checkout | **BLOCKED-SECRET** | No live provider call is made without explicit complete Waffo configuration. |
| Fixture checkout | **PASS** | Paid $20 lists at rank 1. Tracking query stripped. |
| Raise | **PASS** | $20→$25 charged $5. Stays #1. |
| Click | **PASS** | `GET /go/lst_9b8162695fd2310c` **302** to cleaned URL. Clicks `0→1`. |
| Takedown | **PASS** | Hidden listing absent from London movers. No invented replacement. |

Process exit 0 (`PASS=8` `PASS-ERROR=3` `BLOCKED-SECRET=0` `FAIL=0`). Missing Waffo secret must still record `BLOCKED-SECRET` and must not invent a paid row.

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not select a provider from an implicit flag in CI or `scripts/test.sh`.
- Does not seed an invented provider on an empty London lane.
- Does not treat a missing Waffo secret as a paid listing.
- Does not complete a paid Waffo webhook in this session (unpaid live checkout stays off the board).
