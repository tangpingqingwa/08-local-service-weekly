import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  lastWeekNumberOne,
  listLane,
  rankLane,
} from "../src/board";
import { getCategory } from "../src/categories";
import { getCity } from "../src/cities";
import { openDatabase, type AppDb, type Listing } from "../src/db";
import { raiseListing } from "../src/listings";
import {
  FakePolarPort,
  resetPolarFixture,
  setPolarPortForTests,
} from "../src/polar/fake";
import { PolarError, type ListingDraft } from "../src/polar/port";
import { LaneBoard } from "../src/ui/lane-board";
import {
  WEEK_TIMEZONE,
  WeekError,
  currentWeekId,
  ensureWeek,
  formatWeekLabel,
  previousWeekId,
  requireOpenWeek,
  weekId,
  weekWindow,
} from "../src/week";

(globalThis as { React?: typeof React }).React = React;

process.env.DATABASE_PATH = ":memory:";

afterEach(() => {
  resetPolarFixture();
});

/** Sunday 23:59:59.999 BST — still week 2026-08-17. */
const BEFORE_ROLLOVER = new Date("2026-08-23T22:59:59.999Z");
/** Monday 00:00:00.000 Europe/London (BST). */
const LONDON_MONDAY = new Date("2026-08-23T23:00:00.000Z");
/** Sunday 23:59:59.999 GMT — still week 2026-01-05. */
const WINTER_BEFORE = new Date("2026-01-11T23:59:59.999Z");
/** Monday 00:00:00.000 GMT. */
const WINTER_MONDAY = new Date("2026-01-12T00:00:00.000Z");

function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    business: "North London Movers",
    category: "movers",
    city: "london",
    siteUrl: "https://north.example",
    licenseId: null,
    bidUsd: 20,
    weekId: currentWeekId(),
    ...overrides,
  };
}

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "lst_default",
    business: "Example Movers",
    category: "movers",
    city: "london",
    siteUrl: "https://example.com",
    licenseId: null,
    bidUsd: 20,
    weekId: currentWeekId(),
    createdAt: "2026-08-17T00:00:00.000Z",
    raisedAt: null,
    clicks: 0,
    hidden: false,
    hiddenReason: null,
    ...overrides,
  };
}

function insertListing(
  db: AppDb,
  row: {
    id: string;
    business: string;
    city?: string;
    weekId: string;
    bidUsd?: number;
    siteUrl?: string;
    createdAt?: string;
  },
): void {
  ensureWeek(db, row.weekId);
  db.prepare(
    `INSERT INTO listings (
       id, business, category, city, site_url, license_id, bid_usd, week_id,
       created_at, raised_at, clicks, hidden, hidden_reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.business,
    "movers",
    row.city ?? "london",
    row.siteUrl ?? "https://example.com",
    null,
    row.bidUsd ?? 20,
    row.weekId,
    row.createdAt ?? "2026-08-17T00:00:00.000Z",
    null,
    0,
    0,
    null,
  );
}

test("weekId is the Monday ISO date in Europe/London", () => {
  assert.equal(WEEK_TIMEZONE, "Europe/London");
  assert.match(formatWeekLabel("2026-08-17"), /Mon.*17.*Aug.*2026/);
  assert.equal(weekId(new Date("2026-08-17T00:00:00.000Z"), WEEK_TIMEZONE), "2026-08-17");
  assert.equal(weekId(new Date("2026-08-22T12:00:00.000Z"), "Europe/London"), "2026-08-17");
  assert.equal(weekId(BEFORE_ROLLOVER, "Europe/London"), "2026-08-17");
  assert.equal(weekId(LONDON_MONDAY, "Europe/London"), "2026-08-24");
  assert.equal(currentWeekId(LONDON_MONDAY), "2026-08-24");
  assert.notEqual(currentWeekId(BEFORE_ROLLOVER), currentWeekId(LONDON_MONDAY));
});

test("Monday 00:00 Europe/London rollover is DST-safe in winter", () => {
  assert.equal(weekId(WINTER_BEFORE, "Europe/London"), "2026-01-05");
  assert.equal(weekId(WINTER_MONDAY, "Europe/London"), "2026-01-12");
  const summer = weekWindow("2026-08-17");
  assert.equal(summer.opensAt.toISOString(), "2026-08-16T23:00:00.000Z");
  assert.equal(summer.closesAt.toISOString(), "2026-08-23T23:00:00.000Z");
  const winter = weekWindow("2026-01-05");
  assert.equal(winter.opensAt.toISOString(), "2026-01-05T00:00:00.000Z");
  assert.equal(winter.closesAt.toISOString(), "2026-01-12T00:00:00.000Z");
});

test("closed week rejects writes with week_closed 409", () => {
  const last = previousWeekId(currentWeekId());
  assert.throws(() => requireOpenWeek(last), (err: unknown) => {
    assert.ok(err instanceof WeekError);
    assert.equal(err.code, "week_closed");
    assert.equal(err.httpStatus, 409);
    return true;
  });
  assert.equal(requireOpenWeek(currentWeekId()), currentWeekId());
});

test("Monday 00:00 London opens a new empty week; last week is not current #1", () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const lastWeek = previousWeekId(currentWeekId());
  const openWeek = currentWeekId();
  insertListing(db, {
    id: "lst_last",
    business: "Last Week Van",
    weekId: lastWeek,
    bidUsd: 99,
    siteUrl: "https://last.example",
  });

  assert.deepEqual(listLane("london", "movers", db, openWeek), []);
  const current = listLane("london", "movers", db);
  assert.equal(current.length, 0);
  assert.equal(current[0]?.business, undefined);

  const archived = lastWeekNumberOne("london", "movers", db);
  assert.ok(archived);
  assert.equal(archived.business, "Last Week Van");
  assert.equal(archived.bidUsd, 99);
  assert.equal(archived.weekId, lastWeek);
  assert.notEqual(archived.weekId, openWeek);
  assert.equal(listLane("london", "movers", db)[0]?.id, undefined);
});

test("ranker stays keyed by city; London shipped; same URL is another lane elsewhere", () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  assert.equal(getCity("london")?.slug, "london");
  assert.equal(getCity("manchester"), undefined);

  db.prepare(
    "INSERT INTO cities (slug, display, public) VALUES (?, ?, ?)",
  ).run("manchester", "Manchester", 0);
  const openWeek = currentWeekId();
  insertListing(db, {
    id: "lst_lon",
    business: "London Van",
    city: "london",
    weekId: openWeek,
    siteUrl: "https://same.example",
    bidUsd: 15,
  });
  insertListing(db, {
    id: "lst_mcr",
    business: "Manchester Van",
    city: "manchester",
    weekId: openWeek,
    siteUrl: "https://same.example",
    bidUsd: 40,
  });

  const london = listLane("london", "movers", db, openWeek);
  const manchester = listLane("manchester", "movers", db, openWeek);
  assert.equal(london.length, 1);
  assert.equal(london[0]?.business, "London Van");
  assert.equal(london[0]?.city, "london");
  assert.equal(london[0]?.rank, 1);
  assert.equal(manchester.length, 1);
  assert.equal(manchester[0]?.business, "Manchester Van");
  assert.equal(manchester[0]?.city, "manchester");
  assert.notEqual(london[0]?.id, manchester[0]?.id);

  const mixed = rankLane([
    listing({ id: "lst_lon", city: "london", bidUsd: 15 }),
    listing({ id: "lst_mcr", city: "manchester", bidUsd: 40 }),
  ]);
  assert.equal(mixed[0]?.city, "manchester");
});

test("last-week archive copy is not this week's #1 card", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);
  const last = listing({
    id: "lst_last",
    business: "Last Week Van",
    bidUsd: 99,
    weekId: previousWeekId(currentWeekId()),
  });
  const html = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      lastWeek: {
        ...last,
        rank: 1,
        siteHost: "last.example",
      },
      weekId: currentWeekId(),
    }),
  );
  assert.match(html, /data-empty-lane="true"/);
  assert.match(html, /data-empty-honest=""/);
  assert.match(html, /No #1/);
  assert.match(html, /data-last-week/);
  assert.match(html, /Last week #1/);
  assert.match(html, /Last Week Van/);
  assert.doesNotMatch(html, /data-listing-card/);
  assert.doesNotMatch(html, /data-rank="1"/);
});

test("fixture checkout on a closed week is week_closed 409", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePolarPort(db);
  await assert.rejects(
    () =>
      polar.createCheckout({
        amountUsd: 20,
        listing: draft({ weekId: previousWeekId(currentWeekId()) }),
      }),
    (err: unknown) => {
      assert.ok(err instanceof PolarError);
      assert.equal(err.code, "week_closed");
      assert.equal(err.httpStatus, 409);
      return true;
    },
  );
  assert.deepEqual(listLane("london", "movers", db), []);

  await assert.rejects(
    () =>
      raiseListing(
        draft({ weekId: previousWeekId(currentWeekId()), bidUsd: 25 }),
        polar,
        db,
      ),
    (err: unknown) => {
      assert.ok(err instanceof PolarError);
      assert.equal(err.code, "week_closed");
      return true;
    },
  );
});

test("POST /api/checkout closed weekId returns week_closed", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  setPolarPortForTests(new FakePolarPort(db));
  const { POST } = await import("../app/api/checkout/route");
  const response = await POST(
    new Request("http://127.0.0.1/api/checkout", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        business: "Stale Van",
        category: "movers",
        city: "london",
        siteUrl: "https://stale.example",
        amount: 20,
        weekId: previousWeekId(currentWeekId()),
      }),
    }),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "week_closed" });
  assert.deepEqual(listLane("london", "movers", db), []);
});

test("ensureWeek persists London Monday bounds", () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  ensureWeek(db, "2026-08-17");
  const row = db
    .prepare<
      [string],
      { id: string; timezone: string; opens_at: string; closes_at: string }
    >("SELECT id, timezone, opens_at, closes_at FROM weeks WHERE id = ?")
    .get("2026-08-17");
  assert.deepEqual(row, {
    id: "2026-08-17",
    timezone: "Europe/London",
    opens_at: "2026-08-16T23:00:00.000Z",
    closes_at: "2026-08-23T23:00:00.000Z",
  });
});
