-- Migration: 20260518_create_google_conversion_actions.sql
-- Phase 4.8 M2 — Tech debt #15 fix
-- See ADR-011 (pending) for rationale.

CREATE TABLE google_conversion_actions (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id           TEXT NOT NULL,
  conversion_action_id  TEXT NOT NULL,
  resource_name         TEXT NOT NULL,
  name                  TEXT NOT NULL,
  category              SMALLINT NOT NULL,
  category_name         TEXT NOT NULL,
  status                SMALLINT NOT NULL,
  primary_for_goal      BOOLEAN NOT NULL DEFAULT FALSE,
  counts_as_purchase    BOOLEAN NOT NULL,
  user_override         BOOLEAN DEFAULT NULL,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_gca_user_customer_action
    UNIQUE (user_id, customer_id, conversion_action_id)
);

COMMENT ON TABLE google_conversion_actions IS
  'Cached Google Ads conversion_action metadata, refreshed during sync-accounts. Used by the Google adapter to filter metrics.conversions down to real purchases. See ADR-011.';

COMMENT ON COLUMN google_conversion_actions.customer_id IS
  '10-digit Google customer ID (no dashes). Maps to connections.account_id for Google rows.';

COMMENT ON COLUMN google_conversion_actions.resource_name IS
  'Full GAQL resource path: customers/{cid}/conversionActions/{caid}. Used for re-fetch.';

COMMENT ON COLUMN google_conversion_actions.category IS
  'Raw enum integer from Google Ads SDK (ConversionActionCategoryEnum). 7=PURCHASE, 21=STORE_SALE are the two we treat as purchases. See google-ads-api SDK enums for the full list.';

COMMENT ON COLUMN google_conversion_actions.category_name IS
  'String form of category (PURCHASE, SUBMIT_LEAD_FORM, etc.). Denormalized for readability when querying directly in Supabase Studio.';

COMMENT ON COLUMN google_conversion_actions.status IS
  '2=ENABLED, 3=REMOVED. Only status=2 actions are considered in adapter queries.';

COMMENT ON COLUMN google_conversion_actions.counts_as_purchase IS
  'Auto-derived: true iff category_name IN (PURCHASE, STORE_SALE). Conservative — false negatives preferred over false positives. Operator override available via user_override column.';

COMMENT ON COLUMN google_conversion_actions.user_override IS
  'NULL = use counts_as_purchase as-is. TRUE/FALSE = explicit operator override. Adapter effective value: COALESCE(user_override, counts_as_purchase). Reserved for future settings UI.';

CREATE INDEX idx_gca_user_customer_enabled
  ON google_conversion_actions(user_id, customer_id)
  WHERE status = 2;

CREATE INDEX idx_gca_purchases
  ON google_conversion_actions(user_id, customer_id)
  WHERE status = 2 AND counts_as_purchase = TRUE;

CREATE OR REPLACE FUNCTION update_gca_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gca_updated_at
  BEFORE UPDATE ON google_conversion_actions
  FOR EACH ROW EXECUTE FUNCTION update_gca_updated_at();

ALTER TABLE google_conversion_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_conversion_actions"
  ON google_conversion_actions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

GRANT ALL ON google_conversion_actions TO service_role;
GRANT USAGE ON SEQUENCE google_conversion_actions_id_seq TO service_role;
