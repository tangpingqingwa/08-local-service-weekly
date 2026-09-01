import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { listLane, rankLane } from "../src/board";
import { openDatabase, type AppDb } from "../src/db";
import { raiseListing } from "../src/listings";
import {
  FakePaymentPort,
  getPaymentPort,
  resetPaymentFixture,
  setPaymentPortForTests,
} from "../src/billing/fake";
import {
  handleCheckoutReturn,
  isProviderLive,
  parseBidUsd,
  PaymentError,
  fixtureOnly,
  type ListingDraft,
} from "../src/billing/port";

(globalThis as { React?: typeof React }).React = React;
const mutableEnv = process.env as Record<string, string | undefined>;

process.env.DATABASE_PATH = ":memory:";

afterEach(() => {
  resetPaymentFixture();
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
  run: (db: AppDb, polar: FakePaymentPort) => Promise<void> | void,
): Promise<void> {
  const db = openDatabase(":memory:");
  const polar = new FakePaymentPort(db);
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
    assert.ok(err instanceof PaymentError);
    assert.equal(err.code, "bid_too_low");
    assert.equal(err.httpStatus, 400);
    return true;
  });
  assert.throws(() => parseBidUsd(4.5), (err: unknown) => {
    assert.ok(err instanceof PaymentError);
    assert.equal(err.code, "bid_not_integer");
    return true;
  });
  assert.throws(() => parseBidUsd("12.50"), (err: unknown) => {
    assert.ok(err instanceof PaymentError);
    assert.equal(err.code, "bid_not_integer");
    return true;
  });
  assert.throws(() => parseBidUsd("1e2"), (err: unknown) => {
    assert.ok(err instanceof PaymentError);
    assert.equal(err.code, "bid_not_integer");
    return true;
  });
  assert.throws(() => parseBidUsd("1000000"), (err: unknown) => {
    assert.ok(err instanceof PaymentError);
    assert.equal(err.code, "bid_too_high");
    return true;
  });
});

test("explicit fixture mode is required and legacy provider flags stay inert", () => {
  assert.equal(isProviderLive({}), false);
  assert.equal(isProviderLive({ POLAR_LIVE: "0" }), false);
  assert.equal(isProviderLive({ POLAR_LIVE: "1" }), false);
  assert.equal(isProviderLive({ PAYMENT_MODE: "waffo-test" }), true);
  assert.equal(
    isProviderLive({ PAYMENT_MODE: "waffo-test", POLAR_FIXTURE_ONLY: "1" }),
    true,
  );
  assert.equal(fixtureOnly({ POLAR_FIXTURE_ONLY: "1" }), false);
  assert.equal(fixtureOnly({ PAYMENT_MODE: "fixture", POLAR_FIXTURE_ONLY: "1" }), true);

  const previousMode = process.env.PAYMENT_MODE;
  const previousFixture = process.env.POLAR_FIXTURE_ONLY;
  const previousNode = process.env.NODE_ENV;
  process.env.PAYMENT_MODE = "fixture";
  process.env.POLAR_FIXTURE_ONLY = "1";
  try {
    assert.equal(getPaymentPort() instanceof FakePaymentPort, true);
  } finally {
    if (previousMode === undefined) delete process.env.PAYMENT_MODE;
    else process.env.PAYMENT_MODE = previousMode;
    if (previousFixture === undefined) delete process.env.POLAR_FIXTURE_ONLY;
    else process.env.POLAR_FIXTURE_ONLY = previousFixture;
    if (previousNode === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNode;
  }

  mutableEnv.NODE_ENV = "production";
  process.env.PAYMENT_MODE = "fixture";
  process.env.POLAR_FIXTURE_ONLY = "1";
  try {
    assert.throws(
      () => getPaymentPort(),
      (error: unknown) => error instanceof PaymentError && error.code === "waffo_fixture_forbidden",
    );
  } finally {
    if (previousMode === undefined) delete process.env.PAYMENT_MODE;
    else process.env.PAYMENT_MODE = previousMode;
    if (previousFixture === undefined) delete process.env.POLAR_FIXTURE_ONLY;
    else process.env.POLAR_FIXTURE_ONLY = previousFixture;
    if (previousNode === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNode;
  }
});

test("live checkout without Waffo secret is BLOCKED-SECRET", () => {
  const previousMode = process.env.PAYMENT_MODE;
  const previousFixture = process.env.POLAR_FIXTURE_ONLY;
  const previousMerchant = process.env.WAFFO_MERCHANT_ID;
  process.env.PAYMENT_MODE = "waffo-test";
  delete process.env.POLAR_FIXTURE_ONLY;
  delete process.env.WAFFO_MERCHANT_ID;
  try {
    assert.throws(() => getPaymentPort(), /BLOCKED-SECRET: WAFFO_MERCHANT_ID/);
  } finally {
    if (previousMode === undefined) delete process.env.PAYMENT_MODE;
    else process.env.PAYMENT_MODE = previousMode;
    if (previousFixture === undefined) delete process.env.POLAR_FIXTURE_ONLY;
    else process.env.POLAR_FIXTURE_ONLY = previousFixture;
    if (previousMerchant === undefined) delete process.env.WAFFO_MERCHANT_ID;
    else process.env.WAFFO_MERCHANT_ID = previousMerchant;
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
        assert.ok(err instanceof PaymentError);
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
    const polar = new FakePaymentPort(db, { autoSettle: false });
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
    const polar = new FakePaymentPort(db, { autoSettle: false });
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
  const polar = new FakePaymentPort(db);
  setPaymentPortForTests(polar);
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
  setPaymentPortForTests(new FakePaymentPort(db));
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

test("POST /api/checkout form errors return to the classified lane while JSON stays JSON", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  setPaymentPortForTests(new FakePaymentPort(db));
  const { POST } = await import("../app/api/checkout/route");

  const form = new FormData();
  form.set("business", "Too Cheap");
  form.set("category", "movers");
  form.set("city", "london");
  form.set("siteUrl", "https://cheap-form.example");
  form.set("amount", "4");

  const formResponse = await POST(
    new Request("http://127.0.0.1/api/checkout", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(formResponse.status, 303);
  const location = new URL(formResponse.headers.get("location") ?? "");
  assert.equal(location.pathname, "/c/london/movers");
  assert.equal(location.searchParams.get("error"), "bid_too_low");
  assert.equal(location.hash, "#claim");
  assert.equal(listLane("london", "movers", db).length, 0);

  const jsonResponse = await POST(
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
        siteUrl: "https://cheap-json.example",
        amount: 4,
      }),
    }),
  );
  assert.equal(jsonResponse.status, 400);
  assert.deepEqual(await jsonResponse.json(), { error: "bid_too_low" });
});

test("/return markup shows paid, cancelled, or unknown", async () => {
  const { default: ReturnPage } = await import("../app/return/page");
  const previousMode = process.env.PAYMENT_MODE;
  process.env.PAYMENT_MODE = "fixture";

  const unknownHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({}),
    }),
  );
  assert.match(unknownHtml, /data-return="unknown"/);
  assert.match(unknownHtml, /No rank claimed/);
  assert.doesNotMatch(unknownHtml, /data-raise-cancel/);
  assert.doesNotMatch(unknownHtml, /data-raise-unknown/);
  assert.doesNotMatch(unknownHtml, /still occupies/);
  assert.doesNotMatch(unknownHtml, /★|⭐|review count/i);

  const cancelHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ status: "cancel" }),
    }),
  );
  assert.match(cancelHtml, /data-return="cancelled"/);
  assert.match(cancelHtml, /No rank claimed/);
  assert.match(cancelHtml, /An abandoned checkout does not list/);
  assert.doesNotMatch(cancelHtml, /data-raise-cancel/);
  assert.doesNotMatch(cancelHtml, /data-raise-unknown/);
  assert.doesNotMatch(cancelHtml, /still occupies/);

  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePaymentPort(db);
  setPaymentPortForTests(polar);
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
  assert.doesNotMatch(paidHtml, /data-raise-cancel/);
  assert.doesNotMatch(paidHtml, /data-raise-unknown/);
  assert.doesNotMatch(paidHtml, /still occupies/);
  assert.doesNotMatch(paidHtml, /only the difference, not a full rebid/);
  assert.doesNotMatch(paidHtml, /#1|#2|rank #/i);
  assert.doesNotMatch(paidHtml, /★|⭐|review count/i);
  if (previousMode === undefined) delete process.env.PAYMENT_MODE;
  else process.env.PAYMENT_MODE = previousMode;
});

test("occupied return names difference-only without provider copy", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePaymentPort(db);
  setPaymentPortForTests(polar);
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
  assert.doesNotMatch(placeHtml, /Waffo charged/);

  const unpaidPayment = new FakePaymentPort(db, { autoSettle: false });
  setPaymentPortForTests(unpaidPayment);
  const unpaidRaise = await unpaidPayment.createCheckout({
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
  assert.match(cancelHtml, /data-raise-cancel=""/);
  assert.match(cancelHtml, /class="raise-cancel"/);
  assert.match(
    cancelHtml,
    /North London Movers still occupies at \$<span data-occupy-bid-usd="">20<\/span>/,
  );
  assert.match(cancelHtml, /An abandoned raise does not unlist/);
  assert.doesNotMatch(cancelHtml, /No rank claimed/);
  assert.doesNotMatch(cancelHtml, /does not list/);
  assert.doesNotMatch(cancelHtml, /data-raise-return/);
  assert.doesNotMatch(cancelHtml, /data-raise-unknown/);
  assert.doesNotMatch(cancelHtml, /An unpaid raise draft does not unlist/);
  assert.doesNotMatch(cancelHtml, /Waffo charged/);
  assert.doesNotMatch(cancelHtml, /only the difference, not a full rebid/);
  assert.doesNotMatch(cancelHtml, /#1|#2|rank #/i);
  assert.equal(listLane("london", "movers", db)[0]?.bidUsd, 20);
  assert.equal(listLane("london", "movers", db)[0]?.business, "North London Movers");

  setPaymentPortForTests(polar);
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
    /\$<span data-raise-charge-usd="">5<\/span> was charged — only the difference, not a full rebid/,
  );
  const raiseFact = raiseHtml.match(
    /class="raise-return"[^>]*>([\s\S]*?)<\/p>/,
  );
  assert.ok(raiseFact);
  assert.match(raiseFact[1] ?? "", /was charged/);
  assert.doesNotMatch(raiseFact[1] ?? "", /is listed at/);
  assert.match(raiseHtml, /North London Movers is listed at \$25/);
  assert.match(raiseHtml, /Rank is the bid/);
  assert.doesNotMatch(raiseHtml, /Waffo charged \$25/);
  assert.doesNotMatch(raiseHtml, /data-return="cancelled"/);
  assert.doesNotMatch(raiseHtml, /#1|#2|rank #/i);
  assert.doesNotMatch(raiseHtml, /★|⭐|review count/i);
  assert.doesNotMatch(raiseHtml, /data-raise-cancel/);
  assert.doesNotMatch(raiseHtml, /data-raise-unknown/);
  assert.doesNotMatch(raiseHtml, /still occupies/);
  assert.doesNotMatch(raiseHtml, /An abandoned raise does not unlist/);
  assert.doesNotMatch(raiseHtml, /An unpaid raise draft does not unlist/);
  assert.doesNotMatch(raiseHtml, /Call this #1/);
});

test("occupied cancelled Waffo return still occupies — not never listed", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePaymentPort(db);
  setPaymentPortForTests(polar);
  await polar.createCheckout({
    amountUsd: 20,
    listing: draft(),
  });
  const { default: ReturnPage } = await import("../app/return/page");

  const unpaidPlace = new FakePaymentPort(db, { autoSettle: false });
  setPaymentPortForTests(unpaidPlace);
  const newListingCancel = await unpaidPlace.createCheckout({
    amountUsd: 12,
    listing: draft({
      business: "Cancelled Van",
      siteUrl: "https://cancel.example",
      bidUsd: 12,
    }),
  });
  const newCancelHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({
        checkout: newListingCancel.id,
        status: "cancel",
      }),
    }),
  );
  assert.match(newCancelHtml, /data-return="cancelled"/);
  assert.match(newCancelHtml, /No rank claimed/);
  assert.match(newCancelHtml, /An abandoned checkout does not list/);
  assert.doesNotMatch(newCancelHtml, /data-raise-cancel/);
  assert.doesNotMatch(newCancelHtml, /data-raise-unknown/);
  assert.doesNotMatch(newCancelHtml, /still occupies/);
  assert.doesNotMatch(newCancelHtml, /An abandoned raise does not unlist/);
  assert.doesNotMatch(newCancelHtml, /An unpaid raise draft does not unlist/);
  assert.doesNotMatch(newCancelHtml, /data-raise-return/);
  assert.doesNotMatch(newCancelHtml, /Waffo charged/);
  assert.equal(
    listLane("london", "movers", db).some((row) => row.business === "Cancelled Van"),
    false,
  );

  const unpaidRaise = new FakePaymentPort(db, { autoSettle: false });
  setPaymentPortForTests(unpaidRaise);
  const abandonedRaise = await unpaidRaise.createCheckout({
    amountUsd: 5,
    listing: draft({ bidUsd: 25 }),
    intent: "raise",
  });
  const occupyHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({
        checkout: abandonedRaise.id,
        status: "cancel",
      }),
    }),
  );
  assert.match(occupyHtml, /data-return="cancelled"/);
  assert.match(occupyHtml, /data-raise-cancel=""/);
  assert.match(occupyHtml, /class="raise-cancel"/);
  assert.match(
    occupyHtml,
    /North London Movers still occupies at \$<span data-occupy-bid-usd="">20<\/span>/,
  );
  const occupyFact = occupyHtml.match(
    /class="raise-cancel"[^>]*>([\s\S]*?)<\/p>/,
  );
  assert.ok(occupyFact);
  assert.match(occupyFact[1] ?? "", /still occupies at \$/);
  assert.match(occupyFact[1] ?? "", /An abandoned raise does not unlist/);
  assert.doesNotMatch(occupyFact[1] ?? "", /No rank claimed/);
  assert.doesNotMatch(occupyFact[1] ?? "", /does not list/);
  assert.doesNotMatch(occupyFact[1] ?? "", /Waffo charged/);
  assert.doesNotMatch(occupyHtml, /No rank claimed/);
  assert.doesNotMatch(occupyHtml, /An abandoned checkout does not list/);
  assert.doesNotMatch(occupyHtml, /data-raise-return/);
  assert.doesNotMatch(occupyHtml, /data-raise-unknown/);
  assert.doesNotMatch(occupyHtml, /An unpaid raise draft does not unlist/);
  assert.doesNotMatch(occupyHtml, /Waffo charged/);
  assert.doesNotMatch(occupyHtml, /only the difference, not a full rebid/);
  assert.doesNotMatch(occupyHtml, /still occupies at \$25/);
  assert.doesNotMatch(occupyHtml, /#1|#2|rank #/i);
  assert.doesNotMatch(occupyHtml, /★|⭐|review count/i);
  assert.doesNotMatch(occupyHtml, /Call this #1/);
  const stillThere = listLane("london", "movers", db)[0];
  assert.equal(stillThere?.business, "North London Movers");
  assert.equal(stillThere?.bidUsd, 20);
});

test("occupied unknown Waffo return still occupies — not never listed", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePaymentPort(db);
  setPaymentPortForTests(polar);
  await polar.createCheckout({
    amountUsd: 20,
    listing: draft(),
  });
  const { default: ReturnPage } = await import("../app/return/page");

  const unpaidPlace = new FakePaymentPort(db, {
    autoSettle: false,
    confirmOpen: false,
  });
  setPaymentPortForTests(unpaidPlace);
  const newListingUnknown = await unpaidPlace.createCheckout({
    amountUsd: 12,
    listing: draft({
      business: "Unknown Van",
      siteUrl: "https://unknown.example",
      bidUsd: 12,
    }),
  });
  const newUnknownHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({
        checkout: newListingUnknown.id,
      }),
    }),
  );
  assert.match(newUnknownHtml, /data-return="unknown"/);
  assert.match(newUnknownHtml, /No rank claimed/);
  assert.match(newUnknownHtml, /Unpaid checkout drafts never appear/);
  assert.doesNotMatch(newUnknownHtml, /data-raise-unknown/);
  assert.doesNotMatch(newUnknownHtml, /still occupies/);
  assert.doesNotMatch(newUnknownHtml, /An unpaid raise draft does not unlist/);
  assert.doesNotMatch(newUnknownHtml, /data-raise-cancel/);
  assert.doesNotMatch(newUnknownHtml, /An abandoned raise does not unlist/);
  assert.doesNotMatch(newUnknownHtml, /data-raise-return/);
  assert.doesNotMatch(newUnknownHtml, /Waffo charged/);
  assert.equal(
    listLane("london", "movers", db).some((row) => row.business === "Unknown Van"),
    false,
  );

  const unpaidRaise = new FakePaymentPort(db, {
    autoSettle: false,
    confirmOpen: false,
  });
  setPaymentPortForTests(unpaidRaise);
  const openRaise = await unpaidRaise.createCheckout({
    amountUsd: 5,
    listing: draft({ bidUsd: 25 }),
    intent: "raise",
  });
  const unknownRaise = await handleCheckoutReturn(
    { checkout: openRaise.id },
    unpaidRaise,
  );
  assert.equal(unknownRaise.state, "unknown");
  assert.equal(unknownRaise.checkout?.intent, "raise");
  assert.equal(unknownRaise.listing, null);

  const occupyHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({
        checkout: openRaise.id,
      }),
    }),
  );
  assert.match(occupyHtml, /data-return="unknown"/);
  assert.match(occupyHtml, /data-raise-unknown=""/);
  assert.match(occupyHtml, /class="raise-unknown"/);
  assert.match(
    occupyHtml,
    /North London Movers still occupies at \$<span data-occupy-bid-usd="">20<\/span>/,
  );
  const occupyFact = occupyHtml.match(
    /class="raise-unknown"[^>]*>([\s\S]*?)<\/p>/,
  );
  assert.ok(occupyFact);
  assert.match(occupyFact[1] ?? "", /still occupies at \$/);
  assert.match(occupyFact[1] ?? "", /An unpaid raise draft does not unlist/);
  assert.doesNotMatch(occupyFact[1] ?? "", /No rank claimed/);
  assert.doesNotMatch(occupyFact[1] ?? "", /never appear/);
  assert.doesNotMatch(occupyFact[1] ?? "", /Waffo charged/);
  assert.doesNotMatch(occupyFact[1] ?? "", /An abandoned raise does not unlist/);
  assert.doesNotMatch(occupyHtml, /No rank claimed/);
  assert.doesNotMatch(occupyHtml, /Unpaid checkout drafts never appear/);
  assert.doesNotMatch(occupyHtml, /data-raise-cancel/);
  assert.doesNotMatch(occupyHtml, /An abandoned raise does not unlist/);
  assert.doesNotMatch(occupyHtml, /An abandoned checkout does not list/);
  assert.doesNotMatch(occupyHtml, /data-raise-return/);
  assert.doesNotMatch(occupyHtml, /Waffo charged/);
  assert.doesNotMatch(occupyHtml, /only the difference, not a full rebid/);
  assert.doesNotMatch(occupyHtml, /still occupies at \$25/);
  assert.doesNotMatch(occupyHtml, /#1|#2|rank #/i);
  assert.doesNotMatch(occupyHtml, /★|⭐|review count/i);
  assert.doesNotMatch(occupyHtml, /Call this #1/);
  const stillThere = listLane("london", "movers", db)[0];
  assert.equal(stillThere?.business, "North London Movers");
  assert.equal(stillThere?.bidUsd, 20);
});
