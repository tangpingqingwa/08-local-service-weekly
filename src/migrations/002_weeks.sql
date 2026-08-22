CREATE TABLE weeks (
  id TEXT PRIMARY KEY NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL
);
