-- Phase 4.8 M3 Commit 1 — Workspace Template Field
-- Adds a template column to workspaces table to support distinct UX for
-- e-commerce vs reports-only users.
--
-- E-commerce template: shows revenue, ROAS, purchases as Primary KPIs.
-- Reports template: shows impressions, clicks, CTR as Primary KPIs
--                   (hides revenue/ROAS/purchases — irrelevant for these users).
--
-- Default 'ecommerce' preserves existing behavior for all current workspaces.
-- Check constraint enforces valid values at the database level.
-- See ADR-012 for the full design rationale.

ALTER TABLE workspaces
  ADD COLUMN template TEXT NOT NULL DEFAULT 'ecommerce'
  CHECK (template IN ('ecommerce', 'reports'));

-- Helpful for analytics queries grouping by template type
CREATE INDEX IF NOT EXISTS idx_workspaces_template ON workspaces(template);

COMMENT ON COLUMN workspaces.template IS 'UI mode: ecommerce (revenue/ROAS focus) or reports (impressions/CTR focus). See ADR-012.';
