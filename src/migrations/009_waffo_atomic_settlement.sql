-- Waffo Pancake payment intent and settlement ledger. Provider facts are
-- immutable; only lifecycle state, provider attachment, and outcome columns
-- may advance. All settlement writes are performed in one SQLite transaction.
CREATE TABLE waffo_intents (
  intent_id TEXT PRIMARY KEY,
  intent_kind TEXT NOT NULL CHECK (intent_kind IN ('place', 'raise')),
  intent_fingerprint TEXT NOT NULL,
  business TEXT NOT NULL,
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  site_url TEXT NOT NULL,
  license_id TEXT,
  week_id TEXT NOT NULL,
  target_bid_cents INTEGER NOT NULL CHECK (target_bid_cents >= 500),
  quote_base_bid_cents INTEGER NOT NULL CHECK (quote_base_bid_cents >= 0),
  charge_cents INTEGER NOT NULL CHECK (charge_cents >= 100),
  provider_mode TEXT NOT NULL CHECK (provider_mode IN ('waffo-test', 'waffo-prod')),
  provider_store_id TEXT NOT NULL,
  provider_product_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  tax_category TEXT NOT NULL CHECK (tax_category = 'digital_goods'),
  state TEXT NOT NULL CHECK (
    state IN ('creating', 'open', 'unknown', 'paid', 'rejected', 'needs_reconciliation')
  ),
  provider_session_id TEXT,
  checkout_url TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES checkouts (id) ON DELETE CASCADE
);

CREATE INDEX waffo_intents_fingerprint_idx ON waffo_intents(intent_fingerprint);
CREATE INDEX waffo_intents_external_lookup_idx ON waffo_intents(intent_id, provider_mode, provider_store_id);

CREATE TABLE waffo_checkout_events (
  intent_id TEXT PRIMARY KEY,
  provider_session_id TEXT,
  state TEXT NOT NULL CHECK (
    state IN ('creating', 'open', 'unknown', 'paid', 'rejected', 'needs_reconciliation', 'cancelled')
  ),
  response_fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES waffo_intents (intent_id) ON DELETE CASCADE
);

CREATE TABLE waffo_webhook_events (
  delivery_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  business_event_key TEXT NOT NULL UNIQUE,
  payment_id TEXT,
  order_id TEXT,
  intent_id TEXT,
  payload_fingerprint TEXT NOT NULL,
  facts_fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('processing', 'processed', 'ignored', 'rejected', 'needs_reconciliation')
  ),
  reason TEXT,
  provider_mode TEXT,
  provider_store_id TEXT,
  provider_product_id TEXT,
  currency TEXT,
  provider_event_at TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (intent_id) REFERENCES waffo_intents (intent_id)
);

CREATE UNIQUE INDEX waffo_webhook_payment_unique
  ON waffo_webhook_events(payment_id)
  WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX waffo_webhook_order_unique
  ON waffo_webhook_events(order_id)
  WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX waffo_webhook_intent_unique
  ON waffo_webhook_events(intent_id)
  WHERE intent_id IS NOT NULL;

CREATE TABLE waffo_webhook_rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT,
  payment_id TEXT,
  order_id TEXT,
  intent_id TEXT,
  payload_fingerprint TEXT NOT NULL,
  facts_fingerprint TEXT NOT NULL,
  reason TEXT NOT NULL,
  received_at TEXT NOT NULL
);
