import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { listLane, rankLane } from "../src/board";
import { openDatabase, type AppDb } from "../src/db";
import {
  findListingByIdentity,
  getListingById,
  quoteRaise,
  raiseListing,
} from "../src/listings";
import {
  FakePaymentPort,
  resetPaymentFixture,
  setPaymentPortForTests,
} from "../src/billing/fake";
import { parseListingDraft, PaymentError, type ListingDraft } from "../src/billing/port";
import {
  hideListing,
  listTakedowns,
  operatorHideListing,
  requireClaimedLicense,
  TakedownError,
  unhideListing,
} from "../src/takedown";
import { ListingCard } from "../src/ui/listing-card";
import { currentWeekId } from "../src/week";

(globalThis as { React?: typeof React }).React = React;

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
    weekId: currentWeekId(),
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

test("dentist without licenseId is 400 license_required", () => {
  assert.throws(
    () => requireClaimedLicense("dentists", null),
    (err: unknown) => {
      assert.ok(err instanceof TakedownError);
      assert.equal(err.code, "license_required");
      assert.equal(err.httpStatus, 400);
      return true;
    },
  );
  assert.throws(
    () => requireClaimedLicense("dentists", "x"),
    (err: unknown) => {
      assert.ok(err instanceof TakedownError);
      assert.equal(err.code, "license_required");
      return true;
    },
  );
  assert.throws(
    () => requireClaimedLicense("immigration_lawyers", " "),
    (err: unknown) => {
      assert.ok(err instanceof TakedownError);
      assert.equal(err.code, "license_required");
      return true;
    },
  );
  assert.equal(requireClaimedLicense("dentists", "GDC-12345"), "GDC-12345");
  assert.equal(requireClaimedLicense("movers", null), null);

  assert.throws(
    () =>
      parseListingDraft({
        business: "Soho Smile",
        category: "dentists",
        city: "london",
        siteUrl: "https://soho.example",
        amount: 20,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PaymentError);
      assert.equal(err.code, "license_required");
      assert.equal(err.httpStatus, 400);
      return true;
    },
  );
  const claimed = parseListingDraft({
    business: "Soho Smile",
    category: "dentists",
    city: "london",
    siteUrl: "https://soho.example",
    licenseId: "GDC-12345",
    amount: 20,
  });
  assert.equal(claimed.licenseId, "GDC-12345");
});

test("immigration lawyer without license is license_required; movers stay optional", () => {
  assert.throws(
    () =>
      parseListingDraft({
        business: "Thames Counsel",
        category: "immigration_lawyers",
        city: "london",
        siteUrl: "https://thames.example",
        amount: 20,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PaymentError);
      assert.equal(err.code, "license_required");
      return true;
    },
  );
  const movers = parseListingDraft({
    business: "North London Movers",
    category: "movers",
    city: "london",
    siteUrl: "https://north.example",
    amount: 20,
  });
  assert.equal(movers.licenseId, null);
});

test("claimed license is stored as a string, never verified", async () => {
  await withDb(async (db, polar) => {
    const started = await polar.createCheckout({
      amountUsd: 20,
      listing: draft({
        business: "Soho Smile",
        category: "dentists",
        siteUrl: "https://soho.example",
        licenseId: "GDC-12345",
      }),
    });
    assert.equal(started.status, "paid");
    const [row] = listLane("london", "dentists", db);
    assert.ok(row);
    assert.equal(row.licenseId, "GDC-12345");
    assert.equal(row.hidden, false);
    const html = renderToStaticMarkup(
      createElement(ListingCard, { listing: row }),
    );
    assert.match(html, /Claimed license GDC-12345 \(not verified\)/);
    assert.doesNotMatch(html, /verified license|license verified|★|⭐|review count/i);
  });
});

test("operator takedown on #1 hides the listing and vacates rank", async () => {
  await withDb(async (db, polar) => {
    const first = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    const second = await polar.createCheckout({
      amountUsd: 15,
      listing: draft({
        business: "South London Movers",
        siteUrl: "https://south.example",
        bidUsd: 15,
      }),
    });
    assert.ok(first.listingId);
    assert.ok(second.listingId);

    let ranked = listLane("london", "movers", db);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0]?.id, first.listingId);
    assert.equal(ranked[0]?.rank, 1);

    const hidden = hideListing(db, {
      listingId: first.listingId,
      reason: "unlicensed",
    });
    assert.equal(hidden.hidden, true);
    assert.equal(hidden.hiddenReason, "unlicensed");
    assert.equal(hidden.bidUsd, 20);

    ranked = listLane("london", "movers", db);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.id, second.listingId);
    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[0]?.business, "South London Movers");
    assert.equal(ranked[0]?.bidUsd, 15);
    assert.notEqual(ranked[0]?.business, "North London Movers");
    assert.deepEqual(
      rankLane(ranked).map((row) => [row.rank, row.business]),
      [[1, "South London Movers"]],
    );

    const records = listTakedowns(db, first.listingId);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.reason, "unlicensed");
    assert.equal(records[0]?.complaint, null);
  });
});

test("takedown rolls back hiding when the audit insert fails", async () => {
  await withDb(async (db, polar) => {
    const started = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    assert.ok(started.listingId);
    db.exec(`
      CREATE TRIGGER fail_takedown_audit
      BEFORE INSERT ON takedowns
      BEGIN
        SELECT RAISE(ABORT, 'audit unavailable');
      END
    `);

    assert.throws(
      () => hideListing(db, { listingId: started.listingId!, reason: "other" }),
      (error: unknown) => {
        assert.match(String(error), /audit unavailable/);
        return true;
      },
    );
    const listing = getListingById(db, started.listingId);
    assert.equal(listing?.hidden, false);
    assert.deepEqual(listTakedowns(db, started.listingId), []);
  });
});

test("takedown does not invent a replacement #1 when the lane is empty", async () => {
  await withDb(async (db, polar) => {
    const only = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    assert.ok(only.listingId);
    hideListing(db, { listingId: only.listingId, reason: "impersonation" });
    assert.deepEqual(listLane("london", "movers", db), []);
  });
});

test("complaint takedown requires a written complaint naming listing + city + category", async () => {
  await withDb(async (db, polar) => {
    const started = await polar.createCheckout({
      amountUsd: 20,
      listing: draft({
        business: "Soho Smile",
        category: "dentists",
        siteUrl: "https://soho.example",
        licenseId: "GDC-12345",
      }),
    });
    assert.ok(started.listingId);

    assert.throws(
      () =>
        hideListing(db, {
          listingId: started.listingId!,
          reason: "complaint",
        }),
      (err: unknown) => {
        assert.ok(err instanceof TakedownError);
        assert.equal(err.code, "invalid_complaint");
        return true;
      },
    );
    assert.throws(
      () =>
        hideListing(db, {
          listingId: started.listingId!,
          reason: "complaint",
          complaint: "please take this down",
        }),
      (err: unknown) => {
        assert.ok(err instanceof TakedownError);
        assert.equal(err.code, "invalid_complaint");
        return true;
      },
    );

    const hidden = hideListing(db, {
      listingId: started.listingId,
      reason: "complaint",
      complaint:
        "Written complaint: Soho Smile in London dentists is impersonating our practice.",
    });
    assert.equal(hidden.hidden, true);
    assert.equal(hidden.hiddenReason, "complaint");
    assert.deepEqual(listLane("london", "dentists", db), []);
    const records = listTakedowns(db, started.listingId);
    assert.equal(records[0]?.reason, "complaint");
    assert.match(records[0]?.complaint ?? "", /Soho Smile/);
  });
});

test("hidden listing cannot raise until unhidden", async () => {
  await withDb(async (db, polar) => {
    await polar.createCheckout({ amountUsd: 20, listing: draft() });
    const existing = findListingByIdentity(db, {
      siteUrl: "https://north.example",
      category: "movers",
      city: "london",
      weekId: currentWeekId(),
    });
    assert.ok(existing);
    hideListing(db, { listingId: existing.id, reason: "other" });

    assert.throws(
      () => quoteRaise({ bidUsd: 20, hidden: true }, 25),
      (err: unknown) => {
        assert.ok(err instanceof PaymentError);
        assert.equal(err.code, "listing_hidden");
        assert.equal(err.httpStatus, 409);
        return true;
      },
    );
    await assert.rejects(
      () => raiseListing(draft({ bidUsd: 25 }), polar, db),
      (err: unknown) => {
        assert.ok(err instanceof PaymentError);
        assert.equal(err.code, "listing_hidden");
        return true;
      },
    );

    unhideListing(db, existing.id);
    const raised = await raiseListing(draft({ bidUsd: 25 }), polar, db);
    assert.equal(raised.quote.chargeUsd, 5);
    assert.equal(raised.listing?.bidUsd, 25);
    assert.equal(raised.listing?.hidden, false);
  });
});

test("operator hide path requires the shared secret", async () => {
  await withDb(async (db, polar) => {
    const started = await polar.createCheckout({
      amountUsd: 20,
      listing: draft(),
    });
    assert.ok(started.listingId);
    const env = { OPERATOR_SECRET: "operator-test-secret" };

    assert.throws(
      () =>
        operatorHideListing(
          { listingId: started.listingId!, reason: "nsfw", secret: "nope" },
          db,
          env,
        ),
      (err: unknown) => {
        assert.ok(err instanceof TakedownError);
        assert.equal(err.code, "operator_unauthorized");
        assert.equal(err.httpStatus, 401);
        return true;
      },
    );
    assert.equal(listLane("london", "movers", db).length, 1);

    const hidden = operatorHideListing(
      {
        listingId: started.listingId,
        reason: "nsfw",
        secret: "operator-test-secret",
      },
      db,
      env,
    );
    assert.equal(hidden.hidden, true);
    assert.equal(hidden.hiddenReason, "nsfw");
    assert.deepEqual(listLane("london", "movers", db), []);
  });
});

test("POST /api/checkout dentist without license is license_required", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  setPaymentPortForTests(new FakePaymentPort(db));
  const { POST } = await import("../app/api/checkout/route");

  const missing = await POST(
    new Request("http://127.0.0.1/api/checkout", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        business: "Soho Smile",
        category: "dentists",
        city: "london",
        siteUrl: "https://soho.example",
        amount: 20,
      }),
    }),
  );
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: "license_required" });
  assert.deepEqual(listLane("london", "dentists", db), []);

  const ok = await POST(
    new Request("http://127.0.0.1/api/checkout", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        business: "Soho Smile",
        category: "dentists",
        city: "london",
        siteUrl: "https://soho.example",
        licenseId: "GDC-12345",
        amount: 20,
      }),
    }),
  );
  assert.equal(ok.status, 200);
  const ranked = listLane("london", "dentists", db);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.licenseId, "GDC-12345");
  assert.equal(ranked[0]?.rank, 1);
});

test("POST /api/takedown hides #1 and next visible bid is #1", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());
  const polar = new FakePaymentPort(db);
  setPaymentPortForTests(polar);
  const previous = process.env.OPERATOR_SECRET;
  process.env.OPERATOR_SECRET = "operator-test-secret";
  after(() => {
    if (previous === undefined) delete process.env.OPERATOR_SECRET;
    else process.env.OPERATOR_SECRET = previous;
  });

  const first = await polar.createCheckout({
    amountUsd: 20,
    listing: draft(),
  });
  await polar.createCheckout({
    amountUsd: 15,
    listing: draft({
      business: "South London Movers",
      siteUrl: "https://south.example",
      bidUsd: 15,
    }),
  });
  assert.ok(first.listingId);

  const { POST } = await import("../app/api/takedown/route");
  const denied = await POST(
    new Request("http://127.0.0.1/api/takedown", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        listingId: first.listingId,
        reason: "unlicensed",
      }),
    }),
  );
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "operator_unauthorized" });
  assert.equal(listLane("london", "movers", db)[0]?.id, first.listingId);

  const ok = await POST(
    new Request("http://127.0.0.1/api/takedown", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-operator-secret": "operator-test-secret",
      },
      body: JSON.stringify({
        listingId: first.listingId,
        reason: "unlicensed",
      }),
    }),
  );
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as {
    hidden: boolean;
    hiddenReason: string;
  };
  assert.equal(body.hidden, true);
  assert.equal(body.hiddenReason, "unlicensed");

  const ranked = listLane("london", "movers", db);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.business, "South London Movers");
  assert.equal(ranked[0]?.rank, 1);
  assert.notEqual(ranked[0]?.id, first.listingId);
});
