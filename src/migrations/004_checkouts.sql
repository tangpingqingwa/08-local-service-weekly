CREATE TABLE checkouts (
  id TEXT PRIMARY KEY,
  amount_usd INTEGER NOT NULL CHECK (amount_usd >= 5 AND amount_usd <= 999999),
  business TEXT NOT NULL,
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  site_url TEXT NOT NULL,
  license_id TEXT,
  week_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'cancelled')),
  listing_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (week_id) REFERENCES weeks (id),
  FOREIGN KEY (listing_id) REFERENCES listings (id)
);
