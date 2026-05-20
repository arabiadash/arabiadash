-- Phase 4.8 M3 revert — drop workspaces.template (May 20, 2026)
--
-- Strategic decision: ArabiaDash is ecommerce-exclusive platform.
-- The template field (ecommerce | reports) added by 2026-05-20-workspace-template.sql
-- is no longer needed. All workspaces operate as ecommerce by design now.
--
-- Note: Already applied manually via Supabase Studio on production.
-- This file documents the change for future environments and migration replay.

BEGIN;

DROP INDEX IF EXISTS idx_workspaces_template;

ALTER TABLE workspaces DROP COLUMN IF EXISTS template;

COMMIT;
