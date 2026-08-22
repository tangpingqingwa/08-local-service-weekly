CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  business TEXT NOT NULL CHECK (length(trim(business)) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK (
    category IN ('movers', 'dentists', 'immigration_lawyers', 'tutors')
  ),
  city TEXT NOT NULL,
  site_url TEXT NOT NULL,
  license_id TEXT,
  bid_usd INTEGER NOT NULL CHECK (bid_usd >= 5 AND bid_usd <= 999999),
  week_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  raised_at TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  hidden_reason TEXT CHECK (
    hidden_reason IS NULL
    OR hidden_reason IN (
      'unlicensed',
      'impersonation',
      'complaint',
      'nsfw',
      'chat_link',
      'other'
    )
  ),
  UNIQUE (site_url, category, city, week_id),
  FOREIGN KEY (city) REFERENCES cities (slug),
  FOREIGN KEY (week_id) REFERENCES weeks (id)
);
