# Live smoke — Local Service Weekly

Operator-only. `bash scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or GitHub Actions. CI and `scripts/test.sh` stay offline and must not set `POLAR_LIVE`.

`100%` for this unit means a **local process** walked every SPEC §14 flow. Fixture checkout is the default path. Live Polar runs only when `POLAR_LIVE=1` and secrets exist. Missing Polar secret is `BLOCKED-SECRET` naming the env var — that is not a fixture success and not a paid listing. Do not invent a provider. An empty London lane is valid.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` and `GITHUB_ACTIONS=true`.
2. Starts a local process that serves the same App Router handlers on a free loopback port with Polar env unset and `POLAR_FIXTURE_ONLY=1`.
3. Or attaches to `LIVE_SMOKE_BASE` if that server already answers `GET /healthz`.
4. Walks SPEC §14: healthz, London board, about/rules, checkout, raise, click, takedown.
5. Live Polar: if `POLAR_LIVE` is not `1` or `POLAR_ACCESS_TOKEN` is empty, prints `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` for the live-checkout row. Board, about/rules, fixture checkout, raise, click, and takedown still run on the fixture process.
6. Kills the process it started and deletes the temp workdir.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`.

Live Polar (operator machine with real secrets):

```bash
POLAR_LIVE=1 POLAR_ACCESS_TOKEN=… bash scripts/live-smoke.sh
```

`POLAR_FIXTURE_ONLY=1` always wins over live.

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | Documented product error; nothing invented. |
| `BLOCKED-SECRET` | Live Polar secret missing. Exact env var named. |
| `FAIL` | Broken product or invented listing / rating. |

## This session

Ran `bash scripts/live-smoke.sh` on **2026-08-22** from `feat/live-smoke` (parent `fc7013c`, public clicks #11 on `origin/main`). Local Next.js process started by the script on `http://127.0.0.1:59734`. Temp SQLite. `POLAR_LIVE` unset. `POLAR_ACCESS_TOKEN` unset. Fixture path. No invented provider: empty London movers lane first, then unique `smoke.example/van-*` URLs for this run.

Also refused `CI=true` (`FAIL: live-smoke refuses CI=true`) and `GITHUB_ACTIONS=true`.

| Flow | Result | Note |
|---|---|---|
| Health | **PASS** | `GET /healthz` 200 `{ ok: true }` |
| London board | **PASS** | `GET /` and `GET /c/london/movers` 200. Empty lane. No invented provider. Week `2026-08-17`. |
| About / rules | **PASS** | `GET /about` and `GET /rules` 200. Rank is the bid. Min $5. Older wins. Raise pays difference. |
| Bid $4 | **PASS-ERROR** | `POST /api/checkout` $4 → 400 `bid_too_low` |
| Telegram URL | **PASS-ERROR** | `POST /api/checkout` `t.me` → 400 `chat_link` |
| Dentist, no license | **PASS-ERROR** | `POST /api/checkout` → 400 `license_required` |
| Live Polar checkout | **BLOCKED-SECRET** | `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` |
| Fixture checkout | **PASS** | Paid $20 lists at rank 1. Tracking query stripped. |
| Raise | **PASS** | $20→$25 charged $5. Stays #1. |
| Click | **PASS** | `GET /go/lst_a325b9710f1e2cd4` **302** to cleaned URL. Clicks `0→1`. |
| Takedown | **PASS** | Hidden listing absent from London movers. No invented replacement. |

Process exit 0 (`PASS=7` `PASS-ERROR=3` `BLOCKED-SECRET=1` `FAIL=0`). Re-run with `POLAR_LIVE=1` and a real token to complete Polar Checkout; missing token must stay `BLOCKED-SECRET`, never a fixture listing.

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not set `POLAR_LIVE=1` in CI.
- Does not seed an invented provider on an empty London lane.
- Does not treat a missing Polar secret as a paid listing.
