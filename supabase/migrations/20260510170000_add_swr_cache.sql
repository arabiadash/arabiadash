-- =================================================================
-- Migration: Stale-While-Revalidate cache infrastructure
-- Date: 2026-05-10
--
-- Why: Meta's Marketing API rate-limits us during heavy use. SWR lets us
-- serve stale data instantly while refreshing in the background, and falls
-- back gracefully when Meta returns 80004 (rate limit).
--
-- Two-pronged change:
--   1. Extend insights_cache with fresh_until + stale_until (generated from
--      fetched_at, so existing setCachedData calls keep working).
--   2. New creatives_cache table — per-user-per-account-per-range storage
--      for /api/ads/creatives output (heavy endpoint, biggest rate-limit pain).
-- =================================================================

-- 1. Extend insights_cache. Postgres rejects GENERATED ALWAYS AS expressions
-- containing INTERVAL (not immutable), so we use plain columns and rely on
-- setCachedData to write them. Existing rows are backfilled below.
ALTER TABLE insights_cache
  ADD COLUMN IF NOT EXISTS fresh_until timestamptz,
  ADD COLUMN IF NOT EXISTS stale_until timestamptz;

-- Backfill existing rows so they have valid fresh_until / stale_until.
UPDATE insights_cache
SET
  fresh_until = COALESCE(fresh_until, fetched_at + INTERVAL '15 minutes'),
  stale_until = COALESCE(stale_until, fetched_at + INTERVAL '24 hours')
WHERE fresh_until IS NULL OR stale_until IS NULL;

-- Now safe to enforce NOT NULL.
ALTER TABLE insights_cache
  ALTER COLUMN fresh_until SET NOT NULL,
  ALTER COLUMN stale_until SET NOT NULL;

CREATE INDEX IF NOT EXISTS insights_cache_swr_idx
  ON insights_cache (connection_id, provider, cache_key, stale_until);

-- 2. New table: creatives_cache (separate from insights_cache because the
-- key shape differs: user_id+account_id+date_range vs connection_id+cache_key)
CREATE TABLE IF NOT EXISTS creatives_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL,
  account_id text NOT NULL,
  date_range text NOT NULL,
  data jsonb NOT NULL,
  fetched_at timestamptz DEFAULT now() NOT NULL,
  fresh_until timestamptz NOT NULL,
  stale_until timestamptz NOT NULL,
  UNIQUE(user_id, provider, account_id, date_range)
);

CREATE INDEX IF NOT EXISTS idx_creatives_cache_lookup
  ON creatives_cache (user_id, provider, account_id, date_range);

ALTER TABLE creatives_cache ENABLE ROW LEVEL SECURITY;

-- User-scoped policies (matches insights_cache pattern — writes from user
-- session, not service role)
DROP POLICY IF EXISTS "Users can view own creatives cache" ON creatives_cache;
CREATE POLICY "Users can view own creatives cache" ON creatives_cache
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own creatives cache" ON creatives_cache;
CREATE POLICY "Users can insert own creatives cache" ON creatives_cache
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own creatives cache" ON creatives_cache;
CREATE POLICY "Users can update own creatives cache" ON creatives_cache
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own creatives cache" ON creatives_cache;
CREATE POLICY "Users can delete own creatives cache" ON creatives_cache
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON creatives_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creatives_cache TO anon;

COMMENT ON TABLE creatives_cache IS 'SWR cache for /api/ads/creatives output. Keyed per-user-per-account-per-range.';
COMMENT ON COLUMN creatives_cache.fresh_until IS 'Until this time, cache is treated as fresh (return immediately).';
COMMENT ON COLUMN creatives_cache.stale_until IS 'Until this time, cache is usable as stale (return + background refresh). Past this, ignore.';
