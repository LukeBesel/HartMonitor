-- Add Stripe/trial columns to plan table if not present.
-- Columns already in db.js (stripe_customer_id, stripe_subscription_id,
-- subscription_status) will produce "duplicate column name" errors which
-- the migration runner safely ignores per-statement.
ALTER TABLE plan ADD COLUMN trial_ends_at TEXT;
ALTER TABLE plan ADD COLUMN grace_period_ends_at TEXT;
ALTER TABLE plan ADD COLUMN stripe_price_id TEXT;
ALTER TABLE plan ADD COLUMN cancelled_at TEXT;
ALTER TABLE plan ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE plan ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE plan ADD COLUMN notes TEXT;
