CREATE TABLE takedowns (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (
    reason IN (
      'unlicensed',
      'impersonation',
      'complaint',
      'nsfw',
      'chat_link',
      'other'
    )
  ),
  complaint TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES listings (id)
);
