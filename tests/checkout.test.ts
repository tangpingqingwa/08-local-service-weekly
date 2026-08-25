import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { listLane, rankLane } from "../src/board";
import { openDatabase, type AppDb } from "../src/db";
import { raiseListing } from "../src/listings";
import {
  FakePolarPort,
  getPolarPort,
  resetPolarFixture,
  setPolarPortForTests,
} from "../src/polar/fake";
import {
  handleCheckoutReturn,
  isPolarLive,
  parseBidUsd,
  PolarError,
  polarFixtureOnly,
  type ListingDraft,
} from "../src/polar/port";

(globalThis as { React?: typeof React }).React = React;

process.env.DATABASE_PATH = ":memory:";

afterEach(() => {
  resetPolarFixture();
});

function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    business: "North London Movers",
    category: "movers",
    city: "london",
    siteUrl: "https://north.example",
    licenseId: null,
    bidUsd: 20,
    ...overrides,
  };
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

test("parseBidUsd enforces whole USD, min $5, and SPEC error codes", () => {
  assert.equal(parseBidUsd("5"), 5);
  assert.equal(parseBidUsd(20), 20);
  assert.equal(parseBidUsd("$15"), 15);

  assert.throws(() => parseBidUsd("4"), (err: unknown) => {
    assert.ok(err instanceof PolarError);
    assert.equal(err.code, "bid_too_low");
    assert.equal(err.httpStatus, 400);
    return true;
  });
  assert.throws(() => parseBidUsd(4.5), (err: unknown) => {
    assert.ok(err instanceof PolarError);
    assert.equal(err.code, "bid_not_integer");
    return true;
  });
  assert.throws(() => parseBidUsd("12.50"), (err: unknown) => {
    assert.ok(err instanceof PolarError);
    assert.equal(err.code, "bid_not_integer");
    return true;
  });
  assert.throws(() => parseBidUsd("1e2"), (err: unknown) => {
    assert.ok(err instanceof PolarError);
    assert.equal(err.code, "bid_not_integer");
    return true;
  });
  assert.throws(() => parseBidUsd("1000000"), (err: unknown) => {
    assert.ok(err instanceof PolarError);
    assert.equal(err.code, "bid_too_high");
    return true;
  });
});

test("POLAR_FIXTURE_ONLY=1 wins; unset / 0 stay fixture", () => {
  assert.equal(isPolarLive({}), false);
  assert.equal(isPolarLive({ POLAR_LIVE: "0" }), false);
  assert.equal(isPolarLive({ POLAR_LIVE: "true" }), false);
  assert.equal(isPolarLive({ POLAR_LIVE: "1" }), true);
  assert.equal(
    isPolarLive({ POLAR_LIVE: "1", POLAR_FIXTURE_ONLY: "1" }),
    false,
  );
  assert.equal(polarFixtureOnly({ POLAR_FIXTURE_ONLY: "1" }), true);

  const previousLive = process.env.POLAR_LIVE;
  const previousFixture = process.env.POLAR_FIXTURE_ONLY;
  process.env.POLAR_LIVE = "1";
  process.env.POLAR_FIXTURE_ONLY = "1";
  try {
    assert.equal(getPolarPort() instanceof FakePolarPort, true);
  } finally {
    if (previousLive === undefined) delete process.env.POLAR_LIVE;
    else process.env.POLAR_LIVE = previousLive;
    if (previousFixture === undefined) delete process.env.POLAR_FIXTURE_ONLY;
    else process.env.POLAR_FIXTURE_ONLY = previousFixture;
  }
});

test("live checkout without Polar secret is BLOCKED-SECRET", () => {
  const previousLive = process.env.POLAR_LIVE;
  const previousFixture = process.env.POLAR_FIXTURE_ONLY;
  const previousToken = process.env.POLAR_ACCESS_TOKEN;
  process.env.POLAR_LIVE = "1";
  delete process.env.POLAR_FIXTURE_ONLY;
  delete process.env.POLAR_ACCESS_TOKEN;
  try {
    assert.throws(() => getPolarPort(), /BLOCKED-SECRET: POLAR_ACCESS_TOKEN/);
  } finally {
    if (previousLive === undefined) delete process.env.POLAR_LIVE;
    else process.env.POLAR_LIVE = previousLive;
    if (previousFixture === undefined) delete process.env.POLAR_FIXTURE_ONLY;
    else process.env.POLAR_FIXTURE_ONLY = previousFixture;
    if (previousToken === undefined) delete process.env.POLAR_ACCESS_TOKEN;
    else process.env.POLAR_ACCESS_TOKEN = previousToken;
  }
});

test("fixture paid places the listing at the bid’s rank", async () => {
  await withDb(async (db, polar) => {
    const twenty = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    assert.equal(twenty.status, "paid");
    assert.ok(twenty.listingId);

    const fifteen = await polar.createCheckout({
      amountUsd: 15,
      listing: draft({
        business: "South London Movers",
        siteUrl: "https://south.example",
        bidUsd: 15,
      }),
    });
    assert.equal(fifteen.status, "paid");

    const ranked = listLane("london", "movers", db);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[0]?.bidUsd, 20);
    assert.equal(ranked[0]?.business, "North London Movers");
    assert.equal(ranked[0]?.id, twenty.listingId);
    assert.equal(ranked[1]?.rank, 2);
    assert.equal(ranked[1]?.bidUsd, 15);
    assert.equal(ranked[1]?.business, "South London Movers");
    assert.deepEqual(
      rankLane(ranked).map((row) => [row.rank, row.bidUsd]),
      [
        [1, 20],
        [2, 15],
      ],
    );
  });
});

test("min $5 fixture pay lists at #1 with 0 clicks", async () => {
  await withDb(async (db, polar) => {
    await assert.rejects(
      () =>
        polar.createCheckout({
          amountUsd: 4,
          listing: draft({ bidUsd: 4 }),
        }),
      (err: unknown) => {
        assert.ok(err instanceof PolarError);
        assert.equal(err.code, "bid_too_low");
        return true;
      },
    );
    assert.deepEqual(listLane("london", "movers", db), []);

    const started = await polar.createCheckout({
      amountUsd: 5,
      listing: draft({
        business: "Five Dollar Van",
        siteUrl: "https://five.example",
        bidUsd: 5,
      }),
    });
    assert.equal(started.status, "paid");
    const [row] = listLane("london", "movers", db);
    assert.ok(row);
    assert.equal(row.rank, 1);
    assert.equal(row.bidUsd, 5);
    assert.equal(row.clicks, 0);
    assert.equal(row.hidden, false);
  });
});

test("underbid still lists below #1; unpaid drafts never appear", async () => {
  await withDb(async (db) => {
    const polar = new FakePolarPort(db, { autoSettle: false });
    const cover = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    assert.equal(cover.status, "open");
    assert.deepEqual(listLane("london", "movers", db), []);

    const listing = await polar.settle(cover.id);
    assert.ok(listing);
    assert.equal(listing.bidUsd, 20);
    assert.equal(polar.getCheckout(cover.id)?.status, "paid");

    const ghost = await polar.createCheckout({
      amountUsd: 12,
      listing: draft({
        business: "Ghost Van",
        siteUrl: "https://ghost.example",
        bidUsd: 12,
      }),
    });
    await polar.abandon(ghost.id);
    assert.equal(await polar.settle(ghost.id), null);
    assert.equal(listLane("london", "movers", db).length, 1);

    const later = await polar.createCheckout({
      amountUsd: 5,
      listing: draft({
        business: "Budget Van",
        siteUrl: "https://budget.example",
        bidUsd: 5,
      }),
    });
    await polar.settle(later.id);
    const ranked = listLane("london", "movers", db);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0]?.bidUsd, 20);
    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[1]?.bidUsd, 5);
    assert.equal(ranked[1]?.rank, 2);
    assert.notEqual(ranked[1]?.rank, 1);
  });
});

test("handleCheckoutReturn pays on success and not on cancel", async () => {
  await withDb(async (db) => {
    const polar = new FakePolarPort(db, { autoSettle: false });
    const paid = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    const canceled = await polar.createCheckout({
      amountUsd: 12,
      listing: draft({
        business: "Cancelled Van",
        siteUrl: "https://cancel.example",
        bidUsd: 12,
      }),
    });

    const success = await handleCheckoutReturn({ checkout: paid.id }, polar);
    assert.equal(success.state, "paid");
    assert.equal(success.listing?.bidUsd, 20);
    assert.equal(success.listing?.business, "North London Movers");
    assert.equal(success.checkout?.intent, "place");
    assert.equal(success.checkout?.amountUsd, 20);

    const cancel = await handleCheckoutReturn(
      { checkout: canceled.id, status: "cancel" },
      polar,
    );
    assert.equal(cancel.state, "cancelled");
    assert.equal(cancel.listing, null);
    assert.equal(listLane("london", "movers", db).length, 1);

    const unknown = await handleCheckoutReturn({ checkout: "missing" }, polar);
    assert.equal(unknown.state, "unknown");
  });
});

test("POST /api/checkout fixture JSON places the listing", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePolarPort(db);
  setPolarPortForTests(polar);
  const { POST } = await import("../app/api/checkout/route");

  const ok = await POST(
    new Request("http://127.0.0.1/api/checkout", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        business: "North London Movers",
        category: "movers",
        city: "london",
        siteUrl: "https://north.example",
        amount: 20,
      }),
    }),
  );
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as {
    status: string;
    listingId: string | null;
  };
  assert.equal(body.status, "paid");
  const ranked = listLane("london", "movers", db);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 20);
  assert.equal(ranked[0]?.id, body.listingId);

  const low = await POST(
    new Request("http://127.0.0.1/api/checkout", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        business: "Too Cheap",
        category: "movers",
        city: "london",
        siteUrl: "https://cheap.example",
        amount: 4,
      }),
    }),
  );
  assert.equal(low.status, 400);
  assert.deepEqual(await low.json(), { error: "bid_too_low" });

  const frac = await POST(
    new Request("http://127.0.0.1/api/checkout", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        business: "Fractional",
        category: "movers",
        city: "london",
        siteUrl: "https://frac.example",
        amount: "12.5",
      }),
    }),
  );
  assert.equal(frac.status, 400);
  assert.deepEqual(await frac.json(), { error: "bid_not_integer" });
  assert.equal(listLane("london", "movers", db).length, 1);
});

test("POST /api/checkout form redirects to /return after fixture pay", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  setPolarPortForTests(new FakePolarPort(db));
  const { POST } = await import("../app/api/checkout/route");

  const form = new FormData();
  form.set("business", "Form Van");
  form.set("category", "movers");
  form.set("city", "london");
  form.set("siteUrl", "https://form.example");
  form.set("amount", "15");

  const response = await POST(
    new Request("http://127.0.0.1/api/checkout", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 303);
  const location = response.headers.get("location") ?? "";
  assert.match(location, /\/return\?checkout=/);
  const ranked = listLane("london", "movers", db);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.business, "Form Van");
  assert.equal(ranked[0]?.bidUsd, 15);
  assert.equal(ranked[0]?.rank, 1);
});

test("/return markup shows paid, cancelled, or unknown", async () => {
  const { default: ReturnPage } = await import("../app/return/page");

  const unknownHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({}),
    }),
  );
  assert.match(unknownHtml, /data-return="unknown"/);
  assert.match(unknownHtml, /No rank claimed/);
  assert.doesNotMatch(unknownHtml, /★|⭐|review count/i);

  const cancelHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ status: "cancel" }),
    }),
  );
  assert.match(cancelHtml, /data-return="cancelled"/);
  assert.match(cancelHtml, /No rank claimed/);

  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePolarPort(db);
  setPolarPortForTests(polar);
  const started = await polar.createCheckout({
    amountUsd: 20,
    listing: draft(),
  });
  const paidHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ checkout: started.id }),
    }),
  );
  assert.match(paidHtml, /data-return="paid"/);
  assert.match(paidHtml, /North London Movers/);
  assert.match(paidHtml, /\$20/);
  assert.doesNotMatch(paidHtml, /data-raise-return/);
  assert.doesNotMatch(paidHtml, /only the difference, not a full rebid/);
  assert.doesNotMatch(paidHtml, /#1|#2|rank #/i);
  assert.doesNotMatch(paidHtml, /★|⭐|review count/i);
});

test("occupied Polar return names difference-only — not a full rebid paid", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePolarPort(db);
  setPolarPortForTests(polar);
  const placed = await polar.createCheckout({
    amountUsd: 20,
    listing: draft(),
  });
  const { default: ReturnPage } = await import("../app/return/page");

  const placeHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ checkout: placed.id }),
    }),
  );
  assert.match(placeHtml, /data-return="paid"/);
  assert.match(placeHtml, /North London Movers is listed at \$20/);
  assert.doesNotMatch(placeHtml, /data-raise-return/);
  assert.doesNotMatch(placeHtml, /only the difference, not a full rebid/);
  assert.doesNotMatch(placeHtml, /Polar charged/);

  const unpaidPolar = new FakePolarPort(db, { autoSettle: false });
  setPolarPortForTests(unpaidPolar);
  const unpaidRaise = await unpaidPolar.createCheckout({
    amountUsd: 5,
    listing: draft({ bidUsd: 25 }),
    intent: "raise",
  });
  const cancelHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({
        checkout: unpaidRaise.id,
        status: "cancel",
      }),
    }),
  );
  assert.match(cancelHtml, /data-return="cancelled"/);
  assert.match(cancelHtml, /No rank claimed/);
  assert.doesNotMatch(cancelHtml, /data-raise-return/);
  assert.doesNotMatch(cancelHtml, /Polar charged/);
  assert.doesNotMatch(cancelHtml, /only the difference, not a full rebid/);
  assert.equal(listLane("london", "movers", db)[0]?.bidUsd, 20);

  setPolarPortForTests(polar);
  const raised = await raiseListing(draft({ bidUsd: 25 }), polar, db);
  assert.equal(raised.quote.chargeUsd, 5);
  assert.equal(raised.listing?.bidUsd, 25);
  const paidRaise = await handleCheckoutReturn(
    { checkout: raised.checkoutId },
    polar,
  );
  assert.equal(paidRaise.state, "paid");
  assert.equal(paidRaise.checkout?.intent, "raise");
  assert.equal(paidRaise.checkout?.amountUsd, 5);
  assert.equal(paidRaise.listing?.bidUsd, 25);

  const raiseHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ checkout: raised.checkoutId }),
    }),
  );
  assert.match(raiseHtml, /data-return="paid"/);
  assert.match(raiseHtml, /data-raise-return=""/);
  assert.match(raiseHtml, /class="raise-return"/);
  assert.match(
    raiseHtml,
    /Polar charged \$<span data-raise-charge-usd="">5<\/span> — only the difference, not a full rebid/,
  );
  const raiseFact = raiseHtml.match(
    /class="raise-return"[^>]*>([\s\S]*?)<\/p>/,
  );
  assert.ok(raiseFact);
  assert.match(raiseFact[1] ?? "", /Polar charged/);
  assert.doesNotMatch(raiseFact[1] ?? "", /is listed at/);
  assert.match(raiseHtml, /North London Movers is listed at \$25/);
  assert.match(raiseHtml, /Rank is the bid/);
  assert.doesNotMatch(raiseHtml, /Polar charged \$25/);
  assert.doesNotMatch(raiseHtml, /data-return="cancelled"/);
  assert.doesNotMatch(raiseHtml, /#1|#2|rank #/i);
  assert.doesNotMatch(raiseHtml, /★|⭐|review count/i);
  assert.doesNotMatch(raiseHtml, /Call this #1/);
});
