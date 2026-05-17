-- Migration: platform_credentials table
-- Date: 2026-05-18
-- Purpose:
--   Separates OAuth refresh tokens from ad-account rows. Previously the
--   `connections` table mixed two distinct concerns:
--     1. A row PER ad account the user wanted to import
--     2. The refresh_token shared across all those rows
--
--   This conflation forced sentinel patterns (e.g. "_token_placeholder")
--   to store the token before any accounts were chosen, and risked
--   leaking placeholder rows into every WHERE-by-platform query.
--
--   The new `platform_credentials` table holds exactly one row per
--   (user_id, platform) — the canonical place to look up a refresh
--   token for a given platform. The `connections` table becomes purely
--   "ad accounts the user has chosen to import."
--
-- Future: TikTok, Snapchat, Salla, Zid will write to platform_credentials
-- under their own platform values when their OAuth flows ship.

CREATE TABLE IF NOT EXISTS platform_credentials (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  scopes TEXT[],
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, platform)
);

-- Index for the dominant access pattern: "what's user X's credential
-- for platform Y?" (called by discover/select endpoints + OAuth callbacks)
CREATE INDEX IF NOT EXISTS platform_credentials_user_platform_idx
  ON platform_credentials (user_id, platform);

-- updated_at autoupdate via trigger
CREATE OR REPLACE FUNCTION update_platform_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_credentials_updated_at ON platform_credentials;
CREATE TRIGGER platform_credentials_updated_at
  BEFORE UPDATE ON platform_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_platform_credentials_updated_at();

-- RLS — users can read their own credentials only.
-- Service-role bypasses RLS automatically (used by callbacks + discover/select
-- routes that need to read the refresh token without exposing it to the user
-- session).
ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own credentials"
  ON platform_credentials;
CREATE POLICY "Users can read own credentials"
  ON platform_credentials FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy for user sessions — only the service-role
-- (used by the OAuth callbacks and select endpoints) can write tokens.
-- This is intentional: the user session must never be able to set a token
-- directly, since that would bypass the OAuth handshake.
