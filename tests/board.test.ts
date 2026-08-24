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
  assert.match(html, /Outbid my movers column/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, /Pick one column/);
  assert.match(html, /aria-label="Classified columns"/);
  const editionEnd = html.indexOf("data-classified-columns");
  const claimAt = html.indexOf("data-claim-pick");
  const firstLane = html.indexOf("data-lane");
  const firstEmpty = html.indexOf('data-empty-lane="true"');
  const firstOutbid = html.indexOf("Outbid");
  assert.ok(editionEnd > -1 && firstLane > editionEnd);
  assert.ok(claimAt > firstLane);
  assert.ok(firstEmpty > -1 && firstEmpty < claimAt);
  assert.ok(firstOutbid > firstEmpty);
  assert.ok(html.indexOf("data-bid-form") === -1 || html.indexOf("data-bid-form") > editionEnd);
  assert.doesNotMatch(html, /name="business"/);
  assert.doesNotMatch(html, /name="siteUrl"/);
  assert.doesNotMatch(html, /class="fields want-ad-fields"/);
  for (const category of CATEGORY_SLUGS) {
    assert.match(html, new RegExp(`data-category="${category}"`));
    assert.match(html, new RegExp(`data-claim-job="${category}"`));
    assert.match(
      html,
      new RegExp(`href="/c/london/${category}#claim"`),
    );
  }
  const emptyLanes = html.match(/data-empty-lane="true"/g) ?? [];
  assert.equal(emptyLanes.length, 4);
  assert.doesNotMatch(html, /data-listing-card/);
  assert.doesNotMatch(html, /Call this #1/);
  assert.doesNotMatch(html, /data-call-this-one/);
  assert.doesNotMatch(html, /Call #2/);
  assert.doesNotMatch(html, /data-call-later/);
  assert.doesNotMatch(html, /data-call-ad="later"/);
  assert.doesNotMatch(html, /data-claim-after-call|after Call #|after Call this #1/);
  assert.doesNotMatch(html, /data-claim-after-call-one/);
  assert.doesNotMatch(html, /data-claim-after-call-two/);
  assert.doesNotMatch(html, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(html, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(html, /data-call-after-claim-one/);
  assert.doesNotMatch(html, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(html, /data-call-after-claim-three|call-after-claim-three/);
  assert.doesNotMatch(html, /★|⭐|&star;|rated\s+\d|review count|top rated/i);
  assert.doesNotMatch(html, /North London Movers|placeholder provider/i);
  assert.doesNotMatch(html, /top rated in London|google map|★/i);
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
  assert.doesNotMatch(html, /Call this #1|Call #2|data-call-later|data-call-ad/);
  assert.doesNotMatch(html, /data-claim-after-call|after Call #|after Call this #1/);
  assert.doesNotMatch(html, /data-claim-after-call-one/);
  assert.doesNotMatch(html, /data-claim-after-call-two/);
  assert.doesNotMatch(html, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(html, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(html, /data-call-after-claim-one/);
  assert.doesNotMatch(html, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(html, /data-call-after-claim-three|call-after-claim-three/);
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
  assert.match(html, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(html, /Call this #1/);
  assert.equal((html.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.ok(
    Math.abs(html.indexOf('data-call-after-claim-two=""') - html.indexOf('data-call-after-claim-one=""')) < 80,
  );
  assert.ok(
    Math.abs(html.indexOf('data-call-after-claim-three=""') - html.indexOf('data-call-after-claim-two=""')) < 80,
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
  assert.doesNotMatch(later, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);

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
  assert.match(third, /href="\/go\/lst_rival"/);
  const thirdCall = third.indexOf("Call #3");
  const thirdBid = third.indexOf("$5");
  assert.ok(thirdCall >= 0 && thirdBid > thirdCall);
  assert.doesNotMatch(third, /Call this #1|Call #2|data-call-this-one/);
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
  assert.match(html, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(html, /Call this #1/);
  assert.match(html, /href="\/go\/lst_movers"/);
  assert.equal((html.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.match(html, /North London Movers/);
  assert.match(html, /\$20/);
  const emptyLanes = html.match(/data-empty-lane="true"/g) ?? [];
  assert.equal(emptyLanes.length, 3);
  assert.match(html, /data-category="movers"/);
  assert.match(html, /data-listing-id="lst_movers"/);
  assert.doesNotMatch(
    html,
    /data-category="movers"[\s\S]{0,400}data-empty-lane="true"/,
  );
  const callAt = html.indexOf("Call this #1");
  const claimAfter = html.indexOf('data-claim-after-call=""');
  const claimOne = html.indexOf('data-claim-after-call-one=""');
  const claimTwo = html.indexOf('data-claim-after-call-two=""');
  const claimThree = html.indexOf('data-claim-after-call-three=""');
  const claimAt = html.indexOf("data-claim-pick");
  const outbidAt = html.indexOf("Outbid my movers column");
  assert.ok(callAt >= 0 && claimAfter > callAt);
  assert.ok(claimOne > callAt);
  assert.ok(claimTwo > callAt);
  assert.ok(claimThree > callAt);
  assert.ok(Math.abs(claimTwo - claimOne) < 80);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(claimAt > claimAfter);
  assert.ok(outbidAt > -1 && outbidAt < claimAt);
  assert.match(html, /after Call this #1/);
  assert.match(html, /href="\/c\/london\/movers#claim"/);
  assert.equal((html.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.doesNotMatch(html, /★|⭐|review count|google map|map pin/i);
  assert.doesNotMatch(html, /name="business"/);
  assert.doesNotMatch(html, /Call #2/);
  assert.doesNotMatch(html, /data-call-later/);
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
  assert.match(html, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.equal((html.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.match(html, /data-call-ad="later"/);
  assert.match(html, /data-call-later=""/);
  assert.match(html, /Call #2/);
  assert.match(html, /href="\/go\/lst_south"/);
  assert.match(html, /South London Movers/);
  const laterStart = html.indexOf('data-rank="2"');
  const laterCall = html.indexOf("Call #2", laterStart);
  const laterBid = html.indexOf("$15", laterStart);
  assert.ok(laterStart >= 0 && laterCall > laterStart && laterBid > laterCall);
  assert.equal(html.slice(laterStart, laterStart + 900).includes("Call this #1"), false);
  const emptyLanes = html.match(/data-empty-lane="true"/g) ?? [];
  assert.equal(emptyLanes.length, 3);
  assert.doesNotMatch(html, /★|⭐|review count|google map|map pin/i);
  const laterCallAt = html.indexOf("Call #2");
  const claimAfter = html.indexOf('data-claim-after-call=""');
  const claimOne = html.indexOf('data-claim-after-call-one=""');
  const claimTwo = html.indexOf('data-claim-after-call-two=""');
  const claimThree = html.indexOf('data-claim-after-call-three=""');
  const hubClaim = html.indexOf("data-claim-pick");
  const leadCall = html.indexOf("Call this #1");
  assert.ok(leadCall >= 0 && claimAfter > leadCall);
  assert.ok(claimOne > leadCall);
  assert.ok(claimTwo > leadCall);
  assert.ok(claimThree > leadCall);
  assert.ok(Math.abs(claimTwo - claimOne) < 80);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(laterCallAt >= 0 && claimAfter > laterCallAt);
  assert.ok(hubClaim > claimAfter);
  assert.match(html, /Outbid my movers column/);
  assert.match(html, /after Call this #1/);
  assert.doesNotMatch(html, /after Call #2/);
  assert.equal((html.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  const callAfter = html.indexOf('data-call-after-claim=""');
  assert.ok(callAfter > claimAfter);
  assert.ok(hubClaim > callAfter);
  assert.match(html, /after the claim hop/);
  assert.match(html, /href="\/go\/lst_south"/);
  assert.equal((html.match(/data-call-after-claim=""/g) ?? []).length, 1);
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
  assert.doesNotMatch(empty, /data-call-after-claim=""|after the claim hop/);
  assert.doesNotMatch(empty, /data-call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
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
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyClaim = onlyOne.indexOf('data-claim-after-call=""');
  const onlyClaimTwo = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyCallTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyCallThree = onlyOne.indexOf('data-call-after-claim-three=""');
  assert.ok(onlyCall >= 0 && onlyClaim > onlyCall);
  assert.ok(onlyClaimTwo > onlyCall);
  assert.ok(onlyClaimThree > onlyCall);
  assert.ok(Math.abs(onlyClaimTwo - onlyOne.indexOf('data-claim-after-call-one=""')) < 80);
  assert.ok(Math.abs(onlyClaimThree - onlyClaimTwo) < 80);
  assert.ok(onlyStamp >= 0 && Math.abs(onlyStamp - onlyOne.indexOf('data-call-this-one=""')) < 80);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.doesNotMatch(onlyOne, /Call #2|data-call-later|data-call-ad="later"/);
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
  assert.match(occupied, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.match(occupied, /Call #2/);
  assert.match(occupied, /data-call-later=""/);
  assert.match(occupied, /data-claim-after-call=""/);
  assert.match(occupied, /data-claim-job="movers"/);
  assert.match(occupied, /Outbid my movers column/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(occupied, /data-claim-after-call-one=""/);
  assert.match(occupied, /data-claim-after-call-two=""/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  const callOne = occupied.indexOf("Call this #1");
  const callTwo = occupied.indexOf("Call #2");
  const claimAfter = occupied.indexOf('data-claim-after-call=""');
  const claimTwoStamp = occupied.indexOf('data-claim-after-call-two=""');
  const claimThreeStamp = occupied.indexOf('data-claim-after-call-three=""');
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(callOne >= 0 && claimAfter > callOne);
  assert.ok(callTwo >= 0 && claimAfter > callTwo);
  assert.ok(claimTwoStamp > callOne);
  assert.ok(claimThreeStamp > callOne);
  assert.ok(Math.abs(claimTwoStamp - occupied.indexOf('data-claim-after-call-one=""')) < 80);
  assert.ok(Math.abs(claimThreeStamp - claimTwoStamp) < 80);
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
  assert.doesNotMatch(empty, /data-claim-after-call|after Call #|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);

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
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
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
  assert.match(occupied, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.match(occupied, /Call #2/);
  assert.match(occupied, /data-claim-after-call=""/);
  assert.match(occupied, /data-claim-after-call-two=""/);
  assert.match(occupied, /data-claim-after-call-three=""/);
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
  assert.doesNotMatch(empty, /Call this #1|Call #2|data-call-later/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);

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
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
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
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(lead, /data-call-this-one=""/);
  assert.match(lead, /data-call-after-claim-one=""/);
  assert.match(lead, /data-call-after-claim-two=""/);
  assert.match(lead, /data-call-after-claim-three=""/);
  assert.match(lead, /Call this #1/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-later|data-call-after-claim=""/);
  assert.match(later, /class="host call-later"/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /Call this #1|data-call-this-one|outbid call-this-one|data-call-after-claim-one|data-call-after-claim-two|data-call-after-claim-three/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three|Outbid my movers column/);
  assert.match(occupied, /data-call-after-claim=""/);
  assert.match(occupied, /class="outbid call-after-claim"/);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  assert.match(occupied, /after Call this #1/);
  assert.doesNotMatch(occupied, /★|⭐|review count|google map|map pin/i);
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
  assert.doesNotMatch(empty, /data-claim-after-call|Call this #1/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);

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
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three"/);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  assert.equal((onlyOne.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  const onlyCall = onlyOne.indexOf("Call this #1");
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-one=""');
  const onlyClaimTwo = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  const onlyStamp = onlyOne.indexOf('data-call-after-claim-one=""');
  const onlyCallTwo = onlyOne.indexOf('data-call-after-claim-two=""');
  const onlyCallThree = onlyOne.indexOf('data-call-after-claim-three=""');
  assert.ok(onlyCall >= 0 && onlyClaim > onlyCall);
  assert.ok(onlyClaimTwo > onlyCall);
  assert.ok(onlyClaimThree > onlyCall);
  assert.ok(Math.abs(onlyClaimTwo - onlyClaim) < 80);
  assert.ok(Math.abs(onlyClaimThree - onlyClaimTwo) < 80);
  assert.ok(onlyStamp >= 0 && onlyClaim > onlyStamp);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
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
  assert.match(occupied, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three"/);
  assert.match(occupied, /data-claim-after-call-one=""/);
  assert.match(occupied, /data-claim-after-call-two=""/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(occupied, /data-call-after-claim-one=""/);
  assert.match(occupied, /data-call-after-claim-two=""/);
  assert.match(occupied, /data-call-after-claim-three=""/);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
  const callOne = occupied.indexOf("Call this #1");
  const claimOne = occupied.indexOf('data-claim-after-call-one=""');
  const claimTwo = occupied.indexOf('data-claim-after-call-two=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  const stamp = occupied.indexOf('data-call-after-claim-one=""');
  const callTwoStamp = occupied.indexOf('data-call-after-claim-two=""');
  const callThreeStamp = occupied.indexOf('data-call-after-claim-three=""');
  assert.ok(callOne >= 0 && claimOne > callOne);
  assert.ok(claimTwo > callOne);
  assert.ok(claimThree > callOne);
  assert.ok(Math.abs(claimTwo - claimOne) < 80);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(stamp >= 0 && claimOne > stamp);
  assert.ok(callTwoStamp >= 0 && Math.abs(callTwoStamp - stamp) < 80);
  assert.ok(callThreeStamp >= 0 && Math.abs(callThreeStamp - callTwoStamp) < 80);
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
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
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
  assert.doesNotMatch(laterCard, /data-claim-after-call-one|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);

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
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three"/);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyClaim > onlyStamp);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(onlyClaim > onlyCall && onlyForm > onlyClaim);
  assert.ok(onlyClaimThree > onlyClaim);
  assert.ok(Math.abs(onlyClaim - onlyOne.indexOf('data-claim-after-call-one=""')) < 80);
  assert.ok(Math.abs(onlyClaimThree - onlyClaim) < 80);
  assert.equal((onlyOne.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  const claimTwo = occupied.indexOf('data-claim-after-call-two=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const claimOne = occupied.indexOf('data-claim-after-call-one=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.match(occupied, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three"/);
  assert.match(occupied, /data-claim-after-call-two=""/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-claim-after-call-two|claim-after-call-two|Outbid my movers column/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);
  assert.doesNotMatch(later, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(later, /data-call-after-claim-three|call-after-claim-three/);
  assert.ok(stamp >= 0 && claimTwo > stamp);
  assert.ok(callTwoStamp >= 0 && Math.abs(callTwoStamp - stamp) < 80);
  assert.ok(callThreeStamp >= 0 && Math.abs(callThreeStamp - callTwoStamp) < 80);
  assert.ok(claimOne >= 0 && Math.abs(claimTwo - claimOne) < 80);
  assert.ok(claimThree > claimTwo);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(laterCall >= 0 && claimTwo > laterCall);
  assert.ok(callAfter > claimThree && formAt > callAfter);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-three|call-after-claim-three/);
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
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-one|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-three|call-after-claim-three/);

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
  const onlyClaimTwo = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three"/);
  assert.match(onlyOne, /data-claim-after-call=""/);
  assert.match(onlyOne, /data-claim-after-call-one=""/);
  assert.match(onlyOne, /data-claim-after-call-two=""/);
  assert.match(onlyOne, /data-claim-after-call-three=""/);
  assert.match(onlyOne, /Outbid my movers column/);
  assert.match(onlyOne, /after Call this #1/);
  assert.match(onlyOne, /href="\/c\/london\/movers#claim"/);
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyClaimThree > onlyCallTwo);
  assert.ok(onlyCallTwo >= 0 && Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(onlyCallThree >= 0 && Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(onlyClaimThree > onlyCall && onlyForm > onlyClaimThree);
  assert.ok(Math.abs(onlyClaimThree - onlyClaimTwo) < 80);
  assert.ok(Math.abs(onlyClaimTwo - onlyOne.indexOf('data-claim-after-call-one=""')) < 80);
  assert.equal((onlyOne.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  const claimTwo = occupied.indexOf('data-claim-after-call-two=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const claimOne = occupied.indexOf('data-claim-after-call-one=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.match(occupied, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three"/);
  assert.match(occupied, /data-claim-after-call-three=""/);
  assert.match(occupied, /after Call this #1/);
  assert.match(occupied, /href="\/c\/london\/movers#claim"/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three|Outbid my movers column/);
  assert.doesNotMatch(later, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(later, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(later, /data-call-after-claim-three|call-after-claim-three/);
  assert.ok(stamp >= 0 && claimThree > stamp);
  assert.ok(callTwoStamp >= 0 && Math.abs(callTwoStamp - stamp) < 80);
  assert.ok(callThreeStamp >= 0 && Math.abs(callThreeStamp - callTwoStamp) < 80);
  assert.ok(claimOne >= 0 && Math.abs(claimThree - claimTwo) < 80);
  assert.ok(Math.abs(claimTwo - claimOne) < 80);
  assert.ok(laterCall >= 0 && claimThree > laterCall);
  assert.ok(callAfter > claimThree && formAt > callAfter);
  assert.equal((occupied.match(/data-claim-after-call=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-call-three=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  assert.doesNotMatch(empty, /data-call-this-one|Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);

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
  const onlyCardBid = onlyCard.indexOf("$20");
  assert.match(onlyCard, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(onlyCard, /href="\/go\/lst_movers"/);
  assert.ok(onlyCardCall >= 0 && onlyCardStamp >= 0 && onlyCardTwo >= 0 && onlyCardThree >= 0);
  assert.ok(Math.abs(onlyCardStamp - onlyCardCall) < 80);
  assert.ok(Math.abs(onlyCardTwo - onlyCardStamp) < 80);
  assert.ok(Math.abs(onlyCardThree - onlyCardTwo) < 80);
  assert.ok(onlyCardBid > onlyCardCall);
  assert.equal((onlyCard.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyCard.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyCard.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyCard.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-one=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyCallTwo >= 0 && onlyCallThree >= 0);
  assert.ok(Math.abs(onlyStamp - onlyCall) < 80);
  assert.ok(Math.abs(onlyCallTwo - onlyStamp) < 80);
  assert.ok(Math.abs(onlyCallThree - onlyCallTwo) < 80);
  assert.ok(onlyClaim > onlyStamp && onlyForm > onlyClaim);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  const oneAt = occupied.indexOf('data-call-this-one=""');
  const claimOne = occupied.indexOf('data-claim-after-call-one=""');
  const laterCall = occupied.indexOf('data-call-later=""');
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(lead, /data-call-after-claim-one=""/);
  assert.match(lead, /data-call-after-claim-two=""/);
  assert.match(lead, /data-call-after-claim-three=""/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-after-claim=""/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-call-after-claim-one|Call this #1|data-call-this-one|data-call-after-claim-two|data-call-after-claim-three/);
  assert.ok(oneAt >= 0 && stamp >= 0 && stampTwo >= 0 && stampThree >= 0);
  assert.ok(Math.abs(stamp - oneAt) < 80);
  assert.ok(Math.abs(stampTwo - stamp) < 80);
  assert.ok(Math.abs(stampThree - stampTwo) < 80);
  assert.ok(claimOne > stamp && laterCall > oneAt);
  assert.ok(callAfter > claimOne && formAt > callAfter);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-this-one|Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);

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
  assert.doesNotMatch(laterCard, /data-call-after-claim-one|Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);

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
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-two=""');
  const onlyClaimThree = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three"/);
  assert.match(onlyOne, /after Call this #1/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyStampTwo >= 0 && onlyStampThree >= 0);
  assert.ok(Math.abs(onlyStamp - onlyOne.indexOf('data-call-this-one=""')) < 80);
  assert.ok(Math.abs(onlyStampTwo - onlyStamp) < 80);
  assert.ok(Math.abs(onlyStampThree - onlyStampTwo) < 80);
  assert.ok(onlyClaim > onlyStampTwo && onlyForm > onlyClaim);
  assert.ok(onlyClaimThree > onlyClaim);
  assert.ok(Math.abs(onlyClaimThree - onlyClaim) < 80);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  const claimTwo = occupied.indexOf('data-claim-after-call-two=""');
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(lead, /data-call-after-claim-two=""/);
  assert.match(lead, /data-call-after-claim-three=""/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-after-claim=""/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-call-after-claim-two|call-after-claim-two|Call this #1|data-call-this-one|data-call-after-claim-three/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);
  assert.ok(stamp >= 0 && stampTwo >= 0 && stampThree >= 0);
  assert.ok(Math.abs(stampTwo - stamp) < 80);
  assert.ok(Math.abs(stampThree - stampTwo) < 80);
  assert.ok(claimTwo > stampTwo && laterCall >= 0 && claimTwo > laterCall);
  assert.ok(claimThree > claimTwo);
  assert.ok(Math.abs(claimThree - claimTwo) < 80);
  assert.ok(callAfter > claimThree && formAt > callAfter);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  assert.doesNotMatch(empty, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(empty, /data-call-after-claim-one|call-after-claim-one/);
  assert.doesNotMatch(empty, /data-call-this-one|Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-one|after Call this #1/);
  assert.doesNotMatch(empty, /data-claim-after-call-two|claim-after-call-two/);
  assert.doesNotMatch(empty, /data-claim-after-call-three|claim-after-call-three/);

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
  assert.doesNotMatch(laterCard, /data-call-after-claim-two|call-after-claim-two/);
  assert.doesNotMatch(laterCard, /data-call-after-claim-one|Call this #1|data-call-this-one/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-two|claim-after-call-two|Outbid my movers column/);
  assert.doesNotMatch(laterCard, /data-claim-after-call-three|claim-after-call-three/);

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
  const onlyClaim = onlyOne.indexOf('data-claim-after-call-three=""');
  const onlyForm = onlyOne.indexOf("data-bid-form");
  assert.match(onlyOne, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(onlyOne, /data-call-this-one=""/);
  assert.match(onlyOne, /data-call-after-claim-one=""/);
  assert.match(onlyOne, /data-call-after-claim-two=""/);
  assert.match(onlyOne, /data-call-after-claim-three=""/);
  assert.match(onlyOne, /href="\/go\/lst_movers"/);
  assert.match(onlyOne, /class="outbid claim-after-call claim-after-call-one claim-after-call-two claim-after-call-three"/);
  assert.match(onlyOne, /after Call this #1/);
  assert.ok(onlyCall >= 0 && onlyStamp >= 0 && onlyStampTwo >= 0 && onlyStampThree >= 0);
  assert.ok(Math.abs(onlyStamp - onlyOne.indexOf('data-call-this-one=""')) < 80);
  assert.ok(Math.abs(onlyStampTwo - onlyStamp) < 80);
  assert.ok(Math.abs(onlyStampThree - onlyStampTwo) < 80);
  assert.ok(onlyClaim > onlyStampThree && onlyForm > onlyClaim);
  assert.equal((onlyOne.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((onlyOne.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  const claimThree = occupied.indexOf('data-claim-after-call-three=""');
  const laterCall = occupied.indexOf("Call #2");
  const callAfter = occupied.indexOf('data-call-after-claim=""');
  const formAt = occupied.indexOf("data-bid-form");
  assert.ok(leadStart >= 0 && laterStart > leadStart);
  assert.match(lead, /class="outbid call-this-one call-after-claim-one call-after-claim-two call-after-claim-three"/);
  assert.match(lead, /data-call-after-claim-three=""/);
  assert.match(lead, /href="\/go\/lst_movers"/);
  assert.doesNotMatch(lead, /data-call-after-claim=""/);
  assert.match(later, /Call #2/);
  assert.doesNotMatch(later, /data-call-after-claim-three|call-after-claim-three|Call this #1|data-call-this-one/);
  assert.doesNotMatch(later, /data-claim-after-call-three|claim-after-call-three/);
  assert.ok(stamp >= 0 && stampTwo >= 0 && stampThree >= 0);
  assert.ok(Math.abs(stampTwo - stamp) < 80);
  assert.ok(Math.abs(stampThree - stampTwo) < 80);
  assert.ok(claimThree > stampThree && laterCall >= 0 && claimThree > laterCall);
  assert.ok(callAfter > claimThree && formAt > callAfter);
  assert.equal((occupied.match(/data-call-this-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-one=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-two=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-call-after-claim-three=""/g) ?? []).length, 1);
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
  assert.match(html, /data-claim-pick/);
  assert.match(html, /Outbid my movers column/);
  assert.match(html, /data-claim-job="movers"/);
  assert.ok(html.indexOf('data-empty-lane="true"') < html.indexOf("data-claim-pick"));
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
  assert.match(moversHtml, />Outbid</);
  assert.match(moversHtml, /<h1 class="edition-city">London<\/h1>/);
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
