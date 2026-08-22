import assert from "node:assert/strict";
import { after, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;
import {
  DEFAULT_CITY_SLUG,
  lastWeekNumberOne,
  listCityLanes,
  listLane,
  rankLane,
  resolveCategory,
  resolveCity,
  type RankedListing,
} from "../src/board";
import { CATEGORIES, CATEGORY_SLUGS, getCategory } from "../src/categories";
import { getCity } from "../src/cities";
import type { Listing } from "../src/db";
import { openDatabase } from "../src/db";
import { currentWeekId, ensureWeek, previousWeekId } from "../src/week";
import { CityHub } from "../src/ui/city-hub";
import { LaneBoard } from "../src/ui/lane-board";
import { ListingCard } from "../src/ui/listing-card";
import { NotFoundCode } from "../src/ui/not-found-code";
import { OutbidForm } from "../src/ui/outbid-form";

process.env.DATABASE_PATH = ":memory:";

test("London is the v1 default city", () => {
  assert.equal(DEFAULT_CITY_SLUG, "london");
  const city = resolveCity(DEFAULT_CITY_SLUG);
  assert.equal(city.ok, true);
  if (city.ok) {
    assert.equal(city.value.display, "London");
  }
});

test("unknown city is 404 city_unknown and does not fall back to London", () => {
  const miss = resolveCity("manchester");
  assert.deepEqual(miss, {
    ok: false,
    code: "city_unknown",
    status: 404,
  });
  assert.equal(getCity("manchester"), undefined);
});

test("unknown category is 404 category_unknown", () => {
  assert.deepEqual(resolveCategory("plumbers"), {
    ok: false,
    code: "category_unknown",
    status: 404,
  });
  assert.equal(getCategory("plumbers"), undefined);
  assert.deepEqual(CATEGORY_SLUGS, [
    "movers",
    "dentists",
    "immigration_lawyers",
    "tutors",
  ]);
});

test("empty lane ranks to an empty list", () => {
  assert.deepEqual(rankLane([]), []);
});

test("rank is the bid; older stamp wins ties", () => {
  const low = listing({
    id: "lst_low",
    business: "South London Movers",
    bidUsd: 15,
    createdAt: "2026-08-17T00:00:00.000Z",
  });
  const high = listing({
    id: "lst_high",
    business: "North London Movers",
    bidUsd: 20,
    createdAt: "2026-08-18T00:00:00.000Z",
  });
  const olderTie = listing({
    id: "lst_old",
    business: "Older Twenty",
    bidUsd: 20,
    createdAt: "2026-08-16T00:00:00.000Z",
  });
  const ranked = rankLane([low, high, olderTie]);
  assert.deepEqual(
    ranked.map((row) => [row.rank, row.id, row.bidUsd]),
    [
      [1, "lst_old", 20],
      [2, "lst_high", 20],
      [3, "lst_low", 15],
    ],
  );
});

test("hidden listings drop off the public lane", () => {
  const ranked = rankLane([
    listing({ id: "lst_hidden", hidden: true, bidUsd: 99 }),
    listing({ id: "lst_visible", bidUsd: 10 }),
  ]);
  assert.deepEqual(
    ranked.map((row) => row.id),
    ["lst_visible"],
  );
});

test("listLane on a fresh db is empty and clicks stay at the stored 0", () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  assert.deepEqual(listLane("london", "movers", db), []);
  const lanes = listCityLanes("london", db);
  for (const category of CATEGORIES) {
    assert.deepEqual(lanes[category.slug], []);
  }

  seedWeek(db);
  insertListing(db, {
    id: "lst_1",
    business: "North London Movers",
    category: "movers",
    city: "london",
    siteUrl: "https://example.com",
    bidUsd: 20,
    clicks: 0,
    weekId: currentWeekId(),
  });
  insertListing(db, {
    id: "lst_last",
    business: "Last Week Van",
    category: "movers",
    city: "london",
    siteUrl: "https://last.example",
    bidUsd: 99,
    clicks: 0,
    weekId: previousWeekId(currentWeekId()),
  });
  const [row] = listLane("london", "movers", db);
  assert.ok(row);
  assert.equal(row.rank, 1);
  assert.equal(row.bidUsd, 20);
  assert.equal(row.clicks, 0);
  assert.equal(row.siteHost, "example.com");
  assert.equal(row.business, "North London Movers");
  assert.equal(row.weekId, currentWeekId());
  assert.notEqual(row.business, "Last Week Van");
  assert.deepEqual(listLane("london", "dentists", db), []);
  assert.equal(lastWeekNumberOne("london", "movers", db)?.business, "Last Week Van");
  assert.equal(listLane("london", "movers", db, previousWeekId(currentWeekId()))[0]?.rank, 1);
});

test("unknown-city 404 chrome prints city_unknown", () => {
  const html = renderToStaticMarkup(
    createElement(NotFoundCode, { code: "city_unknown" }),
  );
  assert.match(html, /data-error="city_unknown"/);
  assert.match(html, /city_unknown/);
  assert.match(html, /404/);
  assert.doesNotMatch(html, /★|⭐|rated|review count/i);
});

test("empty London hub is empty: four lanes, Outbid, no invented cards or stars", () => {
  const london = getCity("london");
  assert.ok(london);
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      lanes: {
        movers: [],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  assert.match(html, /data-city="london"/);
  assert.match(html, />London</);
  assert.match(html, /Rank is the bid/);
  assert.match(html, /data-bid-form/);
  assert.match(html, />Outbid</);
  assert.match(html, /name="business"/);
  assert.match(html, /name="siteUrl"/);
  assert.match(html, /name="amount"/);
  for (const category of CATEGORY_SLUGS) {
    assert.match(html, new RegExp(`data-category="${category}"`));
  }
  const emptyLanes = html.match(/data-empty-lane="true"/g) ?? [];
  assert.equal(emptyLanes.length, 4);
  assert.doesNotMatch(html, /data-listing-card/);
  assert.doesNotMatch(html, /★|⭐|&star;|rated\s+\d|review count|top rated/i);
  assert.doesNotMatch(html, /North London Movers|placeholder provider/i);
});

test("lane board empty state has no cards", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);
  const html = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(html, /data-empty-lane="true"/);
  assert.match(html, /This lane is empty/);
  assert.match(html, />Outbid</);
  assert.doesNotMatch(html, /data-listing-card/);
});

test("rank card shows $bid, public clicks placeholder 0, and host", () => {
  const html = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        business: "North London Movers",
        bidUsd: 20,
        clicks: 0,
        siteUrl: "https://example.com/van",
        siteHost: "example.com",
      }),
    }),
  );
  assert.match(html, /data-rank="1"/);
  assert.match(html, /#1/);
  assert.match(html, /North London Movers/);
  assert.match(html, /\$20/);
  assert.match(html, /0 clicks/);
  assert.match(html, /example.com/);
  assert.match(html, /London/);
  assert.match(html, /Movers/);
  assert.doesNotMatch(html, /★|⭐|rated|review/i);
});

test("Outbid form chrome has business, site, amount, and license when required", () => {
  const movers = renderToStaticMarkup(
    createElement(OutbidForm, {
      city: "london",
      category: "movers",
      lockCity: true,
      lockCategory: true,
    }),
  );
  assert.match(movers, />Outbid</);
  assert.match(movers, /name="business"/);
  assert.match(movers, /name="siteUrl"/);
  assert.match(movers, /name="amount"/);
  assert.match(movers, /name="city"/);
  assert.match(movers, /name="category"/);
  assert.doesNotMatch(movers, /name="licenseId"/);

  const dentists = renderToStaticMarkup(
    createElement(OutbidForm, {
      city: "london",
      category: "dentists",
      lockCity: true,
      lockCategory: true,
    }),
  );
  assert.match(dentists, /name="licenseId"/);
  assert.match(dentists, /not verified/);
});

test("GET / default page is the London hub", async () => {
  const { default: HomePage } = await import("../app/page");
  const html = renderToStaticMarkup(createElement(HomePage));
  assert.match(html, /data-city="london"/);
  assert.match(html, />London</);
  assert.match(html, /data-empty-lane="true"/);
  assert.match(html, />Outbid</);
  assert.doesNotMatch(html, /★|⭐|review count/i);
});

test("city and lane pages 404 unknown slugs", async () => {
  const { default: CityPage } = await import("../app/c/[city]/page");
  const { default: LanePage } = await import("../app/c/[city]/[category]/page");

  const unknownCity = await CityPage({
    params: Promise.resolve({ city: "manchester" }),
  });
  const unknownCityHtml = renderToStaticMarkup(unknownCity);
  assert.match(unknownCityHtml, /data-error="city_unknown"/);
  assert.match(unknownCityHtml, /city_unknown/);
  assert.doesNotMatch(unknownCityHtml, /data-city="london"/);

  const unknownCategory = await LanePage({
    params: Promise.resolve({ city: "london", category: "plumbers" }),
  });
  const unknownCategoryHtml = renderToStaticMarkup(unknownCategory);
  assert.match(unknownCategoryHtml, /data-error="category_unknown"/);
  assert.match(unknownCategoryHtml, /category_unknown/);

  const london = await CityPage({
    params: Promise.resolve({ city: "london" }),
  });
  const londonHtml = renderToStaticMarkup(london);
  assert.match(londonHtml, /data-city="london"/);
  assert.match(londonHtml, /data-empty-lane="true"/);

  const movers = await LanePage({
    params: Promise.resolve({ city: "london", category: "movers" }),
  });
  const moversHtml = renderToStaticMarkup(movers);
  assert.match(moversHtml, /data-category="movers"/);
  assert.match(moversHtml, /This lane is empty/);
  assert.match(moversHtml, />Outbid</);
});

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "lst_default",
    business: "Example Movers",
    category: "movers",
    city: "london",
    siteUrl: "https://example.com",
    licenseId: null,
    bidUsd: 20,
    weekId: "2026-08-17",
    createdAt: "2026-08-17T00:00:00.000Z",
    raisedAt: null,
    clicks: 0,
    hidden: false,
    hiddenReason: null,
    ...overrides,
  };
}

function ranked(overrides: Partial<RankedListing> = {}): RankedListing {
  const base = listing(overrides);
  return {
    ...base,
    rank: 1,
    siteHost: "example.com",
    ...overrides,
  };
}

function seedWeek(db: import("better-sqlite3").Database): void {
  ensureWeek(db, currentWeekId());
  ensureWeek(db, previousWeekId(currentWeekId()));
}

function insertListing(
  db: import("better-sqlite3").Database,
  row: {
    id: string;
    business: string;
    category: Listing["category"];
    city: string;
    siteUrl: string;
    bidUsd: number;
    clicks: number;
    weekId?: string;
  },
): void {
  const week = row.weekId ?? currentWeekId();
  ensureWeek(db, week);
  db.prepare(
    `INSERT INTO listings (
       id, business, category, city, site_url, license_id, bid_usd, week_id,
       created_at, raised_at, clicks, hidden, hidden_reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.business,
    row.category,
    row.city,
    row.siteUrl,
    null,
    row.bidUsd,
    week,
    "2026-08-17T00:00:00.000Z",
    null,
    row.clicks,
    0,
    null,
  );
}
