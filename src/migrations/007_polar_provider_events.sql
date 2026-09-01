-- Legacy migration id retained so existing databases do not replay it.
-- New databases receive only the provider-neutral Waffo checkout identity
-- columns below; no historical Polar tables are created or queried.
ALTER TABLE checkouts ADD COLUMN provider_checkout_id TEXT;
ALTER TABLE checkouts ADD COLUMN provider_product_id TEXT;
ALTER TABLE checkouts ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';

CREATE UNIQUE INDEX checkouts_provider_checkout_id_unique
  ON checkouts(provider_checkout_id)
  WHERE provider_checkout_id IS NOT NULL;
