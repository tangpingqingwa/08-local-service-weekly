import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CITIES, PUBLIC_CITY_SLUGS, getCity } from "../src/cities";
import { openDatabase } from "../src/db";

process.env.DATABASE_PATH = ":memory:";

const mutableEnv = process.env as Record<string, string | undefined>;
const HEALTH_ENV_KEYS = [
  "PAYMENT_MODE",
  "WAFFO_MODE",
  "PAYMENT_PROVIDER_MODE",
  "NODE_ENV",
  "VERCEL_ENV",
  "APP_ENV",
  "DEPLOY_ENV",
  "BUILD_ENV",
  "NEXT_PHASE",
  "WAFFO_MERCHANT_ID",
  "WAFFO_STORE_ID",
  "WAFFO_PRODUCT_ID",
  "WAFFO_PRIVATE_KEY",
  "WAFFO_PRIVATE_KEY_FILE",
  "WAFFO_API_BASE",
  "WAFFO_PUBLIC_BASE_URL",
  "PUBLIC_BASE_URL",
  "WAFFO_WEBHOOK_TEST_PUBLIC_KEY",
  "WAFFO_WEBHOOK_PROD_PUBLIC_KEY",
  "DATABASE_PATH",
] as const;
type HealthEnvKey = (typeof HEALTH_ENV_KEYS)[number];

function withHealthEnv<T>(
  values: Partial<Record<HealthEnvKey, string | undefined>>,
  run: () => T,
): T {
  const previous = new Map<HealthEnvKey, string | undefined>();
  for (const key of HEALTH_ENV_KEYS) {
    previous.set(key, mutableEnv[key]);
    delete mutableEnv[key];
  }
  for (const key of Object.keys(values) as HealthEnvKey[]) {
    const value = values[key];
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  try {
    return run();
  } finally {
    for (const key of HEALTH_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete mutableEnv[key];
      else mutableEnv[key] = value;
    }
  }
}

test("GET /healthz returns 200 { ok: true }", async () => {
  const { GET } = await import("../app/healthz/route");
  const response = withHealthEnv(
    { PAYMENT_MODE: "fixture", NODE_ENV: "development", DATABASE_PATH: ":memory:" },
    GET,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("GET /healthz returns non-secret 503 for a production fixture", async () => {
  const { GET } = await import("../app/healthz/route");
  const response = withHealthEnv(
    { PAYMENT_MODE: "fixture", NODE_ENV: "production", DATABASE_PATH: ":memory:" },
    GET,
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "not_ready" });
});

test("GET /healthz returns non-secret 503 for missing production Waffo configuration", async () => {
  const { GET } = await import("../app/healthz/route");
  const response = withHealthEnv(
    { PAYMENT_MODE: "waffo-prod", NODE_ENV: "production", DATABASE_PATH: ":memory:" },
    GET,
  );

  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body, JSON.stringify({ ok: false, error: "not_ready" }));
  assert.doesNotMatch(body, /BLOCKED|SECRET|WAFFO_/i);
});

test("GET /healthz returns 200 for a valid production Waffo composition", async () => {
  const { GET } = await import("../app/healthz/route");
  const directory = mkdtempSync(join(tmpdir(), "local-service-health-"));
  const databasePath = join(directory, "health.sqlite");
  try {
    const response = withHealthEnv(
      {
        PAYMENT_MODE: "waffo-prod",
        NODE_ENV: "production",
        DATABASE_PATH: databasePath,
        WAFFO_MERCHANT_ID: "MER_1234567890123456789012",
        WAFFO_STORE_ID: "STO_1234567890123456789012",
        WAFFO_PRODUCT_ID: "PROD_1234567890123456789012",
        WAFFO_PRIVATE_KEY: "health-test-private-key",
        WAFFO_API_BASE: "https://api.waffo.ai",
        WAFFO_PUBLIC_BASE_URL: "https://health.example",
        WAFFO_WEBHOOK_PROD_PUBLIC_KEY: "health-test-webhook-key",
      },
      GET,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cities catalog ships London only as the v1 public lane", () => {
  assert.deepEqual(
    CITIES.map((city) => city.slug),
    ["london"],
  );
  assert.deepEqual(PUBLIC_CITY_SLUGS, ["london"]);
  assert.deepEqual(getCity("london"), {
    slug: "london",
    display: "London",
    public: true,
  });
  assert.equal(getCity("manchester"), undefined);
});

test("schema has cities, weeks, listings and seeds London", () => {
  const db = openDatabase(":memory:");
  after(() => db.close());

  const tables = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('checkouts', 'cities', 'listings', 'weeks') ORDER BY name",
    )
    .all();
  assert.deepEqual(
    tables.map((row) => row.name),
    ["checkouts", "cities", "listings", "weeks"],
  );

  const cityColumns = columnMap(db, "cities");
  assert.deepEqual(Object.keys(cityColumns), ["slug", "display", "public"]);
  assert.equal(cityColumns.slug.pk, 1);

  const weekColumns = columnMap(db, "weeks");
  assert.deepEqual(Object.keys(weekColumns), [
    "id",
    "timezone",
    "opens_at",
    "closes_at",
  ]);
  assert.equal(weekColumns.id.pk, 1);

  const listingColumns = columnMap(db, "listings");
  assert.deepEqual(Object.keys(listingColumns), [
    "id",
    "business",
    "category",
    "city",
    "site_url",
    "license_id",
    "bid_usd",
    "week_id",
    "created_at",
    "raised_at",
    "clicks",
    "hidden",
    "hidden_reason",
  ]);
  assert.equal(listingColumns.id.pk, 1);
  assert.equal(listingColumns.bid_usd.type, "INTEGER");
  assert.equal(listingColumns.clicks.type, "INTEGER");
  assert.equal(listingColumns.clicks.notnull, 1);
  assert.equal(listingColumns.clicks.dflt_value, "0");
  const checkoutColumns = columnMap(db, "checkouts");
  assert.deepEqual(Object.keys(checkoutColumns), [
    "id",
    "amount_usd",
    "business",
    "category",
    "city",
    "site_url",
    "license_id",
    "week_id",
    "status",
    "listing_id",
    "created_at",
    "intent",
    "target_bid_usd",
    "provider_checkout_id",
    "provider_product_id",
    "currency",
  ]);
  assert.equal(checkoutColumns.id.pk, 1);
  assert.match(tableSql(db, "checkouts"), /status IN \('open', 'paid', 'cancelled'\)/);
  assert.match(
    tableSql(db, "listings"),
    /UNIQUE \(site_url, category, city, week_id\)/,
  );
  assert.match(tableSql(db, "listings"), /FOREIGN KEY \(city\) REFERENCES cities/);
  assert.doesNotMatch(tableSql(db, "listings"), /star|rating|review/i);

  const london = db
    .prepare<[], { slug: string; display: string; public: number }>(
      "SELECT slug, display, public FROM cities WHERE slug = 'london'",
    )
    .get();
  assert.deepEqual(london, { slug: "london", display: "London", public: 1 });

  db.prepare(
    "INSERT INTO weeks (id, timezone, opens_at, closes_at) VALUES (?, ?, ?, ?)",
  ).run(
    "2026-08-17",
    "Europe/London",
    "2026-08-16T23:00:00.000Z",
    "2026-08-23T23:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO listings (
       id, business, category, city, site_url, license_id, bid_usd, week_id,
       created_at, raised_at, clicks, hidden, hidden_reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "lst_1",
    "North London Movers",
    "movers",
    "london",
    "https://example.com",
    null,
    20,
    "2026-08-17",
    "2026-08-17T00:00:00.000Z",
    null,
    0,
    0,
    null,
  );

  assert.throws(() => {
    db.prepare(
      `INSERT INTO listings (
         id, business, category, city, site_url, license_id, bid_usd, week_id,
         created_at, raised_at, clicks, hidden, hidden_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "lst_2",
      "Other Name",
      "movers",
      "london",
      "https://example.com",
      null,
      25,
      "2026-08-17",
      "2026-08-17T01:00:00.000Z",
      null,
      0,
      0,
      null,
    );
  });

  assert.throws(() => {
    db.prepare(
      `INSERT INTO listings (
         id, business, category, city, site_url, license_id, bid_usd, week_id,
         created_at, raised_at, clicks, hidden, hidden_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "lst_unknown_city",
      "Future City Movers",
      "movers",
      "manchester",
      "https://example.com/mcr",
      null,
      20,
      "2026-08-17",
      "2026-08-17T00:00:00.000Z",
      null,
      0,
      0,
      null,
    );
  });
});

type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

function columnMap(
  db: import("better-sqlite3").Database,
  table: string,
): Record<string, ColumnInfo> {
  const rows = db.prepare<[], ColumnInfo>(`PRAGMA table_info(${table})`).all();
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

function tableSql(db: import("better-sqlite3").Database, table: string): string {
  const row = db
    .prepare<[string], { sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table);
  assert.ok(row?.sql, `missing CREATE TABLE for ${table}`);
  return row.sql;
}
