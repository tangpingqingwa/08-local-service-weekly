import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { currentWeekId, ensureWeek, formatWeekLabel, previousWeekId } from "../src/week";
import { ClaimColumn } from "../src/ui/claim-column";
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
  const weekId = currentWeekId();
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId,
      lanes: {
        movers: [],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  assert.match(html, /data-city="london"/);
  assert.match(html, /data-classified=""/);
  assert.match(html, /data-edition=""/);
  assert.match(html, /data-classified-columns=""/);
  assert.match(html, /This week(?:&apos;|&#x27;|')s local classified/);
  assert.match(html, new RegExp(`data-edition-week="${weekId}"`));
  assert.match(html, new RegExp(formatWeekLabel(weekId)));
  assert.match(html, /<h1 class="edition-city">London<\/h1>/);
  assert.match(html, /Rank is the bid/);
  assert.match(html, /data-claim-pick/);
  assert.match(html, /claim-first-click/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, /Then pick the column/);
  assert.match(html, /class="claim-columns claim-next"/);
  assert.doesNotMatch(html, /Outbid my movers column/);
  assert.doesNotMatch(html, /data-category-tabs/);
  assert.doesNotMatch(html, /data-column-index-after/);
  assert.doesNotMatch(html, /aria-label="Classified columns"/);
  const editionClose = html.indexOf("</header>");
  assert.ok(editionClose > -1);
  assert.equal(html.slice(0, editionClose).includes("data-category-tabs"), false);
  const editionEnd = html.indexOf("data-classified-columns");
  const claimAt = html.indexOf("data-claim-pick");
  const firstLane = html.indexOf("data-lane");
  const firstEmpty = html.indexOf('data-empty-lane="true"');
  const firstClick = html.indexOf("claim-first-click");
  const firstClaim = html.indexOf("Claim #1 for");
  const firstPick = html.indexOf("Then pick the column");
  assert.ok(editionEnd > -1 && firstLane > editionEnd);
  assert.ok(claimAt > firstLane);
  assert.ok(firstEmpty > -1 && firstEmpty < claimAt);
  assert.ok(firstClick > firstEmpty);
  assert.ok(firstClaim > firstEmpty && firstPick > firstClaim);
  assert.ok(firstClick < firstPick);
  assert.ok(html.indexOf("data-bid-form") === -1 || html.indexOf("data-bid-form") > editionEnd);
  assert.doesNotMatch(html, /name="business"/);
  assert.doesNotMatch(html, /name="siteUrl"/);
  assert.doesNotMatch(html, /class="fields want-ad-fields"/);
  for (const category of CATEGORY_SLUGS) {
    assert.match(html, new RegExp(`data-category="${category}"`));
    assert.match(html, new RegExp(`data-claim-column="${category}"`));
    assert.match(html, new RegExp(`data-claim-job="${category}"`));
    assert.match(
      html,
      new RegExp(`href="/c/london/${category}#claim"`),
    );
  }
  const firstClickHops = html.match(/claim-first-click/g) ?? [];
  assert.equal(firstClickHops.length, 1);
  assert.equal((html.match(/class="outbid claim-first-click"/g) ?? []).length, 1);
  assert.equal((html.match(/class="outbid"/g) ?? []).length, 0);
  const emptyLanes = html.match(/data-empty-lane="true"/g) ?? [];
  assert.equal(emptyLanes.length, 4);
  const honestLanes = html.match(/data-empty-honest=""/g) ?? [];
  assert.equal(honestLanes.length, 4);
  assert.match(html, /No #1/);
  assert.match(html, /This lane is empty\. Rank is the bid\. No stars\. No map\./);
  assert.equal((html.match(/No #1/g) ?? []).length, 4);
  assert.doesNotMatch(html, /data-listing-card/);
  assert.doesNotMatch(html, /Call this #1/);
  assert.doesNotMatch(html, /data-call-this-one/);
  assert.doesNotMatch(html, /Call #2/);
  assert.doesNotMatch(html, /data-call-later/);
  assert.doesNotMatch(html, /data-call-later-quiet/);
  assert.doesNotMatch(html, /data-call-ad="later"/);
  assert.doesNotMatch(html, /data-claim-after-call|after Call #|after Call this #1/);
  assert.doesNotMatch(html, /data-claim-after-call-one/);
  assert.doesNotMatch(html, /data-claim-after-call-two/);
  assert.doesNotMatch(html, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(html, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(html, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(html, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(html, /data-call-after-claim-one/);
  assert.doesNotMatch(html, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(html, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(html, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(html, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(html, /★|⭐|&star;|rated\s+\d|review count|top rated/i);
  assert.doesNotMatch(html, /North London Movers|placeholder provider/i);
  assert.doesNotMatch(html, /top rated in London|google map|★/i);
  assert.doesNotMatch(html, /data-prize/);
  assert.doesNotMatch(html, /data-later-fact|later-facts|later-fact/);
});

test("four empty lanes stay honest after Claim #1 is the first click", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const emptyLane = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(emptyLane, /data-empty-lane="true"/);
  assert.match(emptyLane, /data-empty-honest=""/);
  assert.match(emptyLane, /<p class="empty-answer">No #1<\/p>/);
  assert.match(emptyLane, /This lane is empty\. Rank is the bid\. No stars\. No map\./);
  assert.match(emptyLane, />Outbid</);
  assert.match(emptyLane, /Claim #1 for/);
  assert.match(emptyLane, /data-bid-form/);
  const honestAt = emptyLane.indexOf('data-empty-honest=""');
  const formAt = emptyLane.indexOf("data-bid-form");
  assert.ok(honestAt >= 0 && formAt > honestAt);
  assert.doesNotMatch(emptyLane, /Call this #1|Call #2|data-call-later|data-call-later-quiet|data-call-ad|data-prize/);
  assert.doesNotMatch(emptyLane, /data-later-fact|later-facts|later-fact/);
  assert.doesNotMatch(emptyLane, /data-claim-after-call|after Call this #1|after the claim hop/);
  assert.doesNotMatch(emptyLane, /★|⭐|review count|google map|map pin|leaflet/i);

  const emptyHub = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: currentWeekId(),
      lanes: {
        movers: [],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  assert.equal((emptyHub.match(/data-empty-lane="true"/g) ?? []).length, 4);
  assert.equal((emptyHub.match(/data-empty-honest=""/g) ?? []).length, 4);
  assert.equal((emptyHub.match(/No #1/g) ?? []).length, 4);
  assert.match(emptyHub, /claim-first-click/);
  assert.match(emptyHub, /Then pick the column/);
  const firstHonest = emptyHub.indexOf('data-empty-honest=""');
  const firstClick = emptyHub.indexOf("claim-first-click");
  assert.ok(firstHonest >= 0 && firstClick > firstHonest);
  assert.doesNotMatch(emptyHub, /Call this #1|data-call-this-one|data-prize|data-listing-card/);
  assert.doesNotMatch(emptyHub, /data-later-fact|later-facts|later-fact/);
  assert.doesNotMatch(emptyHub, /data-category-tabs|data-column-index-after/);
  assert.doesNotMatch(emptyHub, /★|⭐|google map|map pin/i);

  const occupiedHub = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: currentWeekId(),
      lanes: {
        movers: [
          ranked({
            id: "lst_movers",
            business: "North London Movers",
            bidUsd: 20,
            siteHost: "north.example",
          }),
          ranked({
            id: "lst_south",
            rank: 2,
            business: "South London Movers",
            bidUsd: 15,
            siteHost: "south.example",
          }),
        ],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  assert.match(occupiedHub, /Call this #1/);
  assert.match(occupiedHub, /Call #2/);
  assert.match(occupiedHub, /data-prize=""/);
  assert.match(occupiedHub, /data-later-fact=""/);
  assert.match(occupiedHub, /class="later-facts"/);
  assert.equal((occupiedHub.match(/data-later-fact=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupiedHub, /class="bid later-fact"/);
  assert.equal((occupiedHub.match(/data-empty-honest=""/g) ?? []).length, 3);
  assert.equal((occupiedHub.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupiedHub.match(/data-call-later=""/g) ?? []).length, 1);
  const moversLane = occupiedHub.match(
    /<section class="lane classified-column"[^>]*data-category="movers"[\s\S]*?<\/section>/,
  );
  assert.ok(moversLane);
  assert.match(moversLane[0], /Call this #1/);
  assert.match(moversLane[0], /Call #2/);
  assert.doesNotMatch(moversLane[0], /data-empty-honest|No #1/);
  assert.doesNotMatch(occupiedHub, /name="business"/);
  assert.doesNotMatch(occupiedHub, /claim-first-click|Then pick the column/);
  const occupiedCall = occupiedHub.indexOf("Call this #1");
  const occupiedTabs = occupiedHub.indexOf("data-category-tabs");
  const occupiedAfter = occupiedHub.indexOf("data-column-index-after");
  const occupiedHeaderEnd = occupiedHub.indexOf("</header>");
  assert.ok(occupiedCall >= 0 && occupiedTabs > occupiedCall);
  assert.ok(occupiedAfter > occupiedCall);
  assert.ok(occupiedHeaderEnd >= 0 && occupiedTabs > occupiedHeaderEnd);
  assert.equal((occupiedHub.match(/data-category-tabs/g) ?? []).length, 1);
  assert.doesNotMatch(occupiedHub.slice(0, occupiedHeaderEnd), /data-category-tabs/);
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
  assert.match(html, /data-empty-honest=""/);
  assert.match(html, /No #1/);
  assert.match(html, /This lane is empty/);
  assert.match(html, /No stars\. No map\./);
  assert.match(html, />Outbid</);
  assert.doesNotMatch(html, /data-listing-card/);
  assert.doesNotMatch(html, /data-prize/);
  assert.doesNotMatch(html, /data-later-fact|later-facts|later-fact/);
  assert.doesNotMatch(html, /Call this #1|Call #2|data-call-later|data-call-later-quiet|data-call-ad/);
  assert.doesNotMatch(html, /data-claim-after-call|after Call #|after Call this #1/);
  assert.doesNotMatch(html, /data-claim-after-call-one/);
  assert.doesNotMatch(html, /data-claim-after-call-two/);
  assert.doesNotMatch(html, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(html, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(html, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(html, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(html, /data-call-after-claim-one/);
  assert.doesNotMatch(html, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(html, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(html, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(html, /data-call-after-claim-five|call-after-claim-five/);
});

test("rank card shows $bid, public clicks placeholder 0, and host", () => {
  const html = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_movers",
        business: "North London Movers",
        bidUsd: 20,
        clicks: 0,
        siteUrl: "https://example.com/van",
        siteHost: "example.com",
      }),
    }),
  );
  assert.match(html, /data-rank="1"/);
  assert.match(html, /data-classified-ad=""/);
  assert.match(html, /data-call-ad="lead"/);
  assert.match(html, /data-call-this-one=""/);
  assert.match(html, /data-call-after-claim-one=""/);
  assert.match(html, /data-call-after-claim-two=""/);
  assert.match(html, /data-call-after-claim-three=""/);
  assert.match(html, /data-call-after-claim-four=""/);
  assert.match(html, /data-call-after-claim-five=""/);
  assert.match(html, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(html, /Call this #1/);
  assert.equal((html.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.ok(
    Math.abs(html.indexOf('data-call-after-claim-two=""') - html.indexOf('data-call-after-claim-one=""')) < 80,
  );
  assert.ok(
    Math.abs(html.indexOf('data-call-after-claim-three=""') - html.indexOf('data-call-after-claim-two=""')) < 80,
  );
  assert.ok(
    Math.abs(html.indexOf('data-call-after-claim-four=""') - html.indexOf('data-call-after-claim-three=""')) < 80,
  );
  assert.ok(
    Math.abs(html.indexOf('data-call-after-claim-five=""') - html.indexOf('data-call-after-claim-four=""')) < 80,
  );
  assert.match(html, /#1/);
  assert.match(html, /North London Movers/);
  assert.match(html, /\$20/);
  assert.match(html, /0 clicks/);
  assert.match(html, /example.com/);
  assert.match(html, /href="\/go\/lst_movers"/);
  assert.match(html, /London/);
  assert.match(html, /Movers/);
  const callAt = html.indexOf("Call this #1");
  const bidAt = html.indexOf("$20");
  const outbidAt = html.indexOf("Outbid");
  assert.ok(callAt >= 0 && bidAt > callAt);
  assert.equal(outbidAt, -1);
  assert.doesNotMatch(html, /★|⭐|rated|review/i);
  assert.doesNotMatch(html, /top rated|map pin|yelp/i);

  const dentist = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_dentist",
        business: "Soho Smile",
        category: "dentists",
        licenseId: "GDC-12345",
        siteHost: "soho.example",
      }),
    }),
  );
  assert.match(dentist, /Soho Smile/);
  assert.match(dentist, /Dentists/);
  assert.match(dentist, /Call this #1/);
  assert.match(dentist, /Claimed license GDC-12345 \(not verified\)/);
  assert.doesNotMatch(dentist, /verified license|license verified/i);
});

test("occupied #1 names the business as the prize before $bid", () => {
  const html = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_movers",
        business: "North London Movers",
        bidUsd: 20,
        clicks: 4,
        siteHost: "north.example",
      }),
    }),
  );
  const prizeAt = html.indexOf('data-prize=""');
  const nameAt = html.indexOf("North London Movers");
  const bidAt = html.indexOf("$20");
  const clicksAt = html.indexOf("4 clicks");
  const callAt = html.indexOf("Call this #1");
  assert.match(html, /data-rank="1"/);
  assert.match(html, /<h3 class="business" data-prize="">North London Movers<\/h3>/);
  assert.ok(prizeAt >= 0 && nameAt >= 0 && nameAt < bidAt);
  assert.ok(prizeAt < bidAt && prizeAt < clicksAt);
  assert.ok(callAt > nameAt && bidAt > callAt && clicksAt > bidAt);
  assert.match(html, /data-bid=""/);
  assert.match(html, /data-clicks=""/);
  assert.match(html, /class="later-facts"/);
  assert.match(html, /data-later-fact=""/);
  assert.doesNotMatch(html, /class="bid later-fact"/);
  const laterFactAt = html.indexOf('data-later-fact=""');
  const factsAt = html.indexOf('class="later-facts"');
  assert.ok(laterFactAt > callAt && factsAt >= 0);
  assert.ok(bidAt > laterFactAt && clicksAt > bidAt);
  assert.equal((html.match(/data-later-fact=""/g) ?? []).length, 1);
  assert.doesNotMatch(html, /★|⭐|review count|google map|map pin/i);
  assert.doesNotMatch(html, /data-call-after-claim-six|data-claim-after-call-six/);

  const later = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        clicks: 1,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(later, /data-rank="2"/);
  assert.match(later, /Call #2/);
  assert.match(later, /class="host call-later"/);
  assert.doesNotMatch(later, /data-prize/);
  assert.doesNotMatch(later, /data-later-fact|later-facts|later-fact/);
  assert.doesNotMatch(later, /Call this #1|data-call-this-one/);
  assert.match(later, /data-call-later-quiet=""/);
  const laterName = later.indexOf("South London Movers");
  const laterCall = later.indexOf("Call #2");
  const laterBid = later.indexOf("$15");
  assert.ok(laterName >= 0 && laterCall > laterName && laterBid > laterCall);
});

test("occupied #1 $bid stays a later fact in grouping, not a muted stamp on the same $bid span", () => {
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  const prizeSize = css.match(
    /\.card\[data-call-ad="lead"\] \.business\[data-prize\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterFacts = css.match(
    /\.card\[data-call-ad="lead"\] \.later-facts\[data-later-fact\]\s*\{([^}]*)\}/,
  );
  assert.ok(prizeSize);
  assert.ok(laterFacts);
  const bidSize = laterFacts[1].match(/font-size:\s*([\d.]+)rem/);
  assert.ok(bidSize);
  assert.ok(Number(prizeSize[1]) > Number(bidSize[1]));
  assert.match(laterFacts[1], /color:\s*var\(--muted\)/);
  assert.match(laterFacts[1], /font-weight:\s*500/);
  assert.doesNotMatch(laterFacts[1], /color:\s*var\(--accent\)/);
  assert.doesNotMatch(css, /\.bid\.later-fact\[data-later-fact\]/);
  assert.match(css, /empty-lane\[data-empty-honest\] \[data-later-fact\]/);
  assert.match(css, /empty-lane\[data-empty-honest\] \.later-facts/);

  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-honest=""/);
  assert.match(empty, /No #1/);
  assert.match(empty, /No stars\. No map\./);
  assert.doesNotMatch(empty, /data-later-fact|later-facts|later-fact/);
  assert.doesNotMatch(empty, /data-prize|Call this #1|data-call-this-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-six|data-claim-after-call-six/);

  const onlyCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_movers",
        business: "North London Movers",
        bidUsd: 20,
        clicks: 4,
        siteHost: "north.example",
      }),
    }),
  );
  const prizeAt = onlyCard.indexOf('data-prize=""');
  const nameAt = onlyCard.indexOf("North London Movers");
  const callAt = onlyCard.indexOf("Call this #1");
  const factsAt = onlyCard.indexOf('class="later-facts"');
  const laterFactAt = onlyCard.indexOf('data-later-fact=""');
  const bidAt = onlyCard.indexOf("$20");
  const clicksAt = onlyCard.indexOf("4 clicks");
  assert.ok(prizeAt >= 0 && nameAt >= 0 && callAt > nameAt);
  assert.ok(factsAt > callAt && laterFactAt > callAt);
  assert.ok(bidAt > laterFactAt && clicksAt > bidAt);
  assert.match(onlyCard, /<h3 class="business" data-prize="">North London Movers<\/h3>/);
  assert.match(onlyCard, /class="later-facts"/);
  assert.match(onlyCard, /data-later-fact=""/);
  assert.match(onlyCard, /class="bid"/);
  assert.match(onlyCard, /data-call-this-one=""/);
  assert.match(onlyCard, /Call this #1/);
  assert.doesNotMatch(onlyCard, /class="bid later-fact"/);
  const onlyMetaBid = onlyCard.indexOf('data-bid=""');
  const onlyFactsClose = onlyCard.indexOf("</p>", factsAt);
  assert.ok(onlyMetaBid > factsAt && onlyMetaBid < onlyFactsClose);
  assert.match(onlyCard, /<p class="later-facts" data-later-fact="">/);
  assert.equal((onlyCard.match(/data-later-fact=""/g) ?? []).length, 1);
  assert.equal((onlyCard.match(/class="later-facts"/g) ?? []).length, 1);
  assert.doesNotMatch(onlyCard, /data-call-later-quiet|Call #2/);
  assert.doesNotMatch(onlyCard, /data-call-after-claim-six|data-claim-after-call-six/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        clicks: 1,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /class="bid"/);
  assert.match(laterCard, /Call #2/);
  assert.match(laterCard, /data-call-later-quiet=""/);
  const laterMeta = laterCard.indexOf('class="meta"');
  const laterMetaBid = laterCard.indexOf('data-bid=""');
  const laterMetaClicks = laterCard.indexOf('data-clicks=""');
  assert.ok(laterMeta >= 0 && laterMetaBid > laterMeta && laterMetaClicks > laterMetaBid);
  assert.doesNotMatch(laterCard, /data-later-fact|later-facts|later-fact/);
  assert.doesNotMatch(laterCard, /data-prize|Call this #1|data-call-this-one/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          clicks: 4,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          clicks: 1,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const lead = occupied.slice(leadStart, laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /data-prize=""/);
  assert.match(lead, /class="later-facts"/);
  assert.match(lead, /data-later-fact=""/);
  assert.match(lead, /Call this #1/);
  assert.doesNotMatch(lead, /class="bid later-fact"/);
  assert.match(later, /Call #2/);
  assert.match(later, /class="bid"/);
  assert.doesNotMatch(later, /data-later-fact|later-facts|later-fact|data-prize/);
  const occupiedPrize = occupied.indexOf('data-prize=""');
  const occupiedName = occupied.indexOf("North London Movers");
  const occupiedCall = occupied.indexOf("Call this #1");
  const occupiedFacts = occupied.indexOf('class="later-facts"');
  const occupiedLaterFact = occupied.indexOf('data-later-fact=""');
  const occupiedBid = occupied.indexOf("$20");
  const occupiedLaterCall = occupied.indexOf("Call #2");
  const occupiedTabs = occupied.indexOf("data-category-tabs");
  const occupiedForm = occupied.indexOf("data-bid-form");
  assert.ok(occupiedPrize >= 0 && occupiedName >= 0 && occupiedCall > occupiedName);
  assert.ok(occupiedFacts > occupiedCall && occupiedLaterFact > occupiedCall);
  assert.ok(occupiedBid > occupiedLaterFact && occupiedLaterCall > occupiedBid);
  assert.ok(occupiedForm > occupiedLaterCall);
  assert.equal((occupied.match(/data-later-fact=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="later-facts"/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="bid later-fact"/g) ?? []).length, 0);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.match(occupied, /after Call this #1/);
  assert.doesNotMatch(occupied, /data-empty-honest|No #1/);
  assert.doesNotMatch(occupied, /data-call-after-claim-six|data-claim-after-call-six/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
  assert.equal(occupiedTabs, -1);

  const hub = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: currentWeekId(),
      lanes: {
        movers: [
          ranked({
            id: "lst_movers",
            business: "North London Movers",
            bidUsd: 20,
            siteHost: "north.example",
          }),
          ranked({
            id: "lst_south",
            rank: 2,
            business: "South London Movers",
            bidUsd: 15,
            siteHost: "south.example",
          }),
        ],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  assert.match(hub, /data-prize=""/);
  assert.match(hub, /class="later-facts"/);
  assert.match(hub, /data-later-fact=""/);
  assert.doesNotMatch(hub, /class="bid later-fact"/);
  const hubPrize = hub.indexOf('data-prize=""');
  const hubName = hub.indexOf("North London Movers");
  const hubCall = hub.indexOf("Call this #1");
  const hubFacts = hub.indexOf('class="later-facts"');
  const hubBid = hub.indexOf("$20");
  const hubTabs = hub.indexOf("data-category-tabs");
  const hubAfter = hub.indexOf("data-column-index-after");
  const hubHeader = hub.indexOf("</header>");
  assert.ok(hubPrize >= 0 && hubName >= 0 && hubCall > hubName);
  assert.ok(hubFacts > hubCall && hubBid > hubFacts);
  assert.ok(hubTabs > hubCall && hubAfter > hubCall);
  assert.ok(hubHeader >= 0 && hubTabs > hubHeader);
  assert.equal((hub.match(/data-later-fact=""/g) ?? []).length, 1);
  assert.equal((hub.match(/class="later-facts"/g) ?? []).length, 1);
  assert.equal((hub.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((hub.match(/data-empty-honest=""/g) ?? []).length, 3);
  assert.match(hub, /No #1/);
  assert.match(hub, /No stars\. No map\./);
  assert.doesNotMatch(hub, /claim-first-click|Then pick the column/);
  assert.doesNotMatch(hub.slice(hub.indexOf('data-rank="2"')), /data-later-fact|later-facts|data-prize/);
  assert.doesNotMatch(hub, /★|⭐|review count|google map|map pin/i);
});

test("occupied later ranks stamp Call #N ahead of $bid, not another Call this #1", () => {
  const later = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(later, /data-rank="2"/);
  assert.match(later, /data-call-ad="later"/);
  assert.match(later, /data-call-later=""/);
  assert.match(later, /data-call-later-quiet=""/);
  assert.match(later, /Call #2/);
  assert.match(later, /href="\/go\/lst_south"/);
  assert.match(later, /south.example/);
  assert.match(later, /\$15/);
  const callAt = later.indexOf("Call #2");
  const bidAt = later.indexOf("$15");
  assert.ok(callAt >= 0 && bidAt > callAt);
  assert.doesNotMatch(later, /Call this #1/);
  assert.doesNotMatch(later, /data-call-this-one/);
  assert.doesNotMatch(later, /data-call-ad="lead"/);
  assert.doesNotMatch(later, /data-claim-after-call|after Call #/);
  assert.doesNotMatch(later, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(later, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(later, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(later, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(later, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(later, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(later, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(later, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five/);

  const third = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_rival",
        rank: 3,
        business: "Rival Van",
        bidUsd: 5,
        siteHost: "rival.example",
      }),
    }),
  );
  assert.match(third, /data-rank="3"/);
  assert.match(third, /Call #3/);
  assert.match(third, /data-call-later=""/);
  assert.match(third, /data-call-later-quiet=""/);
  assert.match(third, /href="\/go\/lst_rival"/);
  const thirdCall = third.indexOf("Call #3");
  const thirdBid = third.indexOf("$5");
  assert.ok(thirdCall >= 0 && thirdBid > thirdCall);
  assert.doesNotMatch(third, /Call this #1|Call #2|data-call-this-one/);
  assert.doesNotMatch(later, /data-prize/);
  assert.doesNotMatch(third, /data-prize/);
});

test("occupied hub makes calling the paid #1 the neighbor move", () => {
  const london = getCity("london");
  assert.ok(london);
  const weekId = currentWeekId();
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId,
      lanes: {
        movers: [
          ranked({
            id: "lst_movers",
            business: "North London Movers",
            bidUsd: 20,
            siteHost: "north.example",
          }),
        ],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  assert.match(html, /data-call-ad="lead"/);
  assert.match(html, /data-call-this-one=""/);
  assert.match(html, /data-call-after-claim-one=""/);
  assert.match(html, /data-call-after-claim-two=""/);
  assert.match(html, /data-call-after-claim-three=""/);
  assert.match(html, /data-call-after-claim-four=""/);
  assert.match(html, /data-call-after-claim-five=""/);
  assert.match(html, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(html, /Call this #1/);
  assert.match(html, /href="\/go\/lst_movers"/);
  assert.equal((html.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.match(html, /North London Movers/);
  assert.match(html, /\$20/);
  const prizeAt = html.indexOf('data-prize=""');
  const nameAt = html.indexOf("North London Movers");
  const bidAt = html.indexOf("$20");
  const factsAt = html.indexOf('class="later-facts"');
  assert.ok(prizeAt >= 0 && nameAt >= 0 && prizeAt < bidAt && nameAt < bidAt);
  assert.ok(factsAt > nameAt && factsAt < bidAt);
  assert.equal((html.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-later-fact=""/g) ?? []).length, 1);
  assert.doesNotMatch(html, /class="bid later-fact"/);
  const emptyLanes = html.match(/data-empty-lane="true"/g) ?? [];
  assert.equal(emptyLanes.length, 3);
  const honestLanes = html.match(/data-empty-honest=""/g) ?? [];
  assert.equal(honestLanes.length, 3);
  assert.match(html, /data-category="movers"/);
  assert.match(html, /data-listing-id="lst_movers"/);
  assert.doesNotMatch(
    html,
    /data-category="movers"[\s\S]{0,400}data-empty-lane="true"/,
  );
  assert.doesNotMatch(
    html,
    /data-category="movers"[\s\S]{0,800}data-empty-honest/,
  );
  const callAt = html.indexOf("Call this #1");
  const claimAfter = html.indexOf('data-claim-after-call=""');
  const claimOne = html.indexOf('data-claim-after-call-one=""');
  const claimTwo = html.indexOf('data-claim-after-call-two=""');
  const claimThree = html.indexOf('data-claim-after-call-three=""');
  const claimFour = html.indexOf('data-claim-after-call-four=""');
  const claimFive = html.indexOf('data-claim-after-call-five=""');
  const claimAt = html.indexOf("data-claim-pick");
  const outbidAt = html.indexOf("Outbid my movers column");
  assert.ok(callAt >= 0 && claimAfter > callAt);
  assert.ok(claimOne > callAt);
  assert.ok(claimTwo > callAt);
  assert.ok(claimThree > callAt);
  assert.ok(claimFour > callAt);
  assert.ok(claimFive > callAt);
  assert.ok(Math.abs(claimTwo - claimOne) < 80);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(Math.abs(claimFour - claimThree) < 80);
  assert.ok(Math.abs(claimFive - claimFour) < 80);
  assert.ok(claimAt > claimAfter);
  assert.ok(outbidAt > -1 && outbidAt < claimAt);
  assert.match(html, /after Call this #1/);
  assert.match(html, /href="\/c\/london\/movers#claim"/);
  assert.match(html, /data-category-tabs/);
  assert.match(html, /data-column-index-after=""/);
  assert.match(html, /Pick one column/);
  assert.doesNotMatch(html, /claim-first-click|Then pick the column/);
  const tabsAt = html.indexOf("data-category-tabs");
  const afterAt = html.indexOf("data-column-index-after");
  const headerEnd = html.indexOf("</header>");
  assert.ok(callAt >= 0 && tabsAt > callAt);
  assert.ok(afterAt > callAt && afterAt < claimAt);
  assert.ok(headerEnd >= 0 && tabsAt > headerEnd);
  assert.equal((html.match(/data-category-tabs/g) ?? []).length, 1);
  assert.doesNotMatch(html.slice(0, headerEnd), /data-category-tabs/);
  assert.equal((html.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(html, /★|⭐|review count|google map|map pin/i);
  assert.doesNotMatch(html, /name="business"/);
  assert.doesNotMatch(html, /Call #2/);
  assert.doesNotMatch(html, /data-call-later/);
  assert.doesNotMatch(html, /data-call-later-quiet/);
  assert.doesNotMatch(html, /after Call #2/);
  assert.doesNotMatch(html, /data-call-after-claim=""|after the claim hop/);
});

test("occupied hub later ranks stamp Call #N; empty lanes stay honest", () => {
  const london = getCity("london");
  assert.ok(london);
  const weekId = currentWeekId();
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId,
      lanes: {
        movers: [
          ranked({
            id: "lst_movers",
            business: "North London Movers",
            bidUsd: 20,
            siteHost: "north.example",
          }),
          ranked({
            id: "lst_south",
            rank: 2,
            business: "South London Movers",
            bidUsd: 15,
            siteHost: "south.example",
          }),
        ],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  assert.match(html, /data-call-ad="lead"/);
  assert.match(html, /Call this #1/);
  assert.match(html, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.equal((html.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.match(html, /data-call-ad="later"/);
  assert.match(html, /data-call-later=""/);
  assert.match(html, /Call #2/);
  assert.match(html, /href="\/go\/lst_south"/);
  assert.match(html, /South London Movers/);
  assert.equal((html.match(/data-call-later-quiet=""/g) ?? []).length, 2);
  const laterStart = html.indexOf('data-rank="2"');
  const laterCall = html.indexOf("Call #2", laterStart);
  const laterBid = html.indexOf("$15", laterStart);
  assert.ok(laterStart >= 0 && laterCall > laterStart && laterBid > laterCall);
  assert.equal(html.slice(laterStart, laterStart + 900).includes("Call this #1"), false);
  assert.equal(html.slice(laterStart, laterStart + 900).includes("data-prize"), false);
  assert.equal((html.match(/data-prize=""/g) ?? []).length, 1);
  const emptyLanes = html.match(/data-empty-lane="true"/g) ?? [];
  assert.equal(emptyLanes.length, 3);
  const honestLanes = html.match(/data-empty-honest=""/g) ?? [];
  assert.equal(honestLanes.length, 3);
  assert.doesNotMatch(html, /★|⭐|review count|google map|map pin/i);
  const laterCallAt = html.indexOf("Call #2");
  const claimAfter = html.indexOf('data-claim-after-call=""');
  const claimOne = html.indexOf('data-claim-after-call-one=""');
  const claimTwo = html.indexOf('data-claim-after-call-two=""');
  const claimThree = html.indexOf('data-claim-after-call-three=""');
  const claimFour = html.indexOf('data-claim-after-call-four=""');
  const claimFive = html.indexOf('data-claim-after-call-five=""');
  const hubClaim = html.indexOf("data-claim-pick");
  const leadCall = html.indexOf("Call this #1");
  assert.ok(leadCall >= 0 && claimAfter > leadCall);
  assert.ok(claimOne > leadCall);
  assert.ok(claimTwo > leadCall);
  assert.ok(claimThree > leadCall);
  assert.ok(claimFour > leadCall);
  assert.ok(claimFive > leadCall);
  assert.ok(Math.abs(claimTwo - claimOne) < 80);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(Math.abs(claimFour - claimThree) < 80);
  assert.ok(Math.abs(claimFive - claimFour) < 80);
  assert.ok(laterCallAt >= 0 && claimAfter > laterCallAt);
  assert.ok(hubClaim > claimAfter);
  assert.match(html, /Outbid my movers column/);
  assert.match(html, /after Call this #1/);
  assert.doesNotMatch(html, /after Call #2/);
  assert.equal((html.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  const callAfter = html.indexOf('data-call-after-claim=""');
  assert.ok(callAfter > claimAfter);
  assert.ok(hubClaim > callAfter);
  assert.match(html, /after the claim hop/);
  assert.match(html, /href="\/go\/lst_south"/);
  assert.equal((html.match(/data-call-after-claim=""/g) ?? []).length, 1);
  const laterTabs = html.indexOf("data-category-tabs");
  const laterAfter = html.indexOf("data-column-index-after");
  const laterHeader = html.indexOf("</header>");
  assert.ok(leadCall >= 0 && laterTabs > leadCall);
  assert.ok(laterAfter > leadCall && laterAfter < hubClaim);
  assert.ok(laterHeader >= 0 && laterTabs > laterHeader);
  assert.doesNotMatch(html.slice(0, laterHeader), /data-category-tabs/);
});

test("occupied lane claims after Call #N; empty and #1-only stay honest", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.match(empty, />Outbid</);
  assert.doesNotMatch(empty, /data-claim-after-call|after Call #|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-one/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(empty, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(empty, /data-call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /Call this #1|Call #2|data-call-later/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
    }),
  );
  assert.match(onlyOne, /Call this #1/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /data-call-after-claim-four=""/);
  assert.match(onlyOne, /data-call-after-claim-five=""/);
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /data-claim-after-call-four=""/);
  assert.match(onlyOne, /data-claim-after-call-five=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyClaim = onlyOne.indexOf('data-claim-after-call=""');
  const onlyClaimTwo = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyClaimFour = onlyOne.indexOf('data-claim-after-call-four=""');
  const onlyClaimFive = onlyOne.indexOf('data-claim-after-call-five=""');
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyCallTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyCallThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyCallFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyCallFive = onlyOne.indexOf('data-call-after-claim-five=""');
  assert.ok(onlyCall >= 0 && onlyClaim > onlyCall);
  assert.ok(onlyClaimTwo > onlyCall);
  assert.ok(onlyClaimThree > onlyCall);
  assert.ok(onlyClaimFour > onlyCall);
  assert.ok(onlyClaimFive > onlyCall);
  assert.ok(Math.abs(onlyClaimTwo - onlyOne.indexOf('data-claim-after-call-one=""')) < 80);
  assert.ok(Math.abs(onlyClaimThree - onlyClaimTwo) < 80);
  assert.ok(Math.abs(onlyClaimFour - onlyClaimThree) < 80);
  assert.ok(Math.abs(onlyClaimFive - onlyClaimFour) < 80);
  assert.ok(onlyStamp >= 0 && Math.abs(onlyStamp - onlyOne.indexOf('data-call-this-one=""')) < 80);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(onlyCallFour >= 0 && Math.abs(onlyCallFour - onlyCallThree) < 80);
  assert.ok(onlyCallFive >= 0 && Math.abs(onlyCallFive - onlyCallFour) < 80);
  assert.doesNotMatch(onlyOne, /Call #2|data-call-later|data-call-later-quiet|data-call-ad="later"/);
  assert.doesNotMatch(onlyOne, /after Call #2/);
  assert.doesNotMatch(onlyOne, /data-call-after-claim=""|after the claim hop/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  assert.match(occupied, /Call this #1/);
  assert.match(occupied, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.match(occupied, /Call #2/);
  assert.match(occupied, /data-call-later=""/);
  assert.match(occupied, /data-call-later-quiet=""/);
  assert.match(occupied, /data-claim-after-call=""/);
  assert.match(occupied, /data-claim-job="movers"/);
  assert.match(occupied, /Outbid my movers column/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(occupied, /data-claim-after-call-one=""/);
  assert.match(occupied, /data-claim-after-call-two=""/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  assert.match(occupied, /data-claim-after-call-four=""/);
  assert.match(occupied, /data-claim-after-call-five=""/);
  const callOne = occupied.indexOf("Call this #1");
  const callTwo = occupied.indexOf("Call #2");
  const claimAfter = occupied.indexOf('data-claim-after-call=""');
  const claimTwoStamp = occupied.indexOf('data-claim-after-call-two=""');
  const claimThreeStamp = occupied.indexOf('data-claim-after-call-three=""');
  const claimFourStamp = occupied.indexOf('data-claim-after-call-four=""');
  const claimFiveStamp = occupied.indexOf('data-claim-after-call-five=""');
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(callOne >= 0 && claimAfter > callOne);
  assert.ok(callTwo >= 0 && claimAfter > callTwo);
  assert.ok(claimTwoStamp > callOne);
  assert.ok(claimThreeStamp > callOne);
  assert.ok(claimFourStamp > callOne);
  assert.ok(claimFiveStamp > callOne);
  assert.ok(Math.abs(claimTwoStamp - occupied.indexOf('data-claim-after-call-one=""')) < 80);
  assert.ok(Math.abs(claimThreeStamp - claimTwoStamp) < 80);
  assert.ok(Math.abs(claimFourStamp - claimThreeStamp) < 80);
  assert.ok(Math.abs(claimFiveStamp - claimFourStamp) < 80);
  assert.ok(callAfter > claimAfter);
  assert.ok(formAt > callAfter);
  assert.match(occupied, /id="claim"/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, /after the claim hop/);
  assert.match(occupied, /href="\/go\/lst_south"/);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /data-empty-lane/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied lane calls after the claim hop; empty and #1-only stay honest", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(empty, /data-call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /data-claim-after-call|after Call #|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
    }),
  );
  assert.match(onlyOne, /Call this #1/);
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /data-call-after-claim-four=""/);
  assert.match(onlyOne, /data-call-after-claim-five=""/);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /data-claim-after-call-four=""/);
  assert.match(onlyOne, /data-claim-after-call-five=""/);
  assert.match(onlyOne, /after Call this #1/);
  assert.doesNotMatch(onlyOne, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(onlyOne, /after Call #2/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  assert.match(occupied, /Call this #1/);
  assert.match(occupied, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.match(occupied, /Call #2/);
  assert.match(occupied, /data-claim-after-call=""/);
  assert.match(occupied, /data-claim-after-call-two=""/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  assert.match(occupied, /data-claim-after-call-four=""/);
  assert.match(occupied, /data-claim-after-call-five=""/);
  assert.match(occupied, /Outbid my movers column/);
  assert.match(occupied, /data-call-after-claim=""/);
  assert.match(occupied, /class="outbid call-after-claim"/);
  assert.match(occupied, /after the claim hop/);
  assert.match(occupied, /href="\/go\/lst_south"/);
  const claimAfter = occupied.indexOf('data-claim-after-call=""');
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(claimAfter >= 0 && callAfter > claimAfter);
  assert.ok(formAt > callAfter);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.ok(
    Math.abs(
      occupied.indexOf('data-call-after-claim=""') -
        occupied.lastIndexOf('data-call-later-quiet=""'),
    ) < 80,
  );
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied #1 concentrates Call this #1; later stack does not add another #1 hop", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-call-this-one|class="outbid call-this-one"/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /Call this #1|Call #2|data-call-later|data-call-later-quiet/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /data-call-after-claim-four=""/);
  assert.match(onlyOne, /data-call-after-claim-five=""/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /data-claim-after-call-four=""/);
  assert.match(onlyOne, /data-claim-after-call-five=""/);
  assert.doesNotMatch(onlyOne, /data-call-later|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const lead = occupied.slice(leadStart, laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(lead, /data-call-this-one=""/);
  assert.match(lead, /data-call-after-claim-one=""/);
  assert.match(lead, /data-call-after-claim-two=""/);
  assert.match(lead, /data-call-after-claim-three=""/);
  assert.match(lead, /data-call-after-claim-four=""/);
  assert.match(lead, /data-call-after-claim-five=""/);
  assert.match(lead, /Call this #1/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-later|data-call-later-quiet|data-call-after-claim=""/);
  assert.match(later, /class="host call-later"/);
  assert.match(later, /data-call-later-quiet=""/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-prize/);
  assert.doesNotMatch(later, /Call this #1|data-call-this-one|outbid call-this-one|data-call-after-claim-one|data-call-after-claim-two|data-call-after-claim-three|data-call-after-claim-four|data-call-after-claim-five/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three|Outbid my movers column/);
  assert.doesNotMatch(later, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five/);
  assert.match(occupied, /data-call-after-claim=""/);
  assert.match(occupied, /class="outbid call-after-claim"/);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="outbid call-this-one/g) ?? []).length, 1);
  const oneAt = occupied.indexOf('data-call-this-one=""');
  const laterCallAt = occupied.indexOf('data-call-later=""');
  const claimAfter = occupied.indexOf('data-claim-after-call=""');
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(oneAt >= 0 && laterCallAt > oneAt);
  assert.ok(claimAfter > laterCallAt);
  assert.ok(callAfter > claimAfter);
  assert.ok(formAt > callAfter);
  assert.match(occupied, /data-claim-after-call-one=""/);
  assert.match(occupied, /data-claim-after-call-two=""/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  assert.match(occupied, /data-claim-after-call-four=""/);
  assert.match(occupied, /data-claim-after-call-five=""/);
  assert.match(occupied, /after Call this #1/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied later Call #N stays quieter than Call this #1", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-honest=""/);
  assert.match(empty, /No #1/);
  assert.doesNotMatch(empty, /data-call-later-quiet|data-call-later|Call #2/);
  assert.doesNotMatch(empty, /Call this #1|data-call-this-one|data-prize/);
  assert.doesNotMatch(empty, /data-call-after-claim-six|data-claim-after-call-six/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  assert.match(onlyOne, /Call this #1/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyOne, /data-prize=""/);
  assert.doesNotMatch(onlyOne, /data-call-later-quiet|data-call-later|Call #2/);
  assert.doesNotMatch(onlyOne, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(onlyOne, /data-empty-honest|No #1/);
  assert.doesNotMatch(onlyOne, /data-call-after-claim-six|data-claim-after-call-six/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  const laterStamp = laterCard.indexOf('data-call-later=""');
  const laterQuiet = laterCard.indexOf('data-call-later-quiet=""');
  const laterHop = laterCard.indexOf("Call #2");
  const laterBid = laterCard.indexOf("$15");
  assert.ok(laterStamp >= 0 && laterQuiet >= 0);
  assert.ok(Math.abs(laterQuiet - laterStamp) < 80);
  assert.ok(laterHop > laterQuiet && laterBid > laterHop);
  assert.ok(laterHop > laterStamp);
  assert.match(laterCard, /class="host call-later"/);
  assert.match(laterCard, /data-call-ad="later"/);
  assert.doesNotMatch(laterCard, /Call this #1|data-call-this-one|data-prize|class="outbid"/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-six|data-claim-after-call-six/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadCall = occupied.indexOf("Call this #1");
  const laterCall = occupied.indexOf("Call #2");
  const laterQuietOnCard = occupied.indexOf('data-call-later-quiet=""');
  const claimAfter = occupied.indexOf('data-claim-after-call=""');
  const afterClaim = occupied.indexOf('data-call-after-claim=""');
  const afterQuiet = occupied.lastIndexOf('data-call-later-quiet=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadCall >= 0 && laterCall > leadCall);
  assert.ok(laterQuietOnCard > leadCall && laterQuietOnCard < claimAfter);
  assert.ok(Math.abs(laterQuietOnCard - occupied.indexOf('data-call-later=""')) < 80);
  assert.ok(afterClaim > claimAfter && afterQuiet > afterClaim);
  assert.ok(Math.abs(afterQuiet - afterClaim) < 80);
  assert.ok(formAt > afterQuiet);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-later-quiet=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/data-call-later=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.match(occupied, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(occupied, /class="outbid call-after-claim"/);
  assert.doesNotMatch(occupied, /data-empty-honest|No #1/);
  assert.doesNotMatch(occupied, /claim-first-click|Then pick the column/);
  assert.doesNotMatch(occupied, /data-call-after-claim-six|data-claim-after-call-six/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);

  const hub = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId: currentWeekId(),
      lanes: {
        movers: [
          ranked({
            id: "lst_movers",
            business: "North London Movers",
            bidUsd: 20,
            siteHost: "north.example",
          }),
          ranked({
            id: "lst_south",
            rank: 2,
            business: "South London Movers",
            bidUsd: 15,
            siteHost: "south.example",
          }),
        ],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  const hubLead = hub.indexOf("Call this #1");
  const hubLater = hub.indexOf("Call #2");
  const hubQuiet = hub.indexOf('data-call-later-quiet=""');
  const hubClaim = hub.indexOf("data-claim-pick");
  assert.ok(hubLead >= 0 && hubLater > hubLead && hubQuiet > hubLead);
  assert.ok(hubClaim > hubQuiet);
  assert.equal((hub.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((hub.match(/data-call-later-quiet=""/g) ?? []).length, 2);
  assert.equal((hub.match(/data-empty-honest=""/g) ?? []).length, 3);
  assert.match(hub, /No #1/);
  assert.doesNotMatch(hub, /claim-first-click|Then pick the column/);
  assert.doesNotMatch(hub, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Outbid my column after Call this #1", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(empty, /data-claim-after-call|Call this #1/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /data-claim-after-call-four=""/);
  assert.match(onlyOne, /data-claim-after-call-five=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /data-call-after-claim-four=""/);
  assert.match(onlyOne, /data-call-after-claim-five=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  assert.equal((onlyOne.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-one=""');
  const onlyClaimTwo = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyClaimFour = onlyOne.indexOf('data-claim-after-call-four=""');
  const onlyClaimFive = onlyOne.indexOf('data-claim-after-call-five=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyCallTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyCallThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyCallFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyCallFive = onlyOne.indexOf('data-call-after-claim-five=""');
  assert.ok(onlyCall >= 0 && onlyClaim > onlyCall);
  assert.ok(onlyClaimTwo > onlyCall);
  assert.ok(onlyClaimThree > onlyCall);
  assert.ok(onlyClaimFour > onlyCall);
  assert.ok(onlyClaimFive > onlyCall);
  assert.ok(Math.abs(onlyClaimTwo - onlyClaim) < 80);
  assert.ok(Math.abs(onlyClaimThree - onlyClaimTwo) < 80);
  assert.ok(Math.abs(onlyClaimFour - onlyClaimThree) < 80);
  assert.ok(Math.abs(onlyClaimFive - onlyClaimFour) < 80);
  assert.ok(onlyStamp >= 0 && onlyClaim > onlyStamp);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(onlyCallFour >= 0 && Math.abs(onlyCallFour - onlyCallThree) < 80);
  assert.ok(onlyCallFive >= 0 && Math.abs(onlyCallFive - onlyCallFour) < 80);
  assert.ok(onlyForm > onlyClaim);
  assert.doesNotMatch(onlyOne, /after Call #2|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  assert.match(occupied, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(occupied, /data-claim-after-call-one=""/);
  assert.match(occupied, /data-claim-after-call-two=""/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  assert.match(occupied, /data-claim-after-call-four=""/);
  assert.match(occupied, /data-claim-after-call-five=""/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(occupied, /data-call-after-claim-one=""/);
  assert.match(occupied, /data-call-after-claim-two=""/);
  assert.match(occupied, /data-call-after-claim-three=""/);
  assert.match(occupied, /data-call-after-claim-four=""/);
  assert.match(occupied, /data-call-after-claim-five=""/);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  const callOne = occupied.indexOf("Call this #1");
  const claimOne = occupied.indexOf('data-claim-after-call-one=""');
  const claimTwo = occupied.indexOf('data-claim-after-call-two=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const claimFour = occupied.indexOf('data-claim-after-call-four=""');
  const claimFive = occupied.indexOf('data-claim-after-call-five=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const callTwoStamp = occupied.indexOf('data-call-after-claim-two=""');
  const callThreeStamp = occupied.indexOf('data-call-after-claim-three=""');
  const callFourStamp = occupied.indexOf('data-call-after-claim-four=""');
  const callFiveStamp = occupied.indexOf('data-call-after-claim-five=""');
  assert.ok(callOne >= 0 && claimOne > callOne);
  assert.ok(claimTwo > callOne);
  assert.ok(claimThree > callOne);
  assert.ok(claimFour > callOne);
  assert.ok(claimFive > callOne);
  assert.ok(Math.abs(claimTwo - claimOne) < 80);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(Math.abs(claimFour - claimThree) < 80);
  assert.ok(Math.abs(claimFive - claimFour) < 80);
  assert.ok(stamp >= 0 && claimOne > stamp);
  assert.ok(callTwoStamp >= 0 && Math.abs(callTwoStamp - stamp) < 80);
  assert.ok(callThreeStamp >= 0 && Math.abs(callThreeStamp - callTwoStamp) < 80);
  assert.ok(callFourStamp >= 0 && Math.abs(callFourStamp - callThreeStamp) < 80);
  assert.ok(callFiveStamp >= 0 && Math.abs(callFiveStamp - callFourStamp) < 80);
  assert.ok(laterCall >= 0 && claimOne > laterCall);
  assert.ok(callAfter > claimOne);
  assert.ok(formAt > callAfter);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Outbid my column after Call this #1 is re-concentrated", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /Call this #1|Call #2|data-call-later/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /Call #2/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-one|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-five|call-after-claim-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyCallTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyCallThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyCallFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyCallFive = onlyOne.indexOf('data-call-after-claim-five=""');
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyClaimFour = onlyOne.indexOf('data-claim-after-call-four=""');
  const onlyClaimFive = onlyOne.indexOf('data-claim-after-call-five=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /data-claim-after-call-four=""/);
  assert.match(onlyOne, /data-claim-after-call-five=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyClaim > onlyStamp);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(onlyCallFour >= 0 && Math.abs(onlyCallFour - onlyCallThree) < 80);
  assert.ok(onlyCallFive >= 0 && Math.abs(onlyCallFive - onlyCallFour) < 80);
  assert.ok(onlyClaim > onlyCall && onlyForm > onlyClaim);
  assert.ok(onlyClaimThree > onlyClaim);
  assert.ok(onlyClaimFour > onlyClaimThree);
  assert.ok(onlyClaimFive > onlyClaimFour);
  assert.ok(Math.abs(onlyClaim - onlyOne.indexOf('data-claim-after-call-one=""')) < 80);
  assert.ok(Math.abs(onlyClaimThree - onlyClaim) < 80);
  assert.ok(Math.abs(onlyClaimFour - onlyClaimThree) < 80);
  assert.ok(Math.abs(onlyClaimFive - onlyClaimFour) < 80);
  assert.equal((onlyOne.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyOne, /after Call #2|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const callTwoStamp = occupied.indexOf('data-call-after-claim-two=""');
  const callThreeStamp = occupied.indexOf('data-call-after-claim-three=""');
  const callFourStamp = occupied.indexOf('data-call-after-claim-four=""');
  const callFiveStamp = occupied.indexOf('data-call-after-claim-five=""');
  const claimTwo = occupied.indexOf('data-claim-after-call-two=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const claimFour = occupied.indexOf('data-claim-after-call-four=""');
  const claimFive = occupied.indexOf('data-claim-after-call-five=""');
  const claimOne = occupied.indexOf('data-claim-after-call-one=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.match(occupied, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(occupied, /data-claim-after-call-two=""/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  assert.match(occupied, /data-claim-after-call-four=""/);
  assert.match(occupied, /data-claim-after-call-five=""/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-claim-after-call-two|claim-after-call-two|Outbid my movers column/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(later, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(later, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(later, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(later, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(later, /data-call-after-claim-five|call-after-claim-five/);
  assert.ok(stamp >= 0 && claimTwo > stamp);
  assert.ok(callTwoStamp >= 0 && Math.abs(callTwoStamp - stamp) < 80);
  assert.ok(callThreeStamp >= 0 && Math.abs(callThreeStamp - callTwoStamp) < 80);
  assert.ok(callFourStamp >= 0 && Math.abs(callFourStamp - callThreeStamp) < 80);
  assert.ok(callFiveStamp >= 0 && Math.abs(callFiveStamp - callFourStamp) < 80);
  assert.ok(claimOne >= 0 && Math.abs(claimTwo - claimOne) < 80);
  assert.ok(claimThree > claimTwo);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(claimFour > claimThree);
  assert.ok(claimFive > claimFour);
  assert.ok(Math.abs(claimFour - claimThree) < 80);
  assert.ok(Math.abs(claimFive - claimFour) < 80);
  assert.ok(laterCall >= 0 && claimTwo > laterCall);
  assert.ok(callAfter > claimFive && formAt > callAfter);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Outbid my column after Call this #1 is re-concentrated again", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /Call this #1|Call #2|data-call-later/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /Call #2/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-one|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-five|call-after-claim-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyCallTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyCallThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyCallFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyCallFive = onlyOne.indexOf('data-call-after-claim-five=""');
  const onlyClaimTwo = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyClaimFour = onlyOne.indexOf('data-claim-after-call-four=""');
  const onlyClaimFive = onlyOne.indexOf('data-claim-after-call-five=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /data-claim-after-call-four=""/);
  assert.match(onlyOne, /data-claim-after-call-five=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyClaimThree > onlyCallTwo);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(onlyCallFour >= 0 && Math.abs(onlyCallFour - onlyCallThree) < 80);
  assert.ok(onlyCallFive >= 0 && Math.abs(onlyCallFive - onlyCallFour) < 80);
  assert.ok(onlyClaimThree > onlyCall && onlyForm > onlyClaimThree);
  assert.ok(onlyClaimFour > onlyClaimThree);
  assert.ok(onlyClaimFive > onlyClaimFour);
  assert.ok(Math.abs(onlyClaimThree - onlyClaimTwo) < 80);
  assert.ok(Math.abs(onlyClaimFour - onlyClaimThree) < 80);
  assert.ok(Math.abs(onlyClaimFive - onlyClaimFour) < 80);
  assert.ok(Math.abs(onlyClaimTwo - onlyOne.indexOf('data-claim-after-call-one=""')) < 80);
  assert.equal((onlyOne.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyOne, /after Call #2|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const callTwoStamp = occupied.indexOf('data-call-after-claim-two=""');
  const callThreeStamp = occupied.indexOf('data-call-after-claim-three=""');
  const callFourStamp = occupied.indexOf('data-call-after-claim-four=""');
  const callFiveStamp = occupied.indexOf('data-call-after-claim-five=""');
  const claimTwo = occupied.indexOf('data-claim-after-call-two=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const claimFour = occupied.indexOf('data-claim-after-call-four=""');
  const claimFive = occupied.indexOf('data-claim-after-call-five=""');
  const claimOne = occupied.indexOf('data-claim-after-call-one=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.match(occupied, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  assert.match(occupied, /data-claim-after-call-four=""/);
  assert.match(occupied, /data-claim-after-call-five=""/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three|Outbid my movers column/);
  assert.doesNotMatch(later, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(later, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(later, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(later, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(later, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(later, /data-call-after-claim-five|call-after-claim-five/);
  assert.ok(stamp >= 0 && claimThree > stamp);
  assert.ok(callTwoStamp >= 0 && Math.abs(callTwoStamp - stamp) < 80);
  assert.ok(callThreeStamp >= 0 && Math.abs(callThreeStamp - callTwoStamp) < 80);
  assert.ok(callFourStamp >= 0 && Math.abs(callFourStamp - callThreeStamp) < 80);
  assert.ok(callFiveStamp >= 0 && Math.abs(callFiveStamp - callFourStamp) < 80);
  assert.ok(claimOne >= 0 && Math.abs(claimThree - claimTwo) < 80);
  assert.ok(Math.abs(claimTwo - claimOne) < 80);
  assert.ok(claimFour > claimThree);
  assert.ok(claimFive > claimFour);
  assert.ok(Math.abs(claimFour - claimThree) < 80);
  assert.ok(Math.abs(claimFive - claimFour) < 80);
  assert.ok(laterCall >= 0 && claimThree > laterCall);
  assert.ok(callAfter > claimFive && formAt > callAfter);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Outbid my column after the louder Call this #1", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /Call this #1|Call #2|data-call-later/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /Call #2/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-one|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-five|call-after-claim-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyCallTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyCallThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyCallFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyCallFive = onlyOne.indexOf('data-call-after-claim-five=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyClaimFour = onlyOne.indexOf('data-claim-after-call-four=""');
  const onlyClaimFive = onlyOne.indexOf('data-claim-after-call-five=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /data-claim-after-call-four=""/);
  assert.match(onlyOne, /data-claim-after-call-five=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyClaimFour > onlyClaimThree);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(onlyCallFour >= 0 && Math.abs(onlyCallFour - onlyCallThree) < 80);
  assert.ok(onlyCallFive >= 0 && Math.abs(onlyCallFive - onlyCallFour) < 80);
  assert.ok(onlyClaimFour > onlyCall && onlyForm > onlyClaimFour);
  assert.ok(onlyClaimFive > onlyCall && onlyForm > onlyClaimFive);
  assert.ok(Math.abs(onlyClaimFour - onlyClaimThree) < 80);
  assert.ok(Math.abs(onlyClaimFive - onlyClaimFour) < 80);
  assert.ok(Math.abs(onlyClaimThree - onlyOne.indexOf('data-claim-after-call-two=""')) < 80);
  assert.equal((onlyOne.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyOne, /after Call #2|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const callTwoStamp = occupied.indexOf('data-call-after-claim-two=""');
  const callThreeStamp = occupied.indexOf('data-call-after-claim-three=""');
  const callFourStamp = occupied.indexOf('data-call-after-claim-four=""');
  const callFiveStamp = occupied.indexOf('data-call-after-claim-five=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const claimFour = occupied.indexOf('data-claim-after-call-four=""');
  const claimFive = occupied.indexOf('data-claim-after-call-five=""');
  const claimTwo = occupied.indexOf('data-claim-after-call-two=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(occupied, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(occupied, /data-claim-after-call-four=""/);
  assert.match(occupied, /data-claim-after-call-five=""/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-claim-after-call-four|claim-after-call-four|Outbid my movers column/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(later, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(later, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(later, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(later, /data-call-after-claim-five|call-after-claim-five/);
  assert.ok(stamp >= 0 && claimFour > stamp);
  assert.ok(callTwoStamp >= 0 && Math.abs(callTwoStamp - stamp) < 80);
  assert.ok(callThreeStamp >= 0 && Math.abs(callThreeStamp - callTwoStamp) < 80);
  assert.ok(callFourStamp >= 0 && Math.abs(callFourStamp - callThreeStamp) < 80);
  assert.ok(callFiveStamp >= 0 && Math.abs(callFiveStamp - callFourStamp) < 80);
  assert.ok(claimThree >= 0 && Math.abs(claimFour - claimThree) < 80);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(claimFive > claimFour);
  assert.ok(Math.abs(claimFive - claimFour) < 80);
  assert.ok(laterCall >= 0 && claimFour > laterCall);
  assert.ok(callAfter > claimFive && formAt > callAfter);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Outbid my column after the louder Call this #1 is re-concentrated again", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /Call this #1|Call #2|data-call-later/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /Call #2/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-five|claim-after-call-five/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-one|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-five|call-after-claim-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyCallTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyCallThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyCallFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyCallFive = onlyOne.indexOf('data-call-after-claim-five=""');
  const onlyClaimFour = onlyOne.indexOf('data-claim-after-call-four=""');
  const onlyClaimFive = onlyOne.indexOf('data-claim-after-call-five=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /data-claim-after-call-four=""/);
  assert.match(onlyOne, /data-claim-after-call-five=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyClaimFive > onlyClaimFour);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(onlyCallFour >= 0 && Math.abs(onlyCallFour - onlyCallThree) < 80);
  assert.ok(onlyCallFive >= 0 && Math.abs(onlyCallFive - onlyCallFour) < 80);
  assert.ok(onlyClaimFive > onlyCall && onlyForm > onlyClaimFive);
  assert.ok(Math.abs(onlyClaimFive - onlyClaimFour) < 80);
  assert.ok(Math.abs(onlyClaimFour - onlyOne.indexOf('data-claim-after-call-three=""')) < 80);
  assert.equal((onlyOne.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyOne, /after Call #2|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const callTwoStamp = occupied.indexOf('data-call-after-claim-two=""');
  const callThreeStamp = occupied.indexOf('data-call-after-claim-three=""');
  const callFourStamp = occupied.indexOf('data-call-after-claim-four=""');
  const callFiveStamp = occupied.indexOf('data-call-after-claim-five=""');
  const claimFour = occupied.indexOf('data-claim-after-call-four=""');
  const claimFive = occupied.indexOf('data-claim-after-call-five=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(occupied, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(occupied, /data-claim-after-call-five=""/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five|Outbid my movers column/);
  assert.doesNotMatch(later, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(later, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(later, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(later, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(later, /data-call-after-claim-five|call-after-claim-five/);
  assert.ok(stamp >= 0 && claimFive > stamp);
  assert.ok(callTwoStamp >= 0 && Math.abs(callTwoStamp - stamp) < 80);
  assert.ok(callThreeStamp >= 0 && Math.abs(callThreeStamp - callTwoStamp) < 80);
  assert.ok(callFourStamp >= 0 && Math.abs(callFourStamp - callThreeStamp) < 80);
  assert.ok(callFiveStamp >= 0 && Math.abs(callFiveStamp - callFourStamp) < 80);
  assert.ok(claimFour >= 0 && Math.abs(claimFive - claimFour) < 80);
  assert.ok(laterCall >= 0 && claimFive > laterCall);
  assert.ok(callAfter > claimFive && formAt > callAfter);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Call this #1 after Outbid my column", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /data-call-this-one|Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);

  const onlyCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_movers",
        business: "North London Movers",
        bidUsd: 20,
        siteHost: "north.example",
      }),
    }),
  );
  const onlyCardCall = onlyCard.indexOf('data-call-this-one=""');
  const onlyCardStamp = onlyCard.indexOf('data-call-after-claim-one=""');
  const onlyCardTwo = onlyCard.indexOf('data-call-after-claim-two=""');
  const onlyCardThree = onlyCard.indexOf('data-call-after-claim-three=""');
  const onlyCardFour = onlyCard.indexOf('data-call-after-claim-four=""');
  const onlyCardFive = onlyCard.indexOf('data-call-after-claim-five=""');
  const onlyCardBid = onlyCard.indexOf("$20");
  assert.match(onlyCard, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyCard, /href="\/go\/lst_movers"/);
  assert.ok(onlyCardCall >= 0 && onlyCardStamp >= 0 && onlyCardTwo >= 0 && onlyCardThree >= 0 && onlyCardFour >= 0 && onlyCardFive >= 0);
  assert.ok(Math.abs(onlyCardStamp - onlyCardCall) < 80);
  assert.ok(Math.abs(onlyCardTwo - onlyCardStamp) < 80);
  assert.ok(Math.abs(onlyCardThree - onlyCardTwo) < 80);
  assert.ok(Math.abs(onlyCardFour - onlyCardThree) < 80);
  assert.ok(onlyCardFive >= 0 && Math.abs(onlyCardFive - onlyCardFour) < 80);
  assert.ok(onlyCardBid > onlyCardCall);
  assert.equal((onlyCard.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyCard.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyCard.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyCard.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyCard.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyCard.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyCard, /data-call-after-claim=""/);
  assert.doesNotMatch(onlyCard, /data-call-later|Call #2/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /Call #2/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(laterCard, /Call this #1|data-call-this-one/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyCall = onlyOne.indexOf('data-call-this-one=""');
  const onlyCallTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyCallThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyCallFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyCallFive = onlyOne.indexOf('data-call-after-claim-five=""');
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-one=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyCallTwo >= 0 && onlyCallThree >= 0 && onlyCallFour >= 0 && onlyCallFive >= 0);
  assert.ok(Math.abs(onlyStamp - onlyCall) < 80);
  assert.ok(Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(Math.abs(onlyCallFour - onlyCallThree) < 80);
  assert.ok(onlyCallFive >= 0 && Math.abs(onlyCallFive - onlyCallFour) < 80);
  assert.ok(onlyClaim > onlyStamp && onlyForm > onlyClaim);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyOne, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(onlyOne, /Call #2|data-call-later/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const lead = occupied.slice(leadStart, laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const stampTwo = occupied.indexOf('data-call-after-claim-two=""');
  const stampThree = occupied.indexOf('data-call-after-claim-three=""');
  const stampFour = occupied.indexOf('data-call-after-claim-four=""');
  const stampFive = occupied.indexOf('data-call-after-claim-five=""');
  const oneAt = occupied.indexOf('data-call-this-one=""');
  const claimOne = occupied.indexOf('data-claim-after-call-one=""');
  const laterCall = occupied.indexOf('data-call-later=""');
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(lead, /data-call-after-claim-one=""/);
  assert.match(lead, /data-call-after-claim-two=""/);
  assert.match(lead, /data-call-after-claim-three=""/);
  assert.match(lead, /data-call-after-claim-four=""/);
  assert.match(lead, /data-call-after-claim-five=""/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-after-claim=""/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-call-after-claim-one|Call this #1|data-call-this-one|data-call-after-claim-two|data-call-after-claim-three|data-call-after-claim-four|data-call-after-claim-five/);
  assert.ok(oneAt >= 0 && stamp >= 0 && stampTwo >= 0 && stampThree >= 0 && stampFour >= 0 && stampFive >= 0);
  assert.ok(Math.abs(stamp - oneAt) < 80);
  assert.ok(Math.abs(stampTwo - stamp) < 80);
  assert.ok(Math.abs(stampThree - stampTwo) < 80);
  assert.ok(Math.abs(stampFour - stampThree) < 80);
  assert.ok(stampFive >= 0 && Math.abs(stampFive - stampFour) < 80);
  assert.ok(claimOne > stamp && laterCall > oneAt);
  assert.ok(callAfter > claimOne && formAt > callAfter);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="outbid call-this-one/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.match(occupied, /after the claim hop/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Call this #1 after Outbid my column is re-concentrated", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-this-one|Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /Call #2/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-one|Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-five|claim-after-call-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyStampTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyStampThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyStampFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyStampFive = onlyOne.indexOf('data-call-after-claim-five=""');
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /data-call-after-claim-four=""/);
  assert.match(onlyOne, /data-call-after-claim-five=""/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(onlyOne, /after Call this #1/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyStampTwo >= 0 && onlyStampThree >= 0 && onlyStampFour >= 0 && onlyStampFive >= 0);
  assert.ok(Math.abs(onlyStamp - onlyOne.indexOf('data-call-this-one=""')) < 80);
  assert.ok(Math.abs(onlyStampTwo - onlyStamp) < 80);
  assert.ok(Math.abs(onlyStampThree - onlyStampTwo) < 80);
  assert.ok(Math.abs(onlyStampFour - onlyStampThree) < 80);
  assert.ok(onlyStampFive >= 0 && Math.abs(onlyStampFive - onlyStampFour) < 80);
  assert.ok(onlyClaim > onlyStampTwo && onlyForm > onlyClaim);
  assert.ok(onlyClaimThree > onlyClaim);
  assert.ok(Math.abs(onlyClaimThree - onlyClaim) < 80);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyOne, /after Call #2|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const lead = occupied.slice(leadStart, laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const stampTwo = occupied.indexOf('data-call-after-claim-two=""');
  const stampThree = occupied.indexOf('data-call-after-claim-three=""');
  const stampFour = occupied.indexOf('data-call-after-claim-four=""');
  const stampFive = occupied.indexOf('data-call-after-claim-five=""');
  const claimTwo = occupied.indexOf('data-claim-after-call-two=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(lead, /data-call-after-claim-two=""/);
  assert.match(lead, /data-call-after-claim-three=""/);
  assert.match(lead, /data-call-after-claim-four=""/);
  assert.match(lead, /data-call-after-claim-five=""/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-after-claim=""/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-call-after-claim-two|call-after-claim-two|Call this #1|data-call-this-one|data-call-after-claim-three|data-call-after-claim-four|data-call-after-claim-five/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(later, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five/);
  assert.ok(stamp >= 0 && stampTwo >= 0 && stampThree >= 0 && stampFour >= 0 && stampFive >= 0);
  assert.ok(Math.abs(stampTwo - stamp) < 80);
  assert.ok(Math.abs(stampThree - stampTwo) < 80);
  assert.ok(Math.abs(stampFour - stampThree) < 80);
  assert.ok(stampFive >= 0 && Math.abs(stampFive - stampFour) < 80);
  assert.ok(claimTwo > stampTwo && laterCall >= 0 && claimTwo > laterCall);
  assert.ok(claimThree > claimTwo);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(callAfter > claimThree && formAt > callAfter);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="outbid call-this-one/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Call this #1 after Outbid my column is re-concentrated again", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-this-one|Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /Call #2/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-one|Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-five|claim-after-call-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyStampTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyStampThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyStampFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyStampFive = onlyOne.indexOf('data-call-after-claim-five=""');
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /data-call-after-claim-four=""/);
  assert.match(onlyOne, /data-call-after-claim-five=""/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(onlyOne, /after Call this #1/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyStampTwo >= 0 && onlyStampThree >= 0 && onlyStampFour >= 0 && onlyStampFive >= 0);
  assert.ok(Math.abs(onlyStamp - onlyOne.indexOf('data-call-this-one=""')) < 80);
  assert.ok(Math.abs(onlyStampTwo - onlyStamp) < 80);
  assert.ok(Math.abs(onlyStampThree - onlyStampTwo) < 80);
  assert.ok(Math.abs(onlyStampFour - onlyStampThree) < 80);
  assert.ok(onlyStampFive >= 0 && Math.abs(onlyStampFive - onlyStampFour) < 80);
  assert.ok(onlyClaim > onlyStampFour && onlyForm > onlyClaim);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyOne, /after Call #2|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const lead = occupied.slice(leadStart, laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const stampTwo = occupied.indexOf('data-call-after-claim-two=""');
  const stampThree = occupied.indexOf('data-call-after-claim-three=""');
  const stampFour = occupied.indexOf('data-call-after-claim-four=""');
  const stampFive = occupied.indexOf('data-call-after-claim-five=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(lead, /data-call-after-claim-three=""/);
  assert.match(lead, /data-call-after-claim-four=""/);
  assert.match(lead, /data-call-after-claim-five=""/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-after-claim=""/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-call-after-claim-three|call-after-claim-three|data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four|Call this #1|data-call-this-one/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(later, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five/);
  assert.ok(stamp >= 0 && stampTwo >= 0 && stampThree >= 0 && stampFour >= 0 && stampFive >= 0);
  assert.ok(Math.abs(stampTwo - stamp) < 80);
  assert.ok(Math.abs(stampThree - stampTwo) < 80);
  assert.ok(Math.abs(stampFour - stampThree) < 80);
  assert.ok(stampFive >= 0 && Math.abs(stampFive - stampFour) < 80);
  assert.ok(claimThree > stampFour && laterCall >= 0 && claimThree > laterCall);
  assert.ok(callAfter > claimThree && formAt > callAfter);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="outbid call-this-one/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Call this #1 after Outbid my column is re-concentrated again after claim-four", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-this-one|Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /Call #2/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-one|Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-five|claim-after-call-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyStampTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyStampThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyStampFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyStampFive = onlyOne.indexOf('data-call-after-claim-five=""');
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-four=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /data-call-after-claim-four=""/);
  assert.match(onlyOne, /data-call-after-claim-five=""/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(onlyOne, /after Call this #1/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyStampTwo >= 0 && onlyStampThree >= 0 && onlyStampFour >= 0 && onlyStampFive >= 0);
  assert.ok(Math.abs(onlyStamp - onlyOne.indexOf('data-call-this-one=""')) < 80);
  assert.ok(Math.abs(onlyStampTwo - onlyStamp) < 80);
  assert.ok(Math.abs(onlyStampThree - onlyStampTwo) < 80);
  assert.ok(Math.abs(onlyStampFour - onlyStampThree) < 80);
  assert.ok(onlyStampFive >= 0 && Math.abs(onlyStampFive - onlyStampFour) < 80);
  assert.ok(onlyClaim > onlyStampFour && onlyForm > onlyClaim);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyOne, /after Call #2|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const lead = occupied.slice(leadStart, laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const stampTwo = occupied.indexOf('data-call-after-claim-two=""');
  const stampThree = occupied.indexOf('data-call-after-claim-three=""');
  const stampFour = occupied.indexOf('data-call-after-claim-four=""');
  const stampFive = occupied.indexOf('data-call-after-claim-five=""');
  const claimFour = occupied.indexOf('data-claim-after-call-four=""');
  const claimFive = occupied.indexOf('data-claim-after-call-five=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(lead, /data-call-after-claim-four=""/);
  assert.match(lead, /data-call-after-claim-five=""/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-after-claim=""/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-call-after-claim-four|data-call-after-claim-five|call-after-claim-four|Call this #1|data-call-this-one/);
  assert.doesNotMatch(later, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five/);
  assert.ok(stamp >= 0 && stampTwo >= 0 && stampThree >= 0 && stampFour >= 0 && stampFive >= 0);
  assert.ok(Math.abs(stampTwo - stamp) < 80);
  assert.ok(Math.abs(stampThree - stampTwo) < 80);
  assert.ok(Math.abs(stampFour - stampThree) < 80);
  assert.ok(stampFive >= 0 && Math.abs(stampFive - stampFour) < 80);
  assert.ok(claimFour > stampFour && laterCall >= 0 && claimFour > laterCall);
  assert.ok(callAfter > claimFive && formAt > callAfter);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="outbid call-this-one/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("occupied column concentrates Call this #1 after Outbid my column is re-concentrated again after claim-five", () => {
  const london = getCity("london");
  const movers = getCategory("movers");
  assert.ok(london && movers);

  const empty = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [],
      showForm: true,
    }),
  );
  assert.match(empty, /data-empty-lane="true"/);
  assert.doesNotMatch(empty, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(empty, /data-call-after-claim-four|call-after-claim-four/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-this-one|Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(empty, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(empty, /data-claim-after-call-five|claim-after-call-five/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: ranked({
        id: "lst_south",
        rank: 2,
        business: "South London Movers",
        bidUsd: 15,
        siteHost: "south.example",
      }),
    }),
  );
  assert.match(laterCard, /Call #2/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-five|call-after-claim-five/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-four|call-after-claim-four/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-one|Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-four|claim-after-call-four/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-five|claim-after-call-five/);

  const onlyOne = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
      ],
      showForm: true,
    }),
  );
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyStampTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyStampThree = onlyOne.indexOf('data-call-after-claim-three=""');
  const onlyStampFour = onlyOne.indexOf('data-call-after-claim-four=""');
  const onlyStampFive = onlyOne.indexOf('data-call-after-claim-five=""');
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-five=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /data-call-after-claim-four=""/);
  assert.match(onlyOne, /data-call-after-claim-five=""/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three claim-after-call-four claim-after-call-five"/);
  assert.match(onlyOne, /after Call this #1/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyStampTwo >= 0 && onlyStampThree >= 0 && onlyStampFour >= 0 && onlyStampFive >= 0);
  assert.ok(Math.abs(onlyStamp - onlyOne.indexOf('data-call-this-one=""')) < 80);
  assert.ok(Math.abs(onlyStampTwo - onlyStamp) < 80);
  assert.ok(Math.abs(onlyStampThree - onlyStampTwo) < 80);
  assert.ok(Math.abs(onlyStampFour - onlyStampThree) < 80);
  assert.ok(Math.abs(onlyStampFive - onlyStampFour) < 80);
  assert.ok(onlyClaim > onlyStampFive && onlyForm > onlyClaim);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.doesNotMatch(onlyOne, /after Call #2|data-call-after-claim=""/);

  const occupied = renderToStaticMarkup(
    createElement(LaneBoard, {
      city: london,
      category: movers,
      listings: [
        ranked({
          id: "lst_movers",
          business: "North London Movers",
          bidUsd: 20,
          siteHost: "north.example",
        }),
        ranked({
          id: "lst_south",
          rank: 2,
          business: "South London Movers",
          bidUsd: 15,
          siteHost: "south.example",
        }),
      ],
      showForm: true,
    }),
  );
  const leadStart = occupied.indexOf('data-rank="1"');
  const laterStart = occupied.indexOf('data-rank="2"');
  const laterEnd = occupied.indexOf("</article>", laterStart);
  const lead = occupied.slice(leadStart, laterStart);
  const later = occupied.slice(laterStart, laterEnd === -1 ? undefined : laterEnd);
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const stampTwo = occupied.indexOf('data-call-after-claim-two=""');
  const stampThree = occupied.indexOf('data-call-after-claim-three=""');
  const stampFour = occupied.indexOf('data-call-after-claim-four=""');
  const stampFive = occupied.indexOf('data-call-after-claim-five=""');
  const claimFive = occupied.indexOf('data-claim-after-call-five=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three call-after-claim-four call-after-claim-five"/);
  assert.match(lead, /data-call-after-claim-five=""/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-after-claim=""/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-call-after-claim-five|call-after-claim-five|Call this #1|data-call-this-one/);
  assert.doesNotMatch(later, /data-claim-after-call-five|claim-after-call-five/);
  assert.ok(stamp >= 0 && stampTwo >= 0 && stampThree >= 0 && stampFour >= 0 && stampFive >= 0);
  assert.ok(Math.abs(stampTwo - stamp) < 80);
  assert.ok(Math.abs(stampThree - stampTwo) < 80);
  assert.ok(Math.abs(stampFour - stampThree) < 80);
  assert.ok(Math.abs(stampFive - stampFour) < 80);
  assert.ok(claimFive > stampFive && laterCall >= 0 && claimFive > laterCall);
  assert.ok(callAfter > claimFive && formAt > callAfter);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-four=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-five=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/class="outbid call-this-one/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /after Call #2/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
});

test("hub claim picks one column and does not print the want-ad field grid", () => {
  const html = renderToStaticMarkup(createElement(ClaimColumn, { city: "london" }));
  assert.match(html, /data-claim-pick/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, /\$5/);
  assert.match(html, /Pick one column/);
  assert.match(html, /Outbid my movers column/);
  assert.match(html, /Outbid my dentists column/);
  assert.match(html, /Outbid my immigration lawyers column/);
  assert.match(html, /Outbid my tutors column/);
  assert.match(html, /data-claim-job="movers"/);
  assert.match(html, /href="\/c\/london\/movers#claim"/);
  assert.match(html, /href="\/c\/london\/dentists#claim"/);
  assert.match(html, /href="\/c\/london\/immigration_lawyers#claim"/);
  assert.match(html, /href="\/c\/london\/tutors#claim"/);
  assert.doesNotMatch(html, /data-bid-form/);
  assert.doesNotMatch(html, /name="business"/);
  assert.doesNotMatch(html, /name="siteUrl"/);
  assert.doesNotMatch(html, /name="amount"/);
  assert.doesNotMatch(html, /Outbid Movers|Outbid Dentists|Outbid Tutors/);
  assert.doesNotMatch(html, /claim-first-click|Then pick the column/);
  assert.doesNotMatch(html, /★|⭐|map/i);
});

test("occupied paper keeps column tabs after the listing", () => {
  const london = getCity("london");
  assert.ok(london);
  const weekId = currentWeekId();
  const html = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId,
      lanes: {
        movers: [
          ranked({
            id: "lst_movers",
            business: "North London Movers",
            bidUsd: 20,
            siteHost: "north.example",
          }),
        ],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  const headerEnd = html.indexOf("</header>");
  const listingAt = html.indexOf("North London Movers");
  const prizeAt = html.indexOf('data-prize=""');
  const callAt = html.indexOf("Call this #1");
  const tabsAt = html.indexOf("data-category-tabs");
  const afterAt = html.indexOf('data-column-index-after=""');
  const claimAt = html.indexOf("data-claim-pick");
  const bidAt = html.indexOf("$20");
  assert.ok(headerEnd >= 0 && listingAt > headerEnd);
  assert.ok(prizeAt >= 0 && prizeAt > headerEnd);
  assert.ok(callAt > listingAt);
  assert.ok(tabsAt > callAt && afterAt > callAt);
  assert.ok(tabsAt > listingAt && afterAt > listingAt);
  assert.ok(claimAt > tabsAt);
  assert.ok(bidAt > listingAt);
  assert.match(html, /class="column-index column-index-after"/);
  assert.match(html, /aria-label="Classified columns"/);
  assert.match(html, /href="\/c\/london\/movers"/);
  assert.match(html, /href="\/c\/london\/dentists"/);
  assert.match(html, /href="\/c\/london\/immigration_lawyers"/);
  assert.match(html, /href="\/c\/london\/tutors"/);
  assert.equal((html.match(/data-category-tabs/g) ?? []).length, 1);
  assert.equal((html.match(/data-column-index-after=""/g) ?? []).length, 1);
  assert.doesNotMatch(html.slice(0, headerEnd), /data-category-tabs|column-index|data-column-index-after/);
  assert.doesNotMatch(html, /claim-first-click|Then pick the column/);
  assert.doesNotMatch(html, /data-call-after-claim-six|data-claim-after-call-six/);
  assert.equal((html.match(/data-empty-honest=""/g) ?? []).length, 3);
  assert.match(html, /No #1/);
  assert.match(html, /No stars\. No map\./);
  assert.doesNotMatch(html, /★|⭐|review count|google map|map pin/i);

  const empty = renderToStaticMarkup(
    createElement(CityHub, {
      city: london,
      weekId,
      lanes: {
        movers: [],
        dentists: [],
        immigration_lawyers: [],
        tutors: [],
      },
    }),
  );
  assert.match(empty, /claim-first-click/);
  assert.match(empty, /Then pick the column/);
  assert.doesNotMatch(empty, /data-category-tabs|data-column-index-after|Call this #1|data-prize/);
  assert.doesNotMatch(empty, /data-later-fact|later-facts|later-fact/);
  assert.equal((empty.match(/data-empty-honest=""/g) ?? []).length, 4);
  assert.equal((empty.match(/No #1/g) ?? []).length, 4);
});

test("empty paper has one first click: Claim #1, then a quieter column pick", () => {
  const html = renderToStaticMarkup(
    createElement(ClaimColumn, { city: "london", emptyPaper: true }),
  );
  assert.match(html, /data-claim-pick/);
  assert.match(html, /class="outbid claim-first-click"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, /\$5/);
  assert.match(html, /Then pick the column/);
  assert.match(html, /class="claim-columns claim-next"/);
  assert.match(html, /<summary class="outbid claim-first-click">/);
  assert.match(html, /data-claim-columns=""/);
  assert.match(html, /data-claim-job="movers"/);
  assert.match(html, /href="\/c\/london\/movers#claim"/);
  assert.match(html, /href="\/c\/london\/dentists#claim"/);
  assert.match(html, /href="\/c\/london\/immigration_lawyers#claim"/);
  assert.match(html, /href="\/c\/london\/tutors#claim"/);
  const firstClick = html.indexOf("claim-first-click");
  const pickAt = html.indexOf("Then pick the column");
  const moversAt = html.indexOf("data-claim-job=\"movers\"");
  assert.ok(firstClick >= 0 && pickAt > firstClick && moversAt > pickAt);
  assert.equal((html.match(/class="outbid claim-first-click"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Outbid my movers column/);
  assert.doesNotMatch(html, /Outbid my dentists column/);
  assert.doesNotMatch(html, /class="outbid"[^>]*data-claim-job/);
  assert.doesNotMatch(html, /data-bid-form/);
  assert.doesNotMatch(html, /name="business"/);
  assert.doesNotMatch(html, /name="siteUrl"/);
  assert.doesNotMatch(html, /name="amount"/);
  assert.doesNotMatch(html, /data-claim-after-call|call-after-claim/);
  assert.doesNotMatch(html, /★|⭐|map/i);
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
  assert.match(html, /data-classified=""/);
  assert.match(html, /<h1 class="edition-city">London<\/h1>/);
  assert.match(html, /data-empty-lane="true"/);
  assert.match(html, /data-empty-honest=""/);
  assert.equal((html.match(/data-empty-honest=""/g) ?? []).length, 4);
  assert.match(html, /No #1/);
  assert.match(html, /data-claim-pick/);
  assert.match(html, /claim-first-click/);
  assert.match(html, /Then pick the column/);
  assert.match(html, /data-claim-job="movers"/);
  assert.ok(html.indexOf('data-empty-lane="true"') < html.indexOf("data-claim-pick"));
  assert.ok(html.indexOf("Claim #1 for") < html.indexOf("Then pick the column"));
  assert.doesNotMatch(html, /Outbid my movers column/);
  assert.doesNotMatch(html, /data-category-tabs/);
  assert.doesNotMatch(html, /data-column-index-after/);
  assert.doesNotMatch(html, /name="business"/);
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
  assert.match(moversHtml, /data-classified=""/);
  assert.match(moversHtml, /This lane is empty/);
  assert.match(moversHtml, /data-empty-honest=""/);
  assert.match(moversHtml, /No #1/);
  assert.match(moversHtml, /No stars\. No map\./);
  assert.match(moversHtml, />Outbid</);
  assert.match(moversHtml, /<h1 class="edition-city">London<\/h1>/);
  assert.doesNotMatch(moversHtml, /data-category-tabs|data-column-index-after/);
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
