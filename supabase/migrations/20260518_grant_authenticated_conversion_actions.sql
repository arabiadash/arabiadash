-- Hotfix migration: grant SELECT to authenticated for google_conversion_actions
--
-- The original migration (20260518_create_google_conversion_actions.sql) added
-- an RLS policy "users_read_own_conversion_actions" for the authenticated role,
-- but did not GRANT SELECT on the table itself to authenticated. Postgres
-- evaluates table-level GRANTs before RLS policies — so the policy was
-- unreachable for user-scoped clients, and every call to getPurchaseActionIds()
-- from the API factory (which uses a user-scoped client) threw
-- "permission denied for table google_conversion_actions".
--
-- Discovered on the phase-4.8-m2-expanded-metrics preview when Reports
-- showed 500 errors on every Google insights fetch.
--
-- SQL applied to production Supabase directly via Studio at deploy time;
-- this migration file ensures future env clones get the grant automatically.

GRANT SELECT ON google_conversion_actions TO authenticated;

-- Note on writes: authenticated users do NOT get INSERT/UPDATE/DELETE.
-- All writes go through service_role (via sync-accounts-logic.ts).
-- This is intentional — the table is read-only from the user's perspective.
