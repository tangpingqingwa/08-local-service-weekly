-- Legacy migration id retained for upgrade ordering. The old provider-event
-- tables were never authoritative and are intentionally not created here.
-- Ambiguous Waffo sessions remain recoverable through the 009 Waffo intent
-- and checkout-event tables.
CREATE TABLE checkout_provider_sessions (
  local_checkout_id TEXT PRIMARY KEY,
  provider_state TEXT NOT NULL CHECK (
    provider_state IN ('pending', 'attached', 'unknown', 'failed')
  ),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (local_checkout_id) REFERENCES checkouts (id) ON DELETE CASCADE
);
