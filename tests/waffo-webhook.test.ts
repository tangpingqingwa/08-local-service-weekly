import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { currentWeekId, ROLLING_WEEK_CLOCK_SKEW_MS } from "../src/week";
import { openDatabase, type AppDb } from "../src/db";
import { listLane } from "../src/board";
import { raiseListing } from "../src/listings";
import {
  LivePaymentPort,
  processWaffoWebhookEvent,
  verifyWaffoWebhook,
} from "../src/billing/live";
import {
  getPaymentPort,
  resetPaymentFixture,
  setPaymentPortForTests,
} from "../src/billing/fake";
import {
  handleCheckoutReturn,
  PaymentError,
  type ListingDraft,
  type PaymentEnv,
} from "../src/billing/port";
import {
  isProductionLike,
  validateWaffoConfiguration,
  waffoMode,
} from "../src/billing/waffo-session";
import { POST as postWebhook } from "../app/api/webhooks/waffo/route";
import { POST as postObsoleteWebhook } from "../app/api/webhooks/polar/route";
import CheckoutCompletePage from "../app/checkout/complete/page";

const requestKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const webhookKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const requestPrivateKey = requestKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const webhookPrivateKey = webhookKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const webhookPublicKey = webhookKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

const MERCHANT_ID = "MER_1234567890123456789012";
const STORE_ID = "STO_1234567890123456789012";
const PRODUCT_ID = "PROD_1234567890123456789012";
const OPEN_WEEK = currentWeekId();
const tempDirs: string[] = [];
const mutableEnv = process.env as Record<string, string | undefined>;
(globalThis as { React?: typeof React }).React = React;

const LIVE_ENV: PaymentEnv = {
  PAYMENT_MODE: "waffo-test",
  WAFFO_MERCHANT_ID: MERCHANT_ID,
  WAFFO_STORE_ID: STORE_ID,
  WAFFO_PRODUCT_ID: PRODUCT_ID,
  WAFFO_PRIVATE_KEY: requestPrivateKey,
  WAFFO_PUBLIC_BASE_URL: "https://local.example",
  WAFFO_WEBHOOK_TEST_PUBLIC_KEY: webhookPublicKey,
};

function count(db: AppDb, sql: string): number {
  return (db.prepare(sql).get() as { count: number } | undefined)?.count ?? 0;
}

function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    business: "North London Movers",
    category: "movers",
    city: "london",
    siteUrl: "https://north.example",
    licenseId: null,
    bidUsd: 20,
    weekId: OPEN_WEEK,
    ...overrides,
  };
}

function livePort(
  db: AppDb,
  responses: Array<Record<string, unknown> | Error> = [],
  options: { checkoutTimeoutMs?: number } = {},
): LivePaymentPort {
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    const sessionId = String(response?.sessionId ?? "SES_1234567890123456789012");
    const checkoutUrl = String(
      response?.checkoutUrl ?? `https://pancake.waffo.ai/store/test/checkout/${sessionId}`,
    );
    const expiresAt = String(response?.expiresAt ?? new Date(Date.now() + 600_000).toISOString());
    const status = Number(response?.status ?? 200);
    const body =
      status >= 400
        ? (response?.data ?? { errors: [{ message: "provider error" }] })
        : { data: response?.data ?? { sessionId, checkoutUrl, expiresAt } };
    void init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return new LivePaymentPort({ db, env: LIVE_ENV, fetch: fetchFn, ...options });
}

function intentRow(db: AppDb, id: string): Record<string, unknown> {
  const row = db.prepare("SELECT * FROM waffo_intents WHERE intent_id = ?").get(id) as Record<string, unknown> | undefined;
  assert.ok(row, `intent ${id} exists`);
  return row;
}

function completedEvent(
  db: AppDb,
  checkoutId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const intent = intentRow(db, checkoutId);
  const metadata = {
    intentId: String(intent.intent_id),
    intentFingerprint: String(intent.intent_fingerprint),
    intent: String(intent.intent_kind),
    targetBidCents: String(intent.target_bid_cents),
    quoteBaseBidCents: String(intent.quote_base_bid_cents),
    chargeCents: String(intent.charge_cents),
    canonicalUrl: String(intent.site_url),
    business: String(intent.business),
    category: String(intent.category),
    city: String(intent.city),
    weekId: String(intent.week_id),
    licenseId: String(intent.license_id ?? ""),
    providerProductId: String(intent.provider_product_id),
  };
  const suffix = checkoutId.replace(/[^A-Za-z0-9]/g, "").slice(-22).padStart(22, "0");
  const data = {
    orderId: `ORD_${suffix}`,
    orderStatus: "completed",
    paymentId: `PAY_${suffix}`,
    paymentStatus: "succeeded",
    currency: "USD",
    amount: centsToDisplay(Number(intent.charge_cents)),
    taxAmount: "0.00",
    subtotal: centsToDisplay(Number(intent.charge_cents)),
    total: centsToDisplay(Number(intent.charge_cents)),
    productId: String(intent.provider_product_id),
    orderMerchantExternalId: checkoutId,
    orderMetadata: metadata,
    ...overrides,
  };
  return {
    id: `DEL_${checkoutId.slice(-8)}`,
    timestamp: new Date().toISOString(),
    eventType: "order.completed",
    eventId: data.paymentId,
    storeId: String(intent.provider_store_id),
    storeName: "Local Waffo Test Store",
    mode: "test",
    data,
  };
}

function centsToDisplay(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function signedBody(event: Record<string, unknown>, timestamp = Date.now()): { body: string; signature: string } {
  const body = JSON.stringify(event);
  const sign = createSign("RSA-SHA256");
  sign.update(`${timestamp}.${body}`);
  return { body, signature: `t=${timestamp},v1=${sign.sign(webhookPrivateKey, "base64")}` };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function runSettlementWorker(
  dbPath: string,
  event: Record<string, unknown>,
  env: PaymentEnv,
  deliveryId: string,
): Promise<Record<string, unknown>> {
  const dbModule = pathToFileURL(join(process.cwd(), "src/db.ts")).href;
  const liveModule = pathToFileURL(join(process.cwd(), "src/billing/live.ts")).href;
  const source = `
    const { parentPort, workerData } = require("node:worker_threads");
    const { register } = require("tsx/esm/api");
    register();
    (async () => {
      const { openDatabase } = await import(${JSON.stringify(dbModule)});
      const { processWaffoWebhookEvent } = await import(${JSON.stringify(liveModule)});
      const db = openDatabase(workerData.dbPath);
      try {
        parentPort.postMessage(processWaffoWebhookEvent(
          workerData.event,
          db,
          workerData.deliveryId,
          workerData.env,
        ));
      } finally {
        db.close();
      }
    })().catch((error) => {
      parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
    });
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, {
      eval: true,
      workerData: { dbPath, event, env, deliveryId },
      execArgv: [],
    });
    worker.once("message", (message: unknown) => {
      void worker.terminate().then(() => resolve(message as Record<string, unknown>), reject);
    });
    worker.once("error", reject);
  });
}

after(() => {
  resetPaymentFixture();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  setPaymentPortForTests(undefined);
  for (const key of Object.keys(LIVE_ENV)) delete mutableEnv[key];
  delete mutableEnv.DATABASE_PATH;
  delete mutableEnv.NODE_ENV;
});

test("Waffo anonymous checkout sends dynamic USD priceSnapshot and complete intent metadata", async () => {
  const db = openDatabase(":memory:");
  const seen: { url?: string; body?: Record<string, unknown> } = {};
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(input);
    seen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      data: {
        sessionId: "SES_1234567890123456789012",
        checkoutUrl: "https://pancake.waffo.ai/store/test/checkout/SES_1234567890123456789012",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const live = new LivePaymentPort({ db, env: LIVE_ENV, fetch: fetchFn });
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  assert.equal(started.status, "open");
  assert.equal(seen.url, "https://api.waffo.ai/v1/actions/checkout/create-session");
  assert.deepEqual(seen.body?.priceSnapshot, { amount: "20.00", taxCategory: "digital_goods" });
  assert.equal(seen.body?.productId, PRODUCT_ID);
  assert.equal(seen.body?.currency, "USD");
  assert.equal(seen.body?.orderMerchantExternalId, started.id);
  assert.match(String(seen.body?.successUrl), new RegExp(`/checkout/complete\\?intent=${started.id}`));
  const metadata = seen.body?.metadata as Record<string, unknown>;
  assert.equal(metadata.intentFingerprint !== "", true);
  for (const value of Object.values(metadata)) assert.equal(typeof value, "string");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
  db.close();
});

test("provider mode is explicit, legacy provider flags are inert, and production never runs fixture", () => {
  assert.equal(waffoMode({ PAYMENT_MODE: "fixture" }), "fixture");
  assert.equal(waffoMode({ WAFFO_MODE: "waffo-test" }), "waffo-test");
  assert.equal(waffoMode({ WAFFO_LIVE: "1" }), undefined);
  assert.throws(
    () => validateWaffoConfiguration({ NODE_ENV: "production", PAYMENT_MODE: "fixture" }),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_fixture_forbidden",
  );
  assert.throws(
    () => validateWaffoConfiguration({
      NODE_ENV: "production",
      PAYMENT_MODE: "fixture",
      POLAR_FIXTURE_ONLY: "1",
    }),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_fixture_forbidden",
  );
  assert.equal(waffoMode({ PAYMENT_MODE: "waffo-prod", POLAR_FIXTURE_ONLY: "1" }), "waffo-prod");
  assert.equal(
    validateWaffoConfiguration({
      ...LIVE_ENV,
      NODE_ENV: "production",
      DATABASE_PATH: "/tmp/waffo-test-isolated.sqlite",
    }),
    "waffo-test",
  );
  assert.equal(
    validateWaffoConfiguration({
      ...LIVE_ENV,
      PAYMENT_MODE: "waffo-prod",
      WAFFO_WEBHOOK_PROD_PUBLIC_KEY: webhookPublicKey,
      NODE_ENV: "production",
      DATABASE_PATH: "/tmp/waffo-prod-isolated.sqlite",
    }),
    "waffo-prod",
  );
  for (const marker of [
    { VERCEL_ENV: "production" },
    { APP_ENV: "production" },
    { DEPLOY_ENV: "production" },
    { BUILD_ENV: "production" },
    { NEXT_PHASE: "phase-production-server" },
    { NEXT_PHASE: "phase-production-build" },
  ]) {
    assert.equal(isProductionLike({ PAYMENT_MODE: "fixture", ...marker }), true);
    assert.throws(
      () => validateWaffoConfiguration({
        PAYMENT_MODE: "fixture",
        ...marker,
        POLAR_LIVE: "1",
        POLAR_FIXTURE_ONLY: "1",
        WAFFO_LIVE: "1",
      }),
      (error: unknown) => error instanceof PaymentError && error.code === "waffo_fixture_forbidden",
    );
  }
  assert.equal(
    isProductionLike({ PAYMENT_MODE: "fixture", VERCEL_ENV: " PRODUCTION " }),
    true,
  );
  assert.throws(
    () => validateWaffoConfiguration({
      ...LIVE_ENV,
      PAYMENT_MODE: "waffo-prod",
      WAFFO_WEBHOOK_PROD_PUBLIC_KEY: webhookPublicKey,
      DATABASE_PATH: "/tmp/waffo-prod-isolated.sqlite",
      WAFFO_API_BASE: "https://sandbox.waffo.ai",
    }),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_api_base_invalid",
  );
  assert.throws(
    () => validateWaffoConfiguration({
      ...LIVE_ENV,
      WAFFO_API_BASE: "http://provider.example",
    }),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_api_base_invalid",
  );
  for (const publicUrl of [
    "https://127.0.0.1",
    "https://10.0.0.4",
    "https://172.16.0.8",
    "https://192.168.1.9",
    "https://169.254.10.2",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://localhost",
  ]) {
    assert.throws(
      () => validateWaffoConfiguration({ ...LIVE_ENV, WAFFO_PUBLIC_BASE_URL: publicUrl }),
      (error: unknown) => error instanceof Error && error.message.includes("WAFFO_PUBLIC_BASE_URL"),
    );
  }
  const previous = process.env.POLAR_FIXTURE_ONLY;
  const previousMode = process.env.PAYMENT_MODE;
  const previousNode = process.env.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  mutableEnv.POLAR_FIXTURE_ONLY = "1";
  delete mutableEnv.PAYMENT_MODE;
  try {
    assert.throws(
      () => getPaymentPort(openDatabase(":memory:")),
      (error: unknown) => error instanceof PaymentError && error.code === "waffo_mode_required",
    );
  } finally {
    restoreEnv("POLAR_FIXTURE_ONLY", previous);
    restoreEnv("PAYMENT_MODE", previousMode);
    restoreEnv("NODE_ENV", previousNode);
  }
});

test("Waffo mode aliases and provider/public origins are pinned", () => {
  const env = {
    ...LIVE_ENV,
    DATABASE_PATH: "/tmp/waffo-config-regression.sqlite",
  };
  assert.throws(
    () => validateWaffoConfiguration({ ...env, WAFFO_MODE: "waffo-prod" }),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_mode_conflict",
  );
  for (const publicBase of ["https://local.example/callback", "https://local.example:8443"]) {
    assert.throws(
      () => validateWaffoConfiguration({ ...env, WAFFO_PUBLIC_BASE_URL: publicBase }),
      (error: unknown) => error instanceof Error && error.message.includes("WAFFO_PUBLIC_BASE_URL"),
    );
  }
  assert.throws(
    () => validateWaffoConfiguration({ ...env, WAFFO_API_BASE: "https://evil.example" }),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_api_base_invalid",
  );
});

test("Waffo checkout response requires an official session URL and usable canonical expiry", async () => {
  const cases = [
    {
      checkoutUrl: "https://evil.example/not-pancake",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    },
    {
      checkoutUrl: "https://pancake.waffo.ai/store/test/checkout/SES_other",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    },
    {
      checkoutUrl: "https://pancake.waffo.ai/store/test/checkout/SES_1234567890123456789012",
      expiresAt: "2020-01-01T00:00:00.000Z",
    },
    {
      checkoutUrl: "https://pancake.waffo.ai/store/test/checkout/SES_1234567890123456789012",
      expiresAt: "2030-01-01 00:00:00",
    },
  ];
  for (const [index, response] of cases.entries()) {
    const db = openDatabase(":memory:");
    const live = livePort(db, [{
      sessionId: "SES_1234567890123456789012",
      ...response,
    }]);
    await assert.rejects(
      () => live.createCheckout({
        amountUsd: 20,
        listing: draft({ siteUrl: `https://checkout-response-${index}.example` }),
      }),
      (error: unknown) => error instanceof PaymentError && error.code === "waffo_checkout_unknown",
    );
    const intent = db.prepare("SELECT state, provider_session_id, checkout_url, expires_at FROM waffo_intents").get() as {
      state: string;
      provider_session_id: string | null;
      checkout_url: string | null;
      expires_at: string | null;
    };
    assert.equal(intent.state, "unknown");
    assert.equal(intent.provider_session_id, null);
    assert.equal(intent.checkout_url, null);
    assert.equal(intent.expires_at, null);
    assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
    db.close();
  }
});

test("timeout, 5xx, and invalid response stay recoverable unknown intents", async () => {
  const cases: Array<Record<string, unknown> | Error> = [
    new Error("timeout"),
    { status: 503, data: { errors: [{ message: "busy" }] } },
    { data: { sessionId: "SES_1234567890123456789012" } },
  ];
  for (const response of cases) {
    const db = openDatabase(":memory:");
    const live = livePort(db, [response]);
    await assert.rejects(
      () => live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: `https://${Math.random().toString(16).slice(2)}.example` }) }),
      (error: unknown) => error instanceof PaymentError && error.code === "waffo_checkout_unknown",
    );
    const row = db.prepare("SELECT state FROM waffo_intents").get() as { state: string };
    assert.equal(row.state, "unknown");
    assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
    db.close();
  }
});

test("checkout deadline covers a response whose body never completes", async () => {
  const db = openDatabase(":memory:");
  let aborted = false;
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
    }, { once: true });
    return new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const live = new LivePaymentPort({
    db,
    env: LIVE_ENV,
    fetch: fetchFn,
    checkoutTimeoutMs: 25,
  });
  const startedAt = Date.now();
  await assert.rejects(
    () => live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: "https://body-timeout.example" }) }),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_checkout_unknown",
  );
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(aborted, true);
  assert.equal((db.prepare("SELECT state FROM waffo_intents").get() as { state: string }).state, "unknown");
  db.close();
});

test("ambiguous checkout statuses and malformed SDK errors stay recoverable", async () => {
  const cases: Array<{ status: number; data?: Record<string, unknown>; state: "unknown" | "rejected" }> = [
    { status: 408, state: "unknown" },
    { status: 409, state: "unknown" },
    { status: 425, state: "unknown" },
    { status: 429, state: "unknown" },
    { status: 500, state: "unknown" },
    { status: 400, data: { message: "not an error envelope" }, state: "unknown" },
    {
      status: 400,
      data: { errors: [{ message: "checkout is invalid", layer: "checkout" }] },
      state: "rejected",
    },
  ];
  for (const [index, item] of cases.entries()) {
    const db = openDatabase(":memory:");
    const live = livePort(db, [{ status: item.status, data: item.data }]);
    await assert.rejects(
      () => live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: `https://status-${index}.example` }) }),
      (error: unknown) => error instanceof PaymentError &&
        error.code === (item.state === "rejected" ? "waffo_checkout_rejected" : "waffo_checkout_unknown"),
    );
    assert.equal((db.prepare("SELECT state FROM waffo_intents").get() as { state: string }).state, item.state);
    assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
    db.close();
  }
});

test("a non-JSON 4xx response is an ambiguous checkout outcome", async () => {
  const db = openDatabase(":memory:");
  const fetchFn = (async () => new Response("upstream returned HTML", {
    status: 400,
    headers: { "content-type": "text/html" },
  })) as typeof fetch;
  const live = new LivePaymentPort({ db, env: LIVE_ENV, fetch: fetchFn });
  await assert.rejects(
    () => live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: "https://non-json-4xx.example" }) }),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_checkout_unknown",
  );
  assert.equal((db.prepare("SELECT state FROM waffo_intents").get() as { state: string }).state, "unknown");
  db.close();
});

test("cancelling an ambiguous return keeps the intent recoverable", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [new Error("connection reset after capture")]);
  await assert.rejects(
    () => live.createCheckout({ amountUsd: 20, listing: draft() }),
    (error: unknown) => error instanceof PaymentError && error.code === "waffo_checkout_unknown",
  );
  const intent = db.prepare("SELECT intent_id, state FROM waffo_intents").get() as { intent_id: string; state: string };
  assert.equal(intent.state, "unknown");
  const returned = await handleCheckoutReturn({ checkout: intent.intent_id, status: "cancelled" }, live);
  assert.equal(returned.state, "cancelled");
  assert.equal((intentRow(db, intent.intent_id).state), "unknown");
  assert.equal((db.prepare("SELECT status FROM checkouts WHERE id = ?").get(intent.intent_id) as { status: string }).status, "open");
  assert.equal(processWaffoWebhookEvent(completedEvent(db, intent.intent_id), db, "ambiguous-recovered", LIVE_ENV).status, "processed");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 1);
  db.close();
});

test("live browser cancellation is read-only and a later webhook can still settle", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  const returned = await handleCheckoutReturn(
    { checkout: started.id, status: "cancelled" },
    live,
  );
  assert.equal(returned.state, "cancelled");
  assert.equal(
    (db.prepare("SELECT status FROM checkouts WHERE id = ?").get(started.id) as { status: string }).status,
    "open",
  );
  assert.equal(intentRow(db, started.id).state, "open");
  assert.equal(
    (db.prepare("SELECT state FROM waffo_checkout_events WHERE intent_id = ?").get(started.id) as { state: string }).state,
    "open",
  );
  assert.equal(
    processWaffoWebhookEvent(completedEvent(db, started.id), db, "live-cancel-recovered", LIVE_ENV).status,
    "processed",
  );
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 1);
  db.close();
});

test("provider response attach failure remains unknown and later signed facts reconcile", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  db.exec(`CREATE TRIGGER fail_waffo_attach BEFORE UPDATE OF provider_checkout_id ON checkouts
    WHEN NEW.provider_checkout_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'attach failed'); END`);
  await assert.rejects(() => live.createCheckout({ amountUsd: 20, listing: draft() }), /attach Waffo checkout/);
  const intent = db.prepare("SELECT intent_id, state FROM waffo_intents").get() as { intent_id: string; state: string };
  assert.equal(intent.state, "unknown");
  db.exec("DROP TRIGGER fail_waffo_attach");
  const result = processWaffoWebhookEvent(completedEvent(db, intent.intent_id), db, "delivery-attach", LIVE_ENV);
  assert.equal(result.status, "processed");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 1);
  assert.equal(live.getCheckout(intent.intent_id)?.providerState, "attached");
  db.close();
});

test("a signed capture racing checkout response cannot be reopened by attachment", async () => {
  const db = openDatabase(":memory:");
  const sessionId = "SES_4234567890123456789012";
  let release!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchFn = (async () => {
    await responseReady;
    return new Response(JSON.stringify({
      data: {
        sessionId,
        checkoutUrl: `https://pancake.waffo.ai/store/test/checkout/${sessionId}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const live = new LivePaymentPort({ db, env: LIVE_ENV, fetch: fetchFn });
  const pending = live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: "https://attach-race.example" }) });
  const intent = db.prepare("SELECT intent_id FROM waffo_intents").get() as { intent_id: string };
  const paid = processWaffoWebhookEvent(
    completedEvent(db, intent.intent_id),
    db,
    "attach-race-delivery",
    LIVE_ENV,
  );
  assert.equal(paid.status, "processed");
  release();
  const started = await pending;
  assert.equal(started.status, "paid");
  assert.equal(started.providerCheckoutId, sessionId);
  assert.equal(intentRow(db, intent.intent_id).state, "paid");
  assert.equal(
    (db.prepare("SELECT state, provider_session_id FROM waffo_checkout_events WHERE intent_id = ?").get(intent.intent_id) as {
      state: string;
      provider_session_id: string | null;
    }).state,
    "paid",
  );
  assert.equal(
    (db.prepare("SELECT provider_checkout_id, status FROM checkouts WHERE id = ?").get(intent.intent_id) as {
      provider_checkout_id: string | null;
      status: string;
    }).provider_checkout_id,
    sessionId,
  );
  db.close();
});

test("browser return never settles before a verified order.completed event", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  const returned = await handleCheckoutReturn({ checkout: started.id }, live);
  assert.equal(returned.state, "unknown");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
  const paid = processWaffoWebhookEvent(completedEvent(db, started.id), db, "delivery-return", LIVE_ENV);
  assert.equal(paid.status, "processed");
  assert.equal((await handleCheckoutReturn({ checkout: started.id }, live)).state, "paid");
  db.close();
});

test("Waffo success callback consumes intent on the exact read-only route", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  setPaymentPortForTests(live);
  const html = renderToStaticMarkup(
    await CheckoutCompletePage({
      searchParams: Promise.resolve({ intent: started.id }),
    }),
  );
  assert.match(html, /data-return="unknown"/);
  assert.match(html, /Unpaid checkout drafts never appear/);
  assert.equal(
    (db.prepare("SELECT status FROM checkouts WHERE id = ?").get(started.id) as { status: string }).status,
    "open",
  );
  assert.equal(intentRow(db, started.id).state, "open");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
  db.close();
});

test("exact replay is a 2xx no-op; changed delivery or payload is auditable rejection", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  const event = completedEvent(db, started.id);
  const first = processWaffoWebhookEvent(event, db, "delivery-one", LIVE_ENV);
  const replay = processWaffoWebhookEvent(event, db, "delivery-one", LIVE_ENV);
  const secondDelivery = processWaffoWebhookEvent(event, db, "delivery-two", LIVE_ENV);
  const changed = processWaffoWebhookEvent(
    { ...event, data: { ...(event.data as Record<string, unknown>), subtotal: "21.00" } },
    db,
    "delivery-one",
    LIVE_ENV,
  );
  assert.equal(first.status, "processed");
  assert.equal(replay.status, "duplicate");
  assert.equal(secondDelivery.status, "duplicate");
  assert.equal(changed.status, "rejected");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_events"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_rejections"), 1);
  db.close();
});

test("mismatched signed facts never rank", async () => {
  const mismatches: Array<Record<string, unknown>> = [
    { currency: "EUR" },
    { productId: "PROD_9999999999999999999999" },
    { orderStatus: "pending" },
    { paymentStatus: "failed" },
    { subtotal: "21.00" },
  ];
  for (const mismatch of mismatches) {
    const db = openDatabase(":memory:");
    const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
    const started = await live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: `https://${Math.random().toString(16).slice(2)}.example` }) });
    const event = completedEvent(db, started.id, mismatch);
    const result = processWaffoWebhookEvent(event, db, `mismatch-${Math.random()}`, LIVE_ENV);
    assert.equal(result.status, "ignored");
    assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
    db.close();
  }
});

test("present monetary fields are exact and tax cannot inflate the ranked bid", async () => {
  const malformedCases: Array<{ field: string; value: string; reason: string }> = [
    { field: "subtotal", value: "20.000", reason: "subtotal_invalid" },
    { field: "taxAmount", value: "not-a-number", reason: "tax_invalid" },
    { field: "amount", value: "999.00", reason: "amount_mismatch" },
    { field: "total", value: "999.00", reason: "total_mismatch" },
  ];
  for (const [index, malformed] of malformedCases.entries()) {
    const db = openDatabase(":memory:");
    const live = livePort(db, [{ sessionId: `SES_${String(index).padStart(2, "0")}34567890123456789012` }]);
    const started = await live.createCheckout({
      amountUsd: 20,
      listing: draft({ siteUrl: `https://money-${index}.example` }),
    });
    const result = processWaffoWebhookEvent(
      completedEvent(db, started.id, { [malformed.field]: malformed.value }),
      db,
      `money-${index}`,
      LIVE_ENV,
    );
    assert.equal(result.status, "ignored");
    assert.equal(result.reason, malformed.reason);
    assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
    db.close();
  }

  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_3234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: "https://tax.example" }) });
  const taxed = completedEvent(db, started.id, {
    amount: "21.00",
    taxAmount: "1.00",
    subtotal: "20.00",
    total: "21.00",
  });
  assert.equal(processWaffoWebhookEvent(taxed, db, "money-tax", LIVE_ENV).status, "processed");
  const listing = db.prepare("SELECT bid_usd FROM listings WHERE id = (SELECT listing_id FROM checkouts WHERE id = ?)").get(started.id) as { bid_usd: number };
  assert.equal(listing.bid_usd, 20);
  db.close();
});

test("Waffo settlement needs direct product, exact string metadata, complete tax equations, and fresh event time", async () => {
  const cases: Array<{
    siteUrl: string;
    mutate: (event: Record<string, unknown>) => void;
    reason: string;
  }> = [
    {
      siteUrl: "https://direct-product.example",
      mutate: (event) => {
        const data = event.data as Record<string, unknown>;
        delete data.productId;
        data.productMetadata = { productId: PRODUCT_ID };
        (data.orderMetadata as Record<string, unknown>).providerProductId = PRODUCT_ID;
      },
      reason: "product_mismatch",
    },
    {
      siteUrl: "https://metadata-extra.example",
      mutate: (event) => {
        (event.data as Record<string, unknown>).orderMetadata = {
          ...(event.data as Record<string, unknown>).orderMetadata as Record<string, unknown>,
          unexpected: "value",
        };
      },
      reason: "metadata_keys_mismatch",
    },
    {
      siteUrl: "https://metadata-type.example",
      mutate: (event) => {
        (event.data as Record<string, unknown>).orderMetadata = {
          ...(event.data as Record<string, unknown>).orderMetadata as Record<string, unknown>,
          business: 42,
        };
      },
      reason: "metadata_invalid",
    },
    {
      siteUrl: "https://money-amount-missing.example",
      mutate: (event) => {
        delete (event.data as Record<string, unknown>).amount;
      },
      reason: "amount_missing",
    },
    {
      siteUrl: "https://money-total-missing.example",
      mutate: (event) => {
        delete (event.data as Record<string, unknown>).total;
      },
      reason: "total_missing",
    },
    {
      siteUrl: "https://stale-event.example",
      mutate: (event) => {
        event.timestamp = "1970-01-01T00:00:00.000Z";
      },
      reason: "provider_timestamp_stale",
    },
    {
      siteUrl: "https://future-event.example",
      mutate: (event) => {
        event.timestamp = "2999-01-01T00:00:00.000Z";
      },
      reason: "provider_timestamp_stale",
    },
  ];
  for (const [index, item] of cases.entries()) {
    const db = openDatabase(":memory:");
    const live = livePort(db, [{ sessionId: `SES_${String(index + 6).padStart(2, "0")}34567890123456789012` }]);
    const started = await live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: item.siteUrl }) });
    const event = completedEvent(db, started.id);
    item.mutate(event);
    const result = processWaffoWebhookEvent(event, db, `shape-${index}`, LIVE_ENV);
    assert.equal(
      result.status,
      item.reason.startsWith("provider_timestamp_") ? "needs_reconciliation" : "ignored",
    );
    assert.equal(result.reason, item.reason);
    assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
    db.close();
  }
});

test("provider paid time is causally anchored and uses the board visibility window", async () => {
  const cases: Array<{
    siteUrl: string;
    mutate: (event: Record<string, unknown>, intent: Record<string, unknown>) => void;
    reason: string;
  }> = [
    {
      siteUrl: "https://pre-intent.example",
      mutate: (event, intent) => {
        event.timestamp = new Date(
          Date.parse(String(intent.created_at)) - ROLLING_WEEK_CLOCK_SKEW_MS - 1,
        ).toISOString();
      },
      reason: "provider_timestamp_stale",
    },
    {
      siteUrl: "https://future-window.example",
      mutate: (event) => {
        event.timestamp = new Date(
          Date.now() + ROLLING_WEEK_CLOCK_SKEW_MS + 250,
        ).toISOString();
      },
      reason: "provider_timestamp_stale",
    },
    {
      siteUrl: "https://stale-window.example",
      mutate: (event) => {
        event.timestamp = "1970-01-01T00:00:00.000Z";
      },
      reason: "provider_timestamp_stale",
    },
    {
      siteUrl: "https://malformed-time.example",
      mutate: (event) => {
        event.timestamp = "not-an-iso-timestamp";
      },
      reason: "provider_timestamp_missing",
    },
  ];
  for (const [index, item] of cases.entries()) {
    const db = openDatabase(":memory:");
    const live = livePort(db, [{ sessionId: `SES_${String(index + 7).padStart(2, "0")}34567890123456789012` }]);
    const started = await live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: item.siteUrl }) });
    const event = completedEvent(db, started.id);
    item.mutate(event, intentRow(db, started.id));
    const result = processWaffoWebhookEvent(event, db, `causal-time-${index}`, LIVE_ENV);
    assert.equal(result.status, "needs_reconciliation");
    assert.equal(result.reason, item.reason);
    assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
    db.close();
  }
});

test("signed capture mode is canonical and must match the selected Waffo environment", async () => {
  for (const [index, mode] of (["waffo-test", "waffo-prod", "production"] as const).entries()) {
    const db = openDatabase(":memory:");
    const live = livePort(db, [{ sessionId: `SES_${String(index + 8).padStart(2, "0")}34567890123456789012` }]);
    const started = await live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: `https://mode-alias-${index}.example` }) });
    const event = completedEvent(db, started.id);
    event.mode = mode;
    const result = processWaffoWebhookEvent(event, db, `mode-alias-${index}`, LIVE_ENV);
    assert.equal(result.status, "ignored");
    assert.equal(result.reason, "mode_mismatch");
    assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
    db.close();
  }
});

test("two equal bids rank by provider event instant, not checkout creation", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [
    { sessionId: "SES_1234567890123456789012" },
    { sessionId: "SES_2234567890123456789012" },
  ]);
  const first = await live.createCheckout({ amountUsd: 20, listing: draft({ business: "Paid Later", siteUrl: "https://later.example" }) });
  const second = await live.createCheckout({ amountUsd: 20, listing: draft({ business: "Paid Early", siteUrl: "https://early.example" }) });
  // Both signed paid instants must be causally after both immutable intents;
  // keep the ordering deterministic without using a pre-intent fixture time.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const settledAt = Date.now();
  const laterPaidAt = new Date(settledAt - 1).toISOString();
  const earlyPaidAt = new Date(settledAt - 2).toISOString();
  const later = completedEvent(db, first.id);
  later.timestamp = laterPaidAt;
  const early = completedEvent(db, second.id);
  early.timestamp = earlyPaidAt;
  assert.equal(processWaffoWebhookEvent(later, db, "delivery-later", LIVE_ENV).status, "processed");
  assert.equal(processWaffoWebhookEvent(early, db, "delivery-early", LIVE_ENV).status, "processed");
  const ranked = listLane("london", "movers", db);
  assert.deepEqual(ranked.map((row) => row.business), ["Paid Early", "Paid Later"]);
  assert.equal(ranked[0]?.createdAt, earlyPaidAt);
  db.close();
});

test("raise sends target-current only and preserves initial paid createdAt", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [
    { sessionId: "SES_1234567890123456789012" },
    { sessionId: "SES_2234567890123456789012" },
  ]);
  const initial = await live.createCheckout({ amountUsd: 20, listing: draft() });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const paidAt = new Date(Date.now() - 2).toISOString();
  const initialEvent = completedEvent(db, initial.id);
  initialEvent.timestamp = paidAt;
  assert.equal(processWaffoWebhookEvent(initialEvent, db, "initial-paid", LIVE_ENV).status, "processed");
  const raised = await raiseListing(draft({ bidUsd: 27 }), live, db);
  assert.equal(raised.quote.chargeUsd, 7);
  const bodyIntent = intentRow(db, raised.checkoutId);
  assert.equal(bodyIntent.charge_cents, 700);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const raisedAt = new Date(Date.now() - 2).toISOString();
  const raiseEvent = completedEvent(db, raised.checkoutId);
  raiseEvent.timestamp = raisedAt;
  assert.equal(processWaffoWebhookEvent(raiseEvent, db, "raise-paid", LIVE_ENV).status, "processed");
  const row = listLane("london", "movers", db)[0];
  assert.equal(row?.bidUsd, 27);
  assert.equal(row?.createdAt, paidAt);
  assert.equal(row?.raisedAt, raisedAt);
  db.close();
});

test("stale captured raises become reconciliation and never add a second charge", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [
    { sessionId: "SES_1234567890123456789012" },
    { sessionId: "SES_2234567890123456789012" },
    { sessionId: "SES_3234567890123456789012" },
  ]);
  const initial = await live.createCheckout({ amountUsd: 20, listing: draft() });
  assert.equal(processWaffoWebhookEvent(completedEvent(db, initial.id), db, "stale-initial", LIVE_ENV).status, "processed");
  const raiseOne = await raiseListing(draft({ bidUsd: 27 }), live, db);
  const raiseTwo = await raiseListing(draft({ bidUsd: 27 }), live, db);
  assert.equal(processWaffoWebhookEvent(completedEvent(db, raiseTwo.checkoutId), db, "stale-two", LIVE_ENV).status, "processed");
  const stale = processWaffoWebhookEvent(completedEvent(db, raiseOne.checkoutId), db, "stale-one", LIVE_ENV);
  assert.equal(stale.status, "needs_reconciliation");
  assert.equal(listLane("london", "movers", db)[0]?.bidUsd, 27);
  assert.equal((intentRow(db, raiseOne.checkoutId).state), "needs_reconciliation");
  db.close();
});

test("missing or multiple product configuration fails before any fetch", () => {
  for (const product of [undefined, "PROD_1234567890123456789012,PROD_2234567890123456789012", " "]) {
    const db = openDatabase(":memory:");
    let fetches = 0;
    const env = { ...LIVE_ENV, WAFFO_PRODUCT_ID: product };
    assert.throws(
      () => new LivePaymentPort({ db, env, fetch: (async () => { fetches += 1; throw new Error("must not call"); }) as typeof fetch }),
      (error: unknown) => error instanceof PaymentError && error.code === "waffo_product_missing",
    );
    assert.equal(fetches, 0);
    db.close();
  }
});

test("rollback records recoverable reconciliation without ranking", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  const event = completedEvent(db, started.id);
  db.exec(`CREATE TRIGGER fail_waffo_listing BEFORE INSERT ON listings
    BEGIN SELECT RAISE(ABORT, 'rank rollback'); END`);
  const result = processWaffoWebhookEvent(event, db, "rollback-delivery", LIVE_ENV);
  assert.equal(result.status, "needs_reconciliation");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_events WHERE outcome = 'needs_reconciliation'"), 1);
  assert.equal(intentRow(db, started.id).state, "needs_reconciliation");
  db.exec("DROP TRIGGER fail_waffo_listing");
  assert.equal(processWaffoWebhookEvent(event, db, "rollback-delivery", LIVE_ENV).status, "processed");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 1);
  db.close();
});

test("canonical Waffo route uses signed event.id and rejects conflicting webhook-id", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  setPaymentPortForTests(live);
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(LIVE_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const event = completedEvent(db, started.id);
  const signed = signedBody(event);
  const response = await postWebhook(new Request("http://local/api/webhooks/waffo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature, "webhook-id": String(event.id) },
    body: signed.body,
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "processed");
  assert.equal((db.prepare("SELECT delivery_id FROM waffo_webhook_events").get() as { delivery_id: string }).delivery_id, String(event.id));
  assert.deepEqual(verifyWaffoWebhook(signed.body, signed.signature, LIVE_ENV).eventType, "order.completed");
  for (const [key, value] of Object.entries(saved)) restoreEnv(key, value);
  db.close();
});

test("webhook audit failure is retryable and is never acknowledged as durable", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_5234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: "https://audit-failure.example" }) });
  setPaymentPortForTests(live);
  db.exec(`CREATE TRIGGER fail_waffo_audit BEFORE UPDATE OF outcome ON waffo_webhook_events
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
  const event = completedEvent(db, started.id);
  const signed = signedBody(event);
  const response = await postWebhook(new Request("http://local/api/webhooks/waffo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-waffo-signature": signed.signature,
      "webhook-id": String(event.id),
    },
    body: signed.body,
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { status: string; durable: boolean }).durable, false);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_events"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
  assert.equal(intentRow(db, started.id).state, "open");
  db.exec("DROP TRIGGER fail_waffo_audit");
  db.close();
});

test("conflicting unsigned webhook-id cannot override a verified event.id", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  setPaymentPortForTests(live);
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(LIVE_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const signed = signedBody(completedEvent(db, started.id));
  const response = await postWebhook(new Request("http://local/api/webhooks/waffo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature, "webhook-id": "unsigned-conflict" },
    body: signed.body,
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: string }).error, "webhook_id_mismatch");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_events"), 0);
  for (const [key, value] of Object.entries(saved)) restoreEnv(key, value);
  db.close();
});

test("signed payload without the official event.eventId is rejected before the ledger", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  setPaymentPortForTests(live);
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(LIVE_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const event = completedEvent(db, started.id);
  const data = event.data as Record<string, unknown>;
  delete event.eventId;
  event.id = data.paymentId;
  const signed = signedBody(event);
  const response = await postWebhook(new Request("http://local/api/webhooks/waffo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-waffo-signature": signed.signature,
      "webhook-id": String(event.id),
    },
    body: signed.body,
  }));
  assert.equal(response.status, 409);
  const body = await response.json() as { status: string; reason: string };
  assert.equal(body.status, "rejected");
  assert.equal(body.reason, "provider_identity_missing");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_events"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_rejections"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 0);
  for (const [key, value] of Object.entries(saved)) restoreEnv(key, value);
  db.close();
});

test("missing-identity rejection is retryable when its audit append fails", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_6234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: "https://missing-audit.example" }) });
  setPaymentPortForTests(live);
  db.exec(`CREATE TRIGGER fail_waffo_rejection BEFORE INSERT ON waffo_webhook_rejections
    BEGIN SELECT RAISE(ABORT, 'rejection audit unavailable'); END`);
  const event = completedEvent(db, started.id);
  const data = event.data as Record<string, unknown>;
  delete event.eventId;
  event.id = data.paymentId;
  const signed = signedBody(event);
  const response = await postWebhook(new Request("http://local/api/webhooks/waffo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-waffo-signature": signed.signature,
      "webhook-id": String(event.id),
    },
    body: signed.body,
  }));
  assert.equal(response.status, 503);
  const body = await response.json() as { status: string; durable: boolean; reason: string };
  assert.equal(body.status, "rejected");
  assert.equal(body.durable, false);
  assert.equal(body.reason, "provider_identity_missing");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_rejections"), 0);
  db.close();
});

test("changed replay is retryable when its rejection audit append fails", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_7234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft({ siteUrl: "https://replay-audit.example" }) });
  setPaymentPortForTests(live);
  const original = completedEvent(db, started.id);
  const originalSigned = signedBody(original);
  const originalResponse = await postWebhook(new Request("http://local/api/webhooks/waffo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-waffo-signature": originalSigned.signature,
      "webhook-id": String(original.id),
    },
    body: originalSigned.body,
  }));
  assert.equal(originalResponse.status, 200);
  db.exec(`CREATE TRIGGER fail_waffo_replay_rejection BEFORE INSERT ON waffo_webhook_rejections
    BEGIN SELECT RAISE(ABORT, 'replay rejection audit unavailable'); END`);
  const changed = completedEvent(db, started.id);
  changed.id = original.id;
  (changed.data as Record<string, unknown>).total = "20.01";
  const changedSigned = signedBody(changed);
  const changedResponse = await postWebhook(new Request("http://local/api/webhooks/waffo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-waffo-signature": changedSigned.signature,
      "webhook-id": String(changed.id),
    },
    body: changedSigned.body,
  }));
  assert.equal(changedResponse.status, 503);
  const body = await changedResponse.json() as { status: string; durable: boolean; reason: string };
  assert.equal(body.status, "rejected");
  assert.equal(body.durable, false);
  assert.equal(body.reason, "event_reuse_mismatch");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM listings"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_rejections"), 0);
  db.close();
});

test("obsolete provider webhook route is inert", async () => {
  const response = await postObsoleteWebhook(new Request("http://local/api/webhooks/polar", { method: "POST" }));
  assert.equal(response.status, 410);
  assert.equal((await response.json() as { endpoint: string }).endpoint, "/api/webhooks/waffo");
});

test("wrong webhook signature is rejected before the settlement ledger", async () => {
  const db = openDatabase(":memory:");
  const live = livePort(db, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await live.createCheckout({ amountUsd: 20, listing: draft() });
  setPaymentPortForTests(live);
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(LIVE_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const event = completedEvent(db, started.id);
  const response = await postWebhook(new Request("http://local/api/webhooks/waffo", {
    method: "POST",
    headers: { "content-type": "application/json", "x-waffo-signature": "t=1,v1=bad", "webhook-id": "bad-delivery" },
    body: JSON.stringify(event),
  }));
  assert.equal(response.status, 403);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM waffo_webhook_events"), 0);
  for (const [key, value] of Object.entries(saved)) restoreEnv(key, value);
  db.close();
});

test("restart and two independent instances share one atomic Waffo ledger", async () => {
  const dir = mkdtempSync(join(tmpdir(), "waffo-local-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "app.sqlite");
  const env = { ...LIVE_ENV, DATABASE_PATH: dbPath };
  const db1 = openDatabase(dbPath);
  const first = livePort(db1, [{ sessionId: "SES_1234567890123456789012" }]);
  const started = await first.createCheckout({ amountUsd: 20, listing: draft() });
  const db2 = openDatabase(dbPath);
  const event = completedEvent(db2, started.id);
  db1.close();
  db2.close();
  const [one, two] = await Promise.all([
    runSettlementWorker(dbPath, event, env, "restart-delivery"),
    runSettlementWorker(dbPath, event, env, "restart-delivery"),
  ]);
  assert.equal(one.error, undefined);
  assert.equal(two.error, undefined);
  const statuses = [one.status, two.status];
  assert.equal(statuses.filter((status) => status === "processed").length, 1);
  assert.equal(
    statuses.every(
      (status) =>
        status === "processed" ||
        status === "duplicate" ||
        status === "needs_reconciliation",
    ),
    true,
  );
  const reopened = openDatabase(dbPath);
  assert.equal(count(reopened, "SELECT COUNT(*) AS count FROM listings"), 1);
  assert.equal(count(reopened, "SELECT COUNT(*) AS count FROM waffo_webhook_events"), 1);
  assert.equal(
    (reopened.prepare("SELECT outcome FROM waffo_webhook_events").get() as { outcome: string }).outcome,
    "processed",
  );
  reopened.close();
});
