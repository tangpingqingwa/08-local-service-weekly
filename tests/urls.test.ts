import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AboutPage from "../app/about/page";
import RulesPage from "../app/rules/page";
import { listLane } from "../src/board";
import { openDatabase } from "../src/db";
import { findListingByIdentity, listingIdentity } from "../src/listings";
import {
  FakePaymentPort,
  currentWeekId,
  resetPaymentFixture,
  setPaymentPortForTests,
} from "../src/billing/fake";
import { PaymentError, parseListingDraft } from "../src/billing/port";
import {
  canonicalizeSiteUrl,
  isTrackingQueryKey,
  UrlError,
} from "../src/urls";

(globalThis as { React?: typeof React }).React = React;

process.env.DATABASE_PATH = ":memory:";

afterEach(() => {
  resetPaymentFixture();
});

function assertUrlError(raw: string, code: string): void {
  assert.throws(
    () => canonicalizeSiteUrl(raw),
    (err: unknown) => {
      assert.ok(err instanceof UrlError);
      assert.equal(err.code, code);
      assert.equal(err.httpStatus, 400);
      return true;
    },
  );
}

test("strips tracking query keys, fragment, and lowercases host", () => {
  assert.equal(
    canonicalizeSiteUrl("https://North.Example/van?utm_source=x&utm_campaign=ad#frag"),
    "https://north.example/van",
  );
  assert.equal(
    canonicalizeSiteUrl(
      "https://north.example/van?gclid=1&fbclid=2&ref=tweet&ref_id=9&affiliate=x&via=ad&mc_cid=1&mc_eid=2&keep=yes",
    ),
    "https://north.example/van?keep=yes",
  );
  assert.equal(
    canonicalizeSiteUrl("https://NORTH.EXAMPLE:443/van/"),
    "https://north.example/van",
  );
  assert.equal(
    canonicalizeSiteUrl("http://north.example/van?utm_source=x"),
    "https://north.example/van",
  );
  assert.equal(isTrackingQueryKey("utm_source"), true);
  assert.equal(isTrackingQueryKey("gclid"), true);
  assert.equal(isTrackingQueryKey("keep"), false);
});

test("bare service domains receive a safe https scheme before cleaning", () => {
  assert.equal(
    canonicalizeSiteUrl("North.Example/van?utm_source=directory#home"),
    "https://north.example/van",
  );
  assert.equal(
    canonicalizeSiteUrl("north.example:8443/van"),
    "https://north.example:8443/van",
  );
  assert.equal(
    canonicalizeSiteUrl("//north.example/van"),
    "https://north.example/van",
  );
  assertUrlError("///north.example/van", "invalid_listing");
});

test("trailing slash is ignored for identity", () => {
  assert.equal(
    canonicalizeSiteUrl("https://north.example/van/"),
    canonicalizeSiteUrl("https://north.example/van"),
  );
  assert.deepEqual(
    listingIdentity({
      siteUrl: "https://NORTH.EXAMPLE/van/?utm_source=x",
      category: "movers",
      city: "london",
      weekId: "2026-08-17",
    }),
    {
      siteUrl: "https://north.example/van",
      category: "movers",
      city: "london",
      weekId: "2026-08-17",
    },
  );
});

test("chat and invite hosts are 400 chat_link", () => {
  for (const raw of [
    "https://t.me/joinchat/abc",
    "https://telegram.me/joinchat/xyz",
    "https://wa.me/15551234567",
    "https://chat.whatsapp.com/invite",
    "https://discord.gg/abc123",
    "https://discord.com/invite/abc123",
    "https://m.me/page",
    "https://signal.me/#p/+15551234567",
  ]) {
    assertUrlError(raw, "chat_link");
  }
});

test("NSFW hosts and path keywords are 400 nsfw", () => {
  for (const raw of [
    "https://onlyfans.com/someone",
    "https://www.pornhub.com/view_video.php?viewkey=1",
    "https://fansly.com/profile",
    "https://clinic.example/porn/gallery",
    "https://clinic.example/xxx",
  ]) {
    assertUrlError(raw, "nsfw");
  }
});

test("unresolved shorteners are 400 url_shortener", () => {
  assertUrlError("https://bit.ly/abc", "url_shortener");
  assertUrlError("https://t.co/x", "url_shortener");
  assertUrlError("https://tinyurl.com/abc", "url_shortener");
});

test("non-http(s) schemes are rejected", () => {
  assertUrlError("javascript:alert(1)", "invalid_listing");
  assertUrlError("data:text/html,hi", "invalid_listing");
  assertUrlError("not a url", "invalid_listing");
  for (const raw of [
    "javascript\n://example.com",
    "java\nscript:123",
    "javascript\\://example.com",
    "java\\script:123",
    "https:\\\\example.com",
  ]) {
    assertUrlError(raw, "invalid_listing");
  }
});

test("private and local-only destinations are rejected", () => {
  for (const raw of [
    "10.0.0.1/van",
    "172.16.0.1/van",
    "192.168.1.1/van",
    "127.0.0.1/van",
    "169.254.1.1/van",
    "[::1]/van",
    "[fe80::1]/van",
    "[fd00::1]/van",
    "localhost/van",
    "vendor.local/van",
    "vendor.internal/van",
    "https://10.0.0.1/van",
    "https://[::ffff:127.0.0.1]/van",
  ]) {
    assertUrlError(raw, "invalid_listing");
  }

  assert.equal(
    canonicalizeSiteUrl("public.example:8443/van"),
    "https://public.example:8443/van",
  );
  assert.equal(
    canonicalizeSiteUrl("https://public.example/van"),
    "https://public.example/van",
  );
});

test("parseListingDraft stores the stripped URL and rejects chat / NSFW / shortener", () => {
  const draft = parseListingDraft({
    business: "North London Movers",
    category: "movers",
    city: "london",
    siteUrl: "https://north.example/van?utm_source=x&fbclid=1#top",
    amount: 20,
  });
  assert.equal(draft.siteUrl, "https://north.example/van");
  assert.doesNotMatch(draft.siteUrl, /utm_/);
  assert.doesNotMatch(draft.siteUrl, /fbclid/);

  const bareDomain = parseListingDraft({
    business: "Bare Domain Movers",
    category: "movers",
    city: "london",
    siteUrl: "bare.example/van",
    amount: 20,
  });
  assert.equal(bareDomain.siteUrl, "https://bare.example/van");

  assert.throws(
    () =>
      parseListingDraft({
        business: "Chat Van",
        category: "movers",
        city: "london",
        siteUrl: "https://t.me/movers",
        amount: 20,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PaymentError);
      assert.equal(err.code, "chat_link");
      assert.equal(err.httpStatus, 400);
      return true;
    },
  );
  assert.throws(
    () =>
      parseListingDraft({
        business: "Adult Clinic",
        category: "dentists",
        city: "london",
        siteUrl: "https://onlyfans.com/clinic",
        licenseId: "GDC-1",
        amount: 20,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PaymentError);
      assert.equal(err.code, "nsfw");
      return true;
    },
  );
  assert.throws(
    () =>
      parseListingDraft({
        business: "Short Van",
        category: "movers",
        city: "london",
        siteUrl: "https://bit.ly/van",
        amount: 20,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PaymentError);
      assert.equal(err.code, "url_shortener");
      return true;
    },
  );
});

test("paid checkout stores the stripped URL; chat / NSFW / shortener never list", async () => {
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
        siteUrl: "https://north.example/van?utm_source=x&gclid=1",
        amount: 20,
      }),
    }),
  );
  assert.equal(ok.status, 200);
  const stored = findListingByIdentity(db, {
    siteUrl: "https://NORTH.EXAMPLE/van/",
    category: "movers",
    city: "london",
    weekId: currentWeekId(),
  });
  assert.ok(stored);
  assert.equal(stored.siteUrl, "https://north.example/van");
  assert.doesNotMatch(stored.siteUrl, /utm_/);
  assert.doesNotMatch(stored.siteUrl, /gclid/);

  for (const [siteUrl, code] of [
    ["https://t.me/joinchat/abc", "chat_link"],
    ["https://onlyfans.com/x", "nsfw"],
    ["https://bit.ly/abc", "url_shortener"],
  ] as const) {
    const blocked = await POST(
      new Request("http://127.0.0.1/api/checkout", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          business: "Blocked Co",
          category: "movers",
          city: "london",
          siteUrl,
          amount: 20,
        }),
      }),
    );
    assert.equal(blocked.status, 400);
    assert.deepEqual(await blocked.json(), { error: code });
  }

  const ranked = listLane("london", "movers", db);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.business, "North London Movers");
  assert.doesNotMatch(ranked[0]?.siteUrl ?? "", /utm_|t\.me|onlyfans|bit\.ly/);
});

test("About page explains Local Service Weekly without clone or build copy", () => {
  const html = renderToStaticMarkup(createElement(AboutPage));
  assert.match(html, /data-page="about"/);
  assert.match(html, /<h1>About<\/h1>/);
  assert.match(html, /Rank is the bid/);
  assert.match(html, /Local Service Weekly is a public auction/);
  assert.match(html, /London/);
  assert.match(html, /no star ratings/);
  assert.match(html, /href="\/rules"/);
  assert.match(html, /eligible for seven days/);
  assert.match(html, /payment is confirmed/);
  assert.doesNotMatch(html, /paid the most this week/);
  assert.doesNotMatch(html, /public weekly auction/);
  assert.doesNotMatch(html, /data-rolling-week|week-window/);
  assert.doesNotMatch(html, /★|⭐|review count/i);
  assert.doesNotMatch(html, /outbid\.lol|local-service-weekly|\bclone\b|\bv1\b|\bfixture\b|weekId|createdAt|paidAt|Waffo/i);
});

test("Rules page states min $5, rank=bid, older wins ties, raise pays difference", () => {
  const html = renderToStaticMarkup(createElement(RulesPage));
  assert.match(html, /data-page="rules"/);
  assert.match(html, /<h1>Rules<\/h1>/);
  assert.match(html, /Rank is the bid/);
  assert.match(html, /new listing starts at <strong>\$5/);
  assert.match(html, /listing placed first keeps the higher rank/);
  assert.match(html, /difference/);
  assert.match(html, /Link shorteners, chat invitations, and adult content are rejected/);
  assert.match(html, /cleaned website, category, and city/);
  assert.match(html, /<h2>Rolling seven-day window<\/h2>/);
  assert.match(html, /does not reset for everyone at Monday midnight/);
  assert.doesNotMatch(html, /<h2>Week<\/h2>/);
  assert.doesNotMatch(html, /city × category × week/);
  assert.doesNotMatch(html, /canonical site URL \+ category \+ city \+ week/);
  assert.doesNotMatch(html, /data-rolling-week|week-window/);
  assert.doesNotMatch(html, /★|⭐|review count/i);
  assert.doesNotMatch(html, /outbid\.lol|local-service-weekly|\bclone\b|\bv1\b|\bfixture\b|weekId|createdAt|paidAt|Waffo/i);
});
