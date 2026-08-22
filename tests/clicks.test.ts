import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { listLane } from "../src/board";
import {
  clickDestinationUrl,
  ClickError,
  incrementPublicClick,
  listingClickPath,
} from "../src/clicks";
import { openDatabase, type AppDb } from "../src/db";
import { getListingById } from "../src/listings";
import {
  FakePolarPort,
  resetPolarFixture,
  setPolarPortForTests,
} from "../src/polar/fake";
import { parseListingDraft, type ListingDraft } from "../src/polar/port";
import { ListingCard } from "../src/ui/listing-card";
import { currentWeekId } from "../src/week";

(globalThis as { React?: typeof React }).React = React;

process.env.DATABASE_PATH = ":memory:";

afterEach(() => {
  resetPolarFixture();
});

function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  const siteUrl = overrides.siteUrl ?? "https://north.example";
  return parseListingDraft({
    business: overrides.business ?? "North London Movers",
    category: overrides.category ?? "movers",
    city: overrides.city ?? "london",
    siteUrl,
    licenseId: overrides.licenseId,
    amount: overrides.bidUsd ?? 20,
    weekId: overrides.weekId ?? currentWeekId(),
  });
}

async function withDb(
  run: (db: AppDb, polar: FakePolarPort) => Promise<void> | void,
): Promise<void> {
  const db = openDatabase(":memory:");
  const polar = new FakePolarPort(db);
  try {
    await run(db, polar);
  } finally {
    db.close();
  }
}

test("clicks start at 0 and increment by 1; never invent a starting count", async () => {
  await withDb(async (db, polar) => {
    const started = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    assert.ok(started.listingId);
    const placed = getListingById(db, started.listingId);
    assert.ok(placed);
    assert.equal(placed.clicks, 0);

    const first = incrementPublicClick(db, placed.id);
    assert.equal(first.listing.clicks, 1);
    assert.equal(first.url, "https://north.example");
    assert.equal(getListingById(db, placed.id)?.clicks, 1);

    const second = incrementPublicClick(db, placed.id);
    assert.equal(second.listing.clicks, 2);
    assert.equal(listLane("london", "movers", db)[0]?.clicks, 2);
  });
});

test("GET /go/:id 302s to the cleaned URL with no tracking query", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePolarPort(db);
  setPolarPortForTests(polar);
  const { GET } = await import("../app/go/[id]/route");

  const started = await polar.createCheckout({
    amountUsd: 20,
    listing: draft({
      siteUrl: "https://north.example/van?utm_source=x&gclid=1&fbclid=2#frag",
    }),
  });
  assert.ok(started.listingId);
  const placed = getListingById(db, started.listingId);
  assert.ok(placed);
  assert.equal(placed.siteUrl, "https://north.example/van");
  assert.equal(placed.clicks, 0);
  assert.equal(listingClickPath(placed.id), `/go/${placed.id}`);
  assert.equal(clickDestinationUrl(placed.siteUrl), "https://north.example/van");

  const response = await GET(
    new Request(`http://127.0.0.1/go/${placed.id}?utm_source=injected`),
    { params: Promise.resolve({ id: placed.id }) },
  );
  assert.equal(response.status, 302);
  const location = response.headers.get("location");
  assert.equal(location, "https://north.example/van");
  assert.doesNotMatch(location ?? "", /utm_|gclid|fbclid|#|\?/);
  assert.equal(getListingById(db, placed.id)?.clicks, 1);

  const again = await GET(new Request(`http://127.0.0.1/go/${placed.id}`), {
    params: Promise.resolve({ id: placed.id }),
  });
  assert.equal(again.status, 302);
  assert.equal(again.headers.get("location"), "https://north.example/van");
  assert.equal(getListingById(db, placed.id)?.clicks, 2);
  assert.equal(listLane("london", "movers", db)[0]?.clicks, 2);
});

test("unknown listing click is 404 and does not invent a hop or a count", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  setPolarPortForTests(new FakePolarPort(db));
  const { GET } = await import("../app/go/[id]/route");

  assert.throws(
    () => incrementPublicClick(db, "does-not-exist"),
    (err: unknown) => {
      assert.ok(err instanceof ClickError);
      assert.equal(err.code, "listing_not_found");
      assert.equal(err.httpStatus, 404);
      return true;
    },
  );
  assert.throws(
    () => incrementPublicClick(db, "   "),
    (err: unknown) => {
      assert.ok(err instanceof ClickError);
      assert.equal(err.code, "listing_not_found");
      return true;
    },
  );

  const missing = await GET(new Request("http://127.0.0.1/go/does-not-exist"), {
    params: Promise.resolve({ id: "does-not-exist" }),
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "listing_not_found" });
  assert.equal(missing.headers.get("location"), null);
  assert.deepEqual(listLane("london", "movers", db), []);

  const blank = await GET(new Request("http://127.0.0.1/go/"), {
    params: Promise.resolve({ id: "   " }),
  });
  assert.equal(blank.status, 404);
});

test("a quiet listing does not copy another listing's public click count", async () => {
  await withDb(async (db, polar) => {
    const popular = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    const quiet = await polar.createCheckout({
      amountUsd: 15,
      listing: draft({
        business: "South London Movers",
        siteUrl: "https://south.example",
        bidUsd: 15,
      }),
    });
    assert.ok(popular.listingId);
    assert.ok(quiet.listingId);

    incrementPublicClick(db, popular.listingId);
    incrementPublicClick(db, popular.listingId);

    const ranked = listLane("london", "movers", db);
    assert.equal(ranked.find((row) => row.id === popular.listingId)?.clicks, 2);
    assert.equal(ranked.find((row) => row.id === quiet.listingId)?.clicks, 0);
  });
});

test("board card shows the public click integer after /go/:id", async () => {
  await withDb(async (db, polar) => {
    const started = await polar.createCheckout({
      amountUsd: 20,
      listing: draft({ siteUrl: "https://north.example/van?utm_source=x" }),
    });
    assert.ok(started.listingId);
    incrementPublicClick(db, started.listingId);
    const [row] = listLane("london", "movers", db);
    assert.ok(row);
    assert.equal(row.clicks, 1);
    const html = renderToStaticMarkup(createElement(ListingCard, { listing: row }));
    assert.match(html, /data-clicks=""/);
    assert.match(html, /1 click/);
    assert.doesNotMatch(html, /★|⭐|rated|review count/i);
  });
});
