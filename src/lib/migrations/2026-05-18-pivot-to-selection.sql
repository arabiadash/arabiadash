-- Migration: Pivot to industry-standard account selection
-- Date: 2026-05-18
-- Related: ADR-010
--
-- Three steps, run in order. Each step has a verification query to run
-- AFTER it — copy the verification results before proceeding to the next.
--
-- DO NOT run all three steps in one transaction. Run them one-at-a-time
-- in the Supabase SQL editor, reviewing the verification output between
-- each. If something looks wrong, STOP — the prior steps remain in
-- effect and the destructive step (3) hasn't happened yet.
--
-- Pre-requisite: src/lib/migrations/2026-05-18-platform-credentials-table.sql
-- must have been applied already (which created the platform_credentials
-- table). This migration only moves data; it doesn't create new tables.

-- =====================================================================
-- STEP 1 — BACKUP
--
-- Create a snapshot table holding every Google + Meta pending row
-- before the destructive step deletes them. This is the recovery
-- path if Step 3 was wrong: restore from `connections_pending_backup_2026_05_18`.
--
-- Idempotent: re-running this step is a no-op if the table already
-- exists (we use IF NOT EXISTS + INSERT only when the source still has
-- pending rows).
-- =====================================================================

CREATE TABLE IF NOT EXISTS connections_pending_backup_2026_05_18 AS
SELECT *
FROM connections
WHERE FALSE;  -- creates empty table with same schema; Postgres pattern

-- Add a backup_at timestamp so multiple backup runs (if any) are
-- distinguishable.
ALTER TABLE connections_pending_backup_2026_05_18
  ADD COLUMN IF NOT EXISTS backed_up_at TIMESTAMPTZ DEFAULT NOW();

INSERT INTO connections_pending_backup_2026_05_18
SELECT *, NOW() AS backed_up_at
FROM connections
WHERE platform IN ('google', 'meta')
  AND status = 'pending';

-- VERIFICATION 1:
--   SELECT platform, COUNT(*) FROM connections_pending_backup_2026_05_18 GROUP BY platform;
-- Expected: per-platform counts of currently-pending rows.
-- Production (2026-05-18 snapshot): ~8 google rows, 0 meta rows.

-- =====================================================================
-- STEP 2 — MIGRATE TOKENS
--
-- Move refresh tokens (and Meta's long-lived access tokens) from the
-- legacy connections.access_token field into the platform_credentials
-- table. Source rows: any ACTIVE google/meta connection.
--
-- DISTINCT ON (user_id, platform) — multiple ACTIVE connections for the
-- same (user, platform) share the same token in the old schema. We take
-- the lexicographically-first row's token (deterministic).
--
-- ON CONFLICT DO NOTHING — idempotent. Re-running this step is safe.
-- If a credential already exists for the (user, platform) pair (e.g.
-- the user re-OAuthed under the new flow already), we keep that.
-- =====================================================================

INSERT INTO platform_credentials (user_id, platform, refresh_token, created_at)
SELECT
  user_id,
  platform,
  access_token AS refresh_token,
  MIN(connected_at) AS created_at
FROM connections
WHERE platform IN ('google', 'meta')
  AND status = 'active'
  AND access_token IS NOT NULL
GROUP BY user_id, platform, access_token
ON CONFLICT (user_id, platform) DO NOTHING;

-- VERIFICATION 2A: confirm credential rows now exist for every user
-- with active connections.
--   SELECT
--     c.user_id,
--     c.platform,
--     COUNT(c.id) AS active_connections,
--     CASE WHEN pc.refresh_token IS NULL THEN 'MISSING' ELSE 'OK' END AS credential_status
--   FROM connections c
--   LEFT JOIN platform_credentials pc
--     ON pc.user_id = c.user_id AND pc.platform = c.platform
--   WHERE c.status = 'active' AND c.platform IN ('google', 'meta')
--   GROUP BY c.user_id, c.platform, pc.refresh_token
--   ORDER BY c.user_id, c.platform;
--
-- Expected: every row shows credential_status='OK'. If any row shows
-- 'MISSING', STOP — investigate before proceeding to Step 3.

-- VERIFICATION 2B: confirm the count of platform_credentials matches
-- the count of distinct (user_id, platform) pairs with active rows.
--   SELECT
--     (SELECT COUNT(DISTINCT (user_id, platform))
--      FROM connections
--      WHERE status='active' AND platform IN ('google','meta')
--        AND access_token IS NOT NULL) AS expected,
--     (SELECT COUNT(*) FROM platform_credentials
--      WHERE platform IN ('google','meta')) AS actual;
--
-- Expected: expected = actual. (If actual > expected, that's fine — it
-- means a credential exists from a separate flow we haven't accounted
-- for. If actual < expected, STOP.)

-- =====================================================================
-- STEP 3 — DELETE PENDING (destructive)
--
-- Only run after VERIFICATION 1 + 2A + 2B all pass. After this step,
-- pending Google/Meta rows are GONE from the live connections table.
-- The backup table from Step 1 is the recovery path.
--
-- This is the "fresh start in the new selector flow" step — users with
-- old pending rows will be prompted to pick accounts from the selector
-- next time they visit /dashboard/connections/{platform}.
--
-- Active rows are NOT touched. Token has been migrated to
-- platform_credentials (Step 2), so the active rows continue to work
-- via the adapter (factory.ts reads connections.access_token AND
-- platform_credentials.refresh_token — both still match for active rows).
-- =====================================================================

DELETE FROM connections
WHERE platform IN ('google', 'meta')
  AND status = 'pending';

-- VERIFICATION 3: confirm no pending rows remain.
--   SELECT platform, status, COUNT(*) FROM connections
--   WHERE platform IN ('google','meta')
--   GROUP BY platform, status
--   ORDER BY platform, status;
--
-- Expected: only 'active' rows. If you see 'pending', STEP 3 failed
-- (would be unusual — DELETE doesn't fail silently in Postgres).

-- =====================================================================
-- RECOVERY (if Step 3 was wrong)
--
-- To restore the pending rows from the backup:
--   INSERT INTO connections (
--     user_id, workspace_id, platform, account_id, account_name,
--     access_token, status, metadata, connected_at, created_at,
--     updated_at, token_expires_at, scopes, last_synced_at
--   )
--   SELECT
--     user_id, workspace_id, platform, account_id, account_name,
--     access_token, status, metadata, connected_at, created_at,
--     updated_at, token_expires_at, scopes, last_synced_at
--   FROM connections_pending_backup_2026_05_18;
--
-- (Skip the `id` and `backed_up_at` columns — they're regenerated /
-- not in the live schema.)
-- =====================================================================
