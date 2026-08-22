import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CITIES, PUBLIC_CITY_SLUGS, getCity } from "../src/cities";
import { openDatabase } from "../src/db";

process.env.DATABASE_PATH = ":memory:";

test("GET /healthz returns 200 { ok: true }", async () => {
  const { GET } = await import("../app/healthz/route");
  const response = GET();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
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
