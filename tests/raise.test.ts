import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { listLane } from "../src/board";
import { openDatabase, type AppDb } from "../src/db";
import {
  applyRaise,
  findListingByIdentity,
  quoteRaise,
  raiseListing,
} from "../src/listings";
import {
  currentWeekId,
  FakePolarPort,
  resetPolarFixture,
  setPolarPortForTests,
} from "../src/polar/fake";
import { PolarError, type ListingDraft } from "../src/polar/port";

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
    weekId: currentWeekId(),
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

test("quoteRaise charges only the difference and rejects N < current+1", () => {
  const quote = quoteRaise({ bidUsd: 20, hidden: false }, 25);
  assert.deepEqual(quote, {
    currentBidUsd: 20,
    newBidUsd: 25,
    chargeUsd: 5,
  });

  assert.throws(() => quoteRaise({ bidUsd: 20, hidden: false }, 20), (err) => {
    assert.ok(err instanceof PolarError);
    assert.equal(err.code, "bid_too_low");
    return true;
  });
  assert.throws(() => quoteRaise({ bidUsd: 20, hidden: false }, 19), (err) => {
    assert.ok(err instanceof PolarError);
    assert.equal(err.code, "bid_too_low");
    return true;
  });
  assert.throws(
    () => quoteRaise({ bidUsd: 20, hidden: false }, 1_000_000),
    (err) => {
      assert.ok(err instanceof PolarError);
      assert.equal(err.code, "bid_too_high");
      return true;
    },
  );
  assert.throws(
    () => quoteRaise({ bidUsd: 20, hidden: true }, 25),
    (err) => {
      assert.ok(err instanceof PolarError);
      assert.equal(err.code, "listing_hidden");
      assert.equal(err.httpStatus, 409);
      return true;
    },
  );
});

test("#1 at $20 raises to $25: charged $5, stays #1, createdAt unchanged", async () => {
  await withDb(async (db, polar) => {
    const first = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    const occupant = findListingByIdentity(db, {
      siteUrl: "https://north.example",
      category: "movers",
      city: "london",
      weekId: currentWeekId(),
    });
    assert.ok(occupant);
    const createdAt = occupant.createdAt;

    const raised = await raiseListing(draft({ bidUsd: 25 }), polar, db);
    assert.equal(raised.status, "paid");
    assert.equal(raised.quote.chargeUsd, 5);
    assert.equal(raised.listing?.id, first.listingId);
    assert.equal(raised.listing?.bidUsd, 25);
    assert.equal(raised.listing?.createdAt, createdAt);
    assert.ok(raised.listing?.raisedAt);

    const ranked = listLane("london", "movers", db);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[0]?.bidUsd, 25);
    assert.equal(ranked[0]?.id, occupant.id);
    assert.equal(ranked[0]?.createdAt, createdAt);
  });
});

test("rival paying only the $5 difference cannot take #1", async () => {
  await withDb(async (db, polar) => {
    await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });

    await assert.rejects(
      () =>
        raiseListing(
          draft({
            business: "Rival Van",
            siteUrl: "https://rival.example",
            bidUsd: 5,
          }),
          polar,
          db,
        ),
      (err: unknown) => {
        assert.ok(err instanceof PolarError);
        assert.equal(err.code, "listing_not_found");
        return true;
      },
    );

    const steal = await polar.createCheckout({
      amountUsd: 5,
      listing: draft({
        business: "Rival Van",
        siteUrl: "https://rival.example",
        bidUsd: 5,
      }),
    });
    assert.equal(steal.status, "paid");

    const ranked = listLane("london", "movers", db);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0]?.business, "North London Movers");
    assert.equal(ranked[0]?.bidUsd, 20);
    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[1]?.business, "Rival Van");
    assert.equal(ranked[1]?.bidUsd, 5);
    assert.equal(ranked[1]?.rank, 2);
    assert.notEqual(ranked[1]?.rank, 1);
  });
});

test("rival must bid strictly greater than occupant bidUsd to take #1", async () => {
  await withDb(async (db, polar) => {
    const occupant = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    await polar.createCheckout({
      amountUsd: 20,
      listing: draft({
        business: "Same Bid Rival",
        siteUrl: "https://tie.example",
        bidUsd: 20,
      }),
    });
    let ranked = listLane("london", "movers", db);
    assert.equal(ranked[0]?.id, occupant.listingId);

    await polar.createCheckout({
      amountUsd: 26,
      listing: draft({
        business: "Cover Van",
        siteUrl: "https://cover.example",
        bidUsd: 26,
      }),
    });
    ranked = listLane("london", "movers", db);
    assert.equal(ranked[0]?.business, "Cover Van");
    assert.equal(ranked[0]?.bidUsd, 26);
    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[1]?.id, occupant.listingId);
  });
});

test("applyRaise keeps createdAt and rejects a wrong charge", async () => {
  await withDb(async (db, polar) => {
    await polar.createCheckout({ amountUsd: 20, listing: draft() });
    const existing = findListingByIdentity(db, {
      siteUrl: "https://north.example",
      category: "movers",
      city: "london",
      weekId: currentWeekId(),
    });
    assert.ok(existing);

    assert.throws(
      () =>
        applyRaise(db, existing, {
          newBidUsd: 25,
          chargeUsd: 25,
          raisedAt: "2026-08-22T12:00:00.000Z",
        }),
      (err: unknown) => {
        assert.ok(err instanceof PolarError);
        assert.equal(err.code, "bid_too_low");
        return true;
      },
    );
    assert.equal(
      findListingByIdentity(db, {
        siteUrl: "https://north.example",
        category: "movers",
        city: "london",
        weekId: currentWeekId(),
      })?.bidUsd,
      20,
    );

    const raised = applyRaise(db, existing, {
      newBidUsd: 25,
      chargeUsd: 5,
      business: "North London Movers Ltd",
      raisedAt: "2026-08-22T12:00:00.000Z",
    });
    assert.equal(raised.id, existing.id);
    assert.equal(raised.createdAt, existing.createdAt);
    assert.equal(raised.bidUsd, 25);
    assert.equal(raised.business, "North London Movers Ltd");
    assert.equal(raised.raisedAt, "2026-08-22T12:00:00.000Z");
  });
});

test("POST /api/raise fixture JSON charges the difference only", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePolarPort(db);
  setPolarPortForTests(polar);
  await polar.createCheckout({
    amountUsd: 20,
    listing: draft(),
  });
  const occupant = findListingByIdentity(db, {
    siteUrl: "https://north.example",
    category: "movers",
    city: "london",
    weekId: currentWeekId(),
  });
  assert.ok(occupant);

  const { POST } = await import("../app/api/raise/route");
  const ok = await POST(
    new Request("http://127.0.0.1/api/raise", {
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
        amount: 25,
      }),
    }),
  );
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as {
    status: string;
    listingId: string | null;
    bidUsd: number;
    chargedUsd: number;
    createdAt: string | null;
  };
  assert.equal(body.status, "paid");
  assert.equal(body.listingId, occupant.id);
  assert.equal(body.bidUsd, 25);
  assert.equal(body.chargedUsd, 5);
  assert.equal(body.createdAt, occupant.createdAt);

  const ranked = listLane("london", "movers", db);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 25);
  assert.equal(ranked[0]?.createdAt, occupant.createdAt);

  const low = await POST(
    new Request("http://127.0.0.1/api/raise", {
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
        amount: 25,
      }),
    }),
  );
  assert.equal(low.status, 400);
  assert.deepEqual(await low.json(), { error: "bid_too_low" });

  const missing = await POST(
    new Request("http://127.0.0.1/api/raise", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        business: "Ghost Van",
        category: "movers",
        city: "london",
        siteUrl: "https://ghost.example",
        amount: 30,
      }),
    }),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "listing_not_found" });
});

test("POST /api/raise form redirects to /return after fixture pay", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePolarPort(db);
  setPolarPortForTests(polar);
  await polar.createCheckout({
    amountUsd: 20,
    listing: draft({
      business: "Form Van",
      siteUrl: "https://form.example",
    }),
  });
  const { POST } = await import("../app/api/raise/route");

  const form = new FormData();
  form.set("business", "Form Van");
  form.set("category", "movers");
  form.set("city", "london");
  form.set("siteUrl", "https://form.example");
  form.set("amount", "21");

  const response = await POST(
    new Request("http://127.0.0.1/api/raise", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 303);
  const location = response.headers.get("location") ?? "";
  assert.match(location, /\/return\?checkout=/);
  const ranked = listLane("london", "movers", db);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.bidUsd, 21);
  assert.equal(ranked[0]?.rank, 1);
});
