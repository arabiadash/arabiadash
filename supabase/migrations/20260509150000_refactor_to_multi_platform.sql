-- =================================================================
-- Migration: Refactor to multi-platform support
-- Date: 2026-05-09
--
-- Purpose:
-- - Rename meta_insights_cache to insights_cache (generic)
-- - Add provider column to support multiple ad platforms
-- - Keep backward compatibility with existing data
-- =================================================================

-- 1. Create new generic insights_cache table
CREATE TABLE IF NOT EXISTS insights_cache (
  id bigserial PRIMARY KEY,
  connection_id bigint NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'meta', -- 'meta', 'google', 'tiktok', etc.
  cache_key text NOT NULL,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(connection_id, provider, cache_key)
);

-- 2. Migrate existing data from meta_insights_cache (if exists)
INSERT INTO insights_cache (connection_id, provider, cache_key, data, fetched_at, expires_at, created_at)
SELECT
  connection_id,
  'meta' as provider,
  cache_key,
  data,
  fetched_at,
  expires_at,
  created_at
FROM meta_insights_cache
ON CONFLICT (connection_id, provider, cache_key) DO NOTHING;

-- 3. Index for fast lookups
CREATE INDEX IF NOT EXISTS insights_cache_lookup_idx
  ON insights_cache (connection_id, provider, cache_key, expires_at);

-- 4. RLS
ALTER TABLE insights_cache ENABLE ROW LEVEL SECURITY;

-- Drop old policies if exist (idempotent)
DROP POLICY IF EXISTS "Users can view their own cached insights" ON insights_cache;
DROP POLICY IF EXISTS "Users can insert their own cached insights" ON insights_cache;
DROP POLICY IF EXISTS "Users can update their own cached insights" ON insights_cache;
DROP POLICY IF EXISTS "Users can delete their own cached insights" ON insights_cache;

CREATE POLICY "Users can view their own cached insights"
  ON insights_cache FOR SELECT
  USING (connection_id IN (SELECT id FROM connections WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert their own cached insights"
  ON insights_cache FOR INSERT
  WITH CHECK (connection_id IN (SELECT id FROM connections WHERE user_id = auth.uid()));

CREATE POLICY "Users can update their own cached insights"
  ON insights_cache FOR UPDATE
  USING (connection_id IN (SELECT id FROM connections WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete their own cached insights"
  ON insights_cache FOR DELETE
  USING (connection_id IN (SELECT id FROM connections WHERE user_id = auth.uid()));

-- 5. Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON insights_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON insights_cache TO anon;

-- 6. Drop old table (after data migrated)
-- ⚠️ لا نحذفها الآن - نخليها للسلامة. نحذفها بعد ما نتأكد إن الكود الجديد شغّال.
-- DROP TABLE IF EXISTS meta_insights_cache;

-- 7. Comments
COMMENT ON TABLE insights_cache IS 'Generic cache for ad platform API responses (Meta, Google, TikTok, etc.)';
COMMENT ON COLUMN insights_cache.provider IS 'Ad platform name: meta, google, tiktok, snapchat, etc.';
COMMENT ON COLUMN insights_cache.cache_key IS 'Cache key format: campaigns, insights:{level}:{range}:t{increment}';
