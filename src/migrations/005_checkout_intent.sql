CREATE TABLE checkouts_raise (
  id TEXT PRIMARY KEY,
  amount_usd INTEGER NOT NULL CHECK (amount_usd >= 1 AND amount_usd <= 999999),
  business TEXT NOT NULL,
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  site_url TEXT NOT NULL,
  license_id TEXT,
  week_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'cancelled')),
  listing_id TEXT,
  created_at TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'place' CHECK (intent IN ('place', 'raise')),
  target_bid_usd INTEGER,
  FOREIGN KEY (week_id) REFERENCES weeks (id),
  FOREIGN KEY (listing_id) REFERENCES listings (id)
);

INSERT INTO checkouts_raise (
  id, amount_usd, business, category, city, site_url, license_id,
  week_id, status, listing_id, created_at, intent, target_bid_usd
)
SELECT
  id, amount_usd, business, category, city, site_url, license_id,
  week_id, status, listing_id, created_at, 'place', amount_usd
FROM checkouts;

DROP TABLE checkouts;
ALTER TABLE checkouts_raise RENAME TO checkouts;
