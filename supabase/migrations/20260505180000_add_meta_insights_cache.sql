-- Cache table for Meta API responses (15 min TTL)
CREATE TABLE IF NOT EXISTS meta_insights_cache (
  id bigserial PRIMARY KEY,
  connection_id bigint NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  cache_key text NOT NULL, -- e.g., "campaigns" or "insights:30d"
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(connection_id, cache_key)
);

CREATE INDEX IF NOT EXISTS meta_insights_cache_lookup_idx
  ON meta_insights_cache (connection_id, cache_key, expires_at);

ALTER TABLE meta_insights_cache ENABLE ROW LEVEL SECURITY;

-- Users can only access cache for their own connections
CREATE POLICY "Users can view their own cached insights"
  ON meta_insights_cache FOR SELECT
  USING (
    connection_id IN (
      SELECT id FROM connections WHERE user_id = auth.uid()
    )
  );

-- Service role + user can insert/update via API routes
CREATE POLICY "Users can insert their own cached insights"
  ON meta_insights_cache FOR INSERT
  WITH CHECK (
    connection_id IN (
      SELECT id FROM connections WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own cached insights"
  ON meta_insights_cache FOR UPDATE
  USING (
    connection_id IN (
      SELECT id FROM connections WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own cached insights"
  ON meta_insights_cache FOR DELETE
  USING (
    connection_id IN (
      SELECT id FROM connections WHERE user_id = auth.uid()
    )
  );
