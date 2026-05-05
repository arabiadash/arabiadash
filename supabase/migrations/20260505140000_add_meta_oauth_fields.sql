-- Migration: Add Meta OAuth fields to connections table
-- Description: Extends the connections table to support OAuth flow for Meta Marketing API
-- Date: 2026-05-05

-- 1. Add new columns (IF NOT EXISTS for idempotency)
ALTER TABLE connections ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS account_name text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS access_token text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS scopes text[];
ALTER TABLE connections ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2. Drop existing status check constraint if exists, then add new one
ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_status_check;
ALTER TABLE connections ADD CONSTRAINT connections_status_check
  CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'error'));

-- 3. Set default status if not already set
ALTER TABLE connections ALTER COLUMN status SET DEFAULT 'pending';

-- 4. UNIQUE constraint: a user can connect each (platform, account_id) combination only once
-- Drop if exists to avoid conflicts on re-run
ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_user_platform_account_unique;
ALTER TABLE connections ADD CONSTRAINT connections_user_platform_account_unique
  UNIQUE (user_id, platform, account_id);

-- 5. Index for faster queries by user + platform
CREATE INDEX IF NOT EXISTS connections_user_platform_idx
  ON connections (user_id, platform);

-- 6. Trigger to auto-update updated_at on row updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_connections_updated_at ON connections;
CREATE TRIGGER update_connections_updated_at
  BEFORE UPDATE ON connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 7. RLS Policies (drop if exist, then create)
-- Note: Assuming RLS is already enabled on connections table

DROP POLICY IF EXISTS "Users can view their own connections" ON connections;
CREATE POLICY "Users can view their own connections"
  ON connections FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own connections" ON connections;
CREATE POLICY "Users can insert their own connections"
  ON connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own connections" ON connections;
CREATE POLICY "Users can update their own connections"
  ON connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own connections" ON connections;
CREATE POLICY "Users can delete their own connections"
  ON connections FOR DELETE
  USING (auth.uid() = user_id);

-- Confirmation
COMMENT ON COLUMN connections.access_token IS 'OAuth access token from provider. Should be encrypted at rest.';
COMMENT ON COLUMN connections.scopes IS 'Array of OAuth scopes granted by user';
COMMENT ON COLUMN connections.metadata IS 'Provider-specific metadata (e.g., user_id from Meta, business info)';
