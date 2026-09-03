import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import {
  DEFAULT_CITY_SLUG,
  isProviderPaidListing,
  listCityLanes,
  listLane,
  rankLane,
  resolveCategory,
  resolveCity,
  type RankedListing,
} from "../src/board";
import {
  CATEGORIES,
  CATEGORY_SLUGS,
  categoryRequiresLicense,
  getCategory,
} from "../src/categories";
import { getCity } from "../src/cities";
import type { AppDb, Listing } from "../src/db";
import { openDatabase } from "../src/db";
import { currentWeekId, ensureWeek, nowUtc, ROLLING_WEEK_MS } from "../src/week";
import AboutPage from "../app/about/page";
import RulesPage from "../app/rules/page";
import { ClaimColumn } from "../src/ui/claim-column";
import { CityHub } from "../src/ui/city-hub";
import { LaneBoard } from "../src/ui/lane-board";
import { ListingCard } from "../src/ui/listing-card";
import { NotFoundCode } from "../src/ui/not-found-code";
import {
  clampAmount,
  minimumBidForForm,
  OutbidForm,
} from "../src/ui/outbid-form";

process.env.DATABASE_PATH = ":memory:";

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "lst_default",
    business: "London Local",
    category: "movers",
    city: "london",
    siteUrl: "https://example.com",
    licenseId: null,
    bidUsd: 20,
    weekId: "2026-08-17",
    createdAt: "2026-08-20T12:00:00.000Z",
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
    siteHost: new URL(base.siteUrl).host,
    ...overrides,
  };
}

function emptyLanes() {
  return {
    movers: [],
    dentists: [],
    immigration_lawyers: [],
    tutors: [],
  } as const;
}

function seedWeek(db: AppDb, weekId = currentWeekId()): void {
  ensureWeek(db, weekId);
}

function insertListing(
  db: AppDb,
  row: {
    id: string;
    business: string;
    category: Listing["category"];
    city: string;
    siteUrl: string;
    bidUsd: number;
    clicks?: number;
    weekId?: string;
    createdAt?: string;
    licenseId?: string | null;
    hidden?: boolean;
  },
): void {
  const weekId = row.weekId ?? currentWeekId();
  ensureWeek(db, weekId);
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
    row.licenseId ?? null,
    row.bidUsd,
    weekId,
    row.createdAt ?? nowUtc().toISOString(),
    null,
    row.clicks ?? 0,
    row.hidden ? 1 : 0,
    null,
  );
}

test("London is the v1 default city and unknown slugs never fall back", () => {
  assert.equal(DEFAULT_CITY_SLUG, "london");
  const london = resolveCity(DEFAULT_CITY_SLUG);
  assert.equal(london.ok, true);
  if (london.ok) assert.equal(london.value.display, "London");

  assert.deepEqual(resolveCity("manchester"), {
    ok: false,
    code: "city_unknown",
    status: 404,
  });
  assert.deepEqual(resolveCategory("plumbers"), {
    ok: false,
    code: "category_unknown",
    status: 404,
  });
  assert.equal(getCity("manchester"), undefined);
  assert.equal(getCategory("plumbers"), undefined);
});

test("the closed service taxonomy is exactly four desks with explicit license rules", () => {
  assert.deepEqual(CATEGORY_SLUGS, [
    "movers",
    "dentists",
    "immigration_lawyers",
    "tutors",
  ]);
  assert.equal(CATEGORIES.length, 4);
  assert.equal(categoryRequiresLicense("movers"), false);
  assert.equal(categoryRequiresLicense("tutors"), false);
  assert.equal(categoryRequiresLicense("dentists"), true);
  assert.equal(categoryRequiresLicense("immigration_lawyers"), true);
});

test("rank is the bid; older stamp wins ties and hidden/unpaid rows stay out", () => {
  const rows = rankLane([
    listing({
      id: "low",
      business: "Low",
      bidUsd: 15,
      createdAt: "2026-08-18T00:00:00.000Z",
    }),
    listing({
      id: "new-twenty",
      business: "New Twenty",
      bidUsd: 20,
      createdAt: "2026-08-18T00:00:00.000Z",
    }),
    listing({
      id: "old-twenty",
      business: "Old Twenty",
      bidUsd: 20,
      createdAt: "2026-08-17T00:00:00.000Z",
    }),
    listing({
      id: "hidden",
      business: "Hidden",
      bidUsd: 99,
      hidden: true,
    }),
    listing({
      id: "unpaid",
      business: "Unpaid",
      bidUsd: 100,
      createdAt: "",
    }),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.rank, row.id, row.bidUsd]),
    [
      [1, "old-twenty", 20],
      [2, "new-twenty", 20],
      [3, "low", 15],
    ],
  );
  assert.equal(isProviderPaidListing(listing()), true);
  assert.equal(isProviderPaidListing(listing({ createdAt: "" })), false);
});

test("listLane and listCityLanes read only visible rows in the rolling window", () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const weekId = currentWeekId();
  seedWeek(db, weekId);
  insertListing(db, {
    id: "inside",
    business: "Inside Window",
    category: "movers",
    city: "london",
    siteUrl: "https://inside.example",
    bidUsd: 20,
    createdAt: nowUtc().toISOString(),
  });
  insertListing(db, {
    id: "old",
    business: "Old Listing",
    category: "movers",
    city: "london",
    siteUrl: "https://old.example",
    bidUsd: 99,
    createdAt: new Date(nowUtc().getTime() - ROLLING_WEEK_MS - 1000).toISOString(),
  });
  insertListing(db, {
    id: "hidden",
    business: "Hidden Listing",
    category: "movers",
    city: "london",
    siteUrl: "https://hidden.example",
    bidUsd: 100,
    hidden: true,
    createdAt: nowUtc().toISOString(),
  });

  const lane = listLane("london", "movers", db);
  assert.deepEqual(lane.map((row) => row.id), ["inside"]);
  assert.equal(lane[0]?.clicks, 0);
  const lanes = listCityLanes("london", db);
  assert.deepEqual(lanes.dentists, []);
  assert.deepEqual(lanes.tutors, []);
});

test("unknown-city 404 chrome is explicit and honest", () => {
  const html = renderToStaticMarkup(
    createElement(NotFoundCode, { code: "city_unknown" }),
  );
  assert.match(html, /data-error="city_unknown"/);
  assert.match(html, /404/);
  assert.doesNotMatch(html, /★|⭐|rated|review count/i);
});

test("four empty lanes stay honest and Claim #1 leads the want-ad desk", () => {
  const london = getCity("london");
  assert.ok(london);
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: currentWeekId(),
      lanes: emptyLanes(),
    }),
  );

  assert.match(html, /class="paper classified paper-empty"/);
  assert.match(html, /data-paper-empty="true"/);
  assert.match(html, /data-window="rolling-seven-days"/);
  assert.match(html, /Local Service Weekly · London edition/);
  assert.match(html, /Rolling last 7 days\. Not Monday 00:00 Europe\/London\./);
  assert.match(html, /<h1 class="edition-city">London<\/h1>/);
  assert.match(html, /Rank is the bid/);
  assert.match(html, /data-hero-claim="true"/);
  assert.match(html, /data-slot="claim-hero"/);
  assert.match(html, /data-form-state="new"/);
  assert.match(html, /data-checkout-intent="place"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, /aria-label="Claim rank"[^>]*>Claim rank</);
  assert.match(html, /name="business"/);
  assert.match(html, /name="siteUrl"/);
  assert.match(html, /name="amount"/);
  assert.equal((html.match(/data-empty-lane="true"/g) ?? []).length, 4);
  assert.equal((html.match(/data-lane-empty="true"/g) ?? []).length, 4);
  assert.equal((html.match(/data-empty-honest=""/g) ?? []).length, 4);
  assert.equal((html.match(/No #1/g) ?? []).length, 4);
  assert.equal((html.match(/data-bid-form=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-listing-card/g) ?? []).length, 0);
  assert.doesNotMatch(html, /Call this #1|Call #2|data-later-call|data-prize/);
  assert.doesNotMatch(
    html,
    /★|⭐|top rated|review count|google map|map pin|placeholder provider/i,
  );
  for (const category of CATEGORY_SLUGS) {
    assert.match(html, new RegExp(`data-claim-column="${category}"`));
  }
});

test("occupied mixed paper keeps empty lanes honest", () => {
  const london = getCity("london");
  assert.ok(london);
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: currentWeekId(),
      lanes: {
        ...emptyLanes(),
        movers: [
          ranked({
            id: "lead",
            business: "North London Movers",
            bidUsd: 24,
            siteUrl: "https://north.example",
            createdAt: "2026-08-28T08:00:00.000Z",
          }),
          ranked({
            id: "later",
            business: "South London Movers",
            bidUsd: 15,
            siteUrl: "https://south.example",
            createdAt: "2026-08-28T09:00:00.000Z",
          }),
        ],
      },
    }),
  );

  assert.match(html, /class="paper classified paper-occupied"/);
  assert.match(html, /data-paper-occupied="true"/);
  assert.equal((html.match(/data-lane-occupied="true"/g) ?? []).length, 1);
  assert.equal((html.match(/data-lane-empty="true"/g) ?? []).length, 3);
  assert.equal((html.match(/local-ad-slip/g) ?? []).length, 2);
  assert.equal((html.match(/data-call-this-one/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-later/g) ?? []).length, 1);
  assert.equal((html.match(/data-later-call/g) ?? []).length, 1);
  assert.equal((html.match(/data-prize/g) ?? []).length, 1);
  assert.equal((html.match(/data-later-fact=""/g) ?? []).length, 2);
  assert.match(html, /North London Movers/);
  assert.match(html, /South London Movers/);
  assert.match(html, /Call this #1/);
  assert.match(html, /Call #2/);
  assert.match(html, /24/);
  assert.match(html, /15/);
  const claimAt = html.indexOf('data-slot="claim-support"');
  const businessAt = html.indexOf("North London Movers");
  const bidAt = html.indexOf("$24");
  assert.ok(businessAt >= 0 && bidAt > businessAt);
  const mastheadAt = html.indexOf('data-edition=""');
  const mastheadEnd = mastheadAt >= 0 ? html.indexOf("</header>", mastheadAt) : -1;
  const lanesAt = html.indexOf('data-classified-columns=""');
  const indexAt = html.indexOf('data-column-index-after=""');
  assert.ok(
    mastheadAt >= 0 &&
      mastheadEnd >= 0 &&
      mastheadEnd < claimAt &&
      claimAt < lanesAt,
  );
  assert.ok(lanesAt >= 0 && indexAt > lanesAt);
  assert.equal((html.match(/data-category-tabs=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-bid-form=""/g) ?? []).length, 1);
  assert.match(html, /data-new-listing=""/);
  assert.match(html, /data-form-state="new"/);
  assert.match(html, /action="\/api\/checkout"/);
  assert.match(html, /data-checkout-intent="place"/);
  assert.match(html, /data-slot="category-control"/);
  assert.doesNotMatch(html, /action="\/api\/raise"/);
  assert.match(html, /data-raise-difference=""/);
  assert.match(html, /A raise charges only the difference/);
  assert.doesNotMatch(html, /★|⭐|presentation|top-three|today-strip|activity-strip/i);
});

test("occupied paper keeps one first Call and one quiet claim route", () => {
  const london = getCity("london");
  assert.ok(london);
  const html = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: getCategory("movers")!,
      listings: [
        ranked({
          id: "first",
          business: "First Movers",
          bidUsd: 30,
          siteUrl: "https://first.example",
        }),
      ],
      showForm: true,
    }),
  );
  assert.equal((html.match(/data-call-this-one/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-click="call"/g) ?? []).length, 1);
  assert.equal((html.match(/data-later-claim/g) ?? []).length, 2);
  assert.match(html, /class="claim-route"/);
  assert.match(html, /data-raise-difference=""/);
  assert.match(html, /A raise charges only the difference, not a full rebid/);
  assert.match(html, /data-form-state="raise"/);
  assert.match(html, /data-raise-only=""/);
  assert.match(html, /Raise your listing to/);
  assert.match(html, /action="\/api\/raise"/);
  assert.match(html, /name="business"/);
  assert.match(html, /name="siteUrl"/);
  assert.doesNotMatch(html, /Call #2/);
});

test("unpaid and abandoned listings stay off the classified paper", () => {
  const london = getCity("london");
  assert.ok(london);
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: currentWeekId(),
      lanes: {
        ...emptyLanes(),
        movers: [
          ranked({
            id: "unpaid",
            business: "Unpaid Draft",
            createdAt: "",
            bidUsd: 99,
          }),
        ],
      },
    }),
  );
  assert.match(html, /class="paper classified paper-empty"/);
  assert.equal((html.match(/data-listing-card/g) ?? []).length, 0);
  assert.equal((html.match(/No #1/g) ?? []).length, 4);
  assert.doesNotMatch(html, /Unpaid Draft|Call this #1|data-prize/);
});

test("lane board empty state has no cards and no fabricated call", () => {
  const london = getCity("london");
  assert.ok(london);
  const html = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: getCategory("tutors")!,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(html, /data-empty-lane="true"/);
  assert.match(html, /No #1/);
  assert.match(html, /No paid listing in this desk yet/);
  assert.match(html, /Ratings and map position do not affect the board/);
  assert.match(html, /An incomplete checkout stays off the paper/);
  assert.match(html, /data-checkout-intent="place"/);
  assert.doesNotMatch(html, /data-listing-card|Call this #1|data-prize/);
});

test("ListingCard shows rank, business, site, $bid, real clicks, and claimed-license honesty", () => {
  const html = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "dentist-1",
        business: "Camden Dental",
        category: "dentists",
        siteUrl: "https://camden.example",
        siteHost: "camden.example",
        bidUsd: 125,
        clicks: 3,
        licenseId: "GDC-123",
      }),
    }),
  );
  assert.match(html, /data-provider-paid/);
  assert.match(html, /data-rank="1"/);
  assert.match(html, /data-bid-usd="125"/);
  assert.match(html, /\$125/);
  assert.match(html, /3 clicks/);
  assert.match(html, /camden\.example/);
  assert.match(html, /Claimed license GDC-123 \(not verified\)/);
  assert.match(html, /Call this #1/);
  assert.doesNotMatch(html, /★|⭐|rated|review count/i);

  const unpaid = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({ id: "draft", createdAt: "" }),
    }),
  );
  assert.equal(unpaid, "");
});

test("empty paper sends identity fields directly to one Claim rank submit", () => {
  const html = renderToStaticMarkup(
    createElement(OutbidForm, {
      city: "london",
      category: "movers",
      lockCity: true,
      lockCategory: true,
      emptyPaper: true,
      hero: true,
    }),
  );
  assert.match(html, /data-form-state="new"/);
  assert.match(html, /data-hero-form/);
  assert.match(html, /action="\/api\/checkout"/);
  assert.match(html, /data-checkout-intent="place"/);
  assert.match(html, /name="business"/);
  assert.match(html, /name="city"/);
  assert.match(html, /name="category"/);
  assert.match(html, /name="siteUrl"/);
  assert.match(html, /name="amount"/);
  assert.match(html, /type="text" inputMode="url"/);
  assert.match(html, /class="outbid"/);
  assert.match(html, /aria-label="Claim rank"[^>]*>Claim rank</);
  assert.doesNotMatch(html, />Outbid</);
  assert.match(html, /Increase bid by one dollar/);
  assert.match(html, /Decrease bid by one dollar/);
  assert.doesNotMatch(html, /data-raise-difference|data-raise-charge/);
});

test("claim and occupied forms post to their distinct payment intents", () => {
  const empty = renderToStaticMarkup(
    createElement(OutbidForm, {
      city: "london",
      category: "movers",
      lockCity: true,
      lockCategory: true,
      emptyPaper: true,
    }),
  );
  const occupied = renderToStaticMarkup(
    createElement(OutbidForm, {
      city: "london",
      category: "movers",
      lockCity: true,
      lockCategory: true,
      emptyPaper: false,
      topBidUsd: 20,
    }),
  );
  assert.match(empty, /action="\/api\/checkout"/);
  assert.match(empty, /data-checkout-intent="place"/);
  assert.match(occupied, /action="\/api\/raise"/);
  assert.match(occupied, /data-checkout-intent="raise"/);
  assert.match(occupied, /value="21"/);
  assert.match(occupied, /data-raise-difference/);
});

test("occupied raise controls share a top-plus-one floor", () => {
  const html = renderToStaticMarkup(
    createElement(OutbidForm, {
      city: "london",
      category: "movers",
      lockCity: true,
      lockCategory: true,
      emptyPaper: false,
      topBidUsd: 20,
    }),
  );

  assert.equal(minimumBidForForm(false, 20), 21);
  assert.equal(minimumBidForForm(true, 20), 5);
  assert.equal(minimumBidForForm(false, 999_999), 1_000_000);
  assert.equal(clampAmount(5, 21), 21);
  assert.equal(clampAmount(Number.NaN, 21), 21);
  assert.equal(clampAmount(1_000_000, 1_000_000), 999_999);
  assert.match(html, /data-amount-floor="21"/);
  assert.match(html, /type="number"/);
  assert.match(html, /min="21"/);
  assert.match(html, /max="999999"/);
  assert.match(html, /step="1"/);
  assert.match(html, /value="21"/);
  assert.match(html, /data-submit-ready="false"/);
  assert.match(html, /aria-label="Decrease bid by one dollar" disabled=""/);
});

test("occupied home form is a clear new-listing path, while raises stay lane-scoped", () => {
  const london = getCity("london");
  assert.ok(london);
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: currentWeekId(),
      lanes: {
        ...emptyLanes(),
        movers: [
          ranked({
            id: "lead",
            business: "North London Movers",
            bidUsd: 20,
            siteUrl: "https://north.example",
          }),
        ],
      },
    }),
  );

  assert.match(html, /New listing: choose a service desk/);
  assert.match(html, /If this site is already listed, use that desk/);
  assert.match(html, /data-new-listing=""/);
  assert.match(html, /action="\/api\/checkout"/);
  assert.match(html, /data-checkout-intent="place"/);
  assert.match(html, /data-slot="category-control"/);
  assert.doesNotMatch(html, /action="\/api\/raise"/);
  assert.match(html, /Outbid my movers column/);
});

test("occupied raise copy names difference-only — not a full rebid", () => {
  const html = renderToStaticMarkup(
    createElement(OutbidForm, {
      city: "london",
      category: "movers",
      lockCity: true,
      lockCategory: true,
      emptyPaper: false,
      topBidUsd: 20,
    }),
  );
  assert.match(html, /Raise charge: \$1/);
  assert.match(html, /only the difference, not a full rebid/);
  assert.match(html, /An incomplete checkout stays off the board/);
  assert.match(html, /A new listing is charged its full bid/);
});

test("GET / default page is the London hub", () => {
  const source = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");
  assert.match(source, /DEFAULT_CITY_SLUG/);
  assert.match(source, /<CityHub/);
});

test("city and lane pages 404 unknown slugs", () => {
  const cityPage = readFileSync(
    join(process.cwd(), "app", "c", "[city]", "page.tsx"),
    "utf8",
  );
  const lanePage = readFileSync(
    join(process.cwd(), "app", "c", "[city]", "[category]", "page.tsx"),
    "utf8",
  );
  assert.match(cityPage, /city_unknown/);
  assert.match(lanePage, /city_unknown/);
  assert.match(lanePage, /category_unknown/);
  assert.match(lanePage, /emptyPaper=\{!occupied\}/);
  assert.match(lanePage, /OutbidForm/);
});

test("occupied week window is rolling last-7-days — not Monday 00:00 Europe/London", () => {
  const london = getCity("london");
  assert.ok(london);
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: "2026-08-17",
      lanes: {
        ...emptyLanes(),
        movers: [
          ranked({
            id: "rolling",
            business: "Rolling Movers",
            createdAt: "2026-08-27T10:00:00.000Z",
          }),
        ],
      },
    }),
  );
  assert.match(html, /data-window="rolling-seven-days"/);
  assert.match(html, /Rolling last 7 days/);
  assert.doesNotMatch(html, /week-window|24h lock/i);
});

test("empty paper copy is rolling last-7-days — not Monday 00:00 Europe/London", () => {
  const london = getCity("london");
  assert.ok(london);
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: currentWeekId(),
      lanes: emptyLanes(),
    }),
  );
  assert.match(html, /Rolling last 7 days/);
  assert.doesNotMatch(html, /Week of |week-window|data-rolling-week/i);
});

test("site header, about, and rules all explain the seven-day window publicly", () => {
  const layout = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");
  const about = renderToStaticMarkup(createElement(AboutPage));
  const rules = renderToStaticMarkup(createElement(RulesPage));
  assert.match(layout, /Last 7 days/);
  assert.match(about, /eligible for seven days/);
  assert.match(rules, /Rolling seven-day window/);
  assert.match(rules, /does not reset for everyone at Monday midnight/);
  assert.match(rules, /cleaned website, category, and city/);
  assert.doesNotMatch(about + rules, /outbid\.lol|local-service-weekly|\bclone\b|\bv1\b|\bfixture\b|weekId|createdAt|paidAt|Waffo/i);
});

test("the ordinary renderer and runtime shell contain no shared reference fixture", () => {
  const files = [
    "app/layout.tsx",
    "src/ui/city-hub.tsx",
    "src/ui/edition.tsx",
    "src/ui/lane-board.tsx",
    "src/ui/listing-card.tsx",
    "src/ui/outbid-form.tsx",
    "src/ui/claim-column.tsx",
    "src/ui/column-index.tsx",
  ];
  const source = files
    .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /OUTBID_|OutbidReferenceActivity|REFERENCE_RAIL/);
  assert.doesNotMatch(source, /HeaderPeriodTabs|SearchPopover|parity\.css|outbid-mark/);
  assert.doesNotMatch(source, /presentation-card|today-strip|activity-strip|top-three|data-display-rank/);
});

test("classified CSS owns the dark canvas, tan stock, four columns, and responsive paper", () => {
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  assert.match(css, /background:\s*#2b241b/);
  assert.match(css, /--paper:\s*#f4ead0/);
  assert.match(css, /border-bottom:\s*4px double/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /local-ad-slip/);
  assert.match(css, /text-decoration: underline dashed/);
  assert.match(css, /\.step[\s\S]*min-height:\s*2\.75rem/);
  assert.doesNotMatch(css, /presentation|today-strip|activity-strip|reference-rail|outbid-mark/i);
});

test("hub claim links keep the four local routes and no target rail", () => {
  const html = renderToStaticMarkup(
    createElement(ClaimColumn, {
      city: "london",
      emptyPaper: true,
      visualOnly: true,
    }),
  );
  for (const category of CATEGORY_SLUGS) {
    assert.match(html, new RegExp(`/c/london/${category}#claim`));
  }
  assert.equal((html.match(/data-claim-column=/g) ?? []).length, 4);
  assert.doesNotMatch(html, /rail|reference|see\.io|tutti\.so|joni\.ai/i);
});
