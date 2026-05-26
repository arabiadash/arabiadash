-- ADR-017 — Google credentials consolidation
--
-- Collapse Google refresh-token storage to the canonical single source
-- of truth: platform_credentials.refresh_token. The connections.access_token
-- column is preserved (Meta still uses it) but Google rows are NULL-ed
-- to eliminate the ADR-010 stale-token drift.
--
-- DOWN (manual rollback reference — not run automatically):
--   ALTER TABLE public.connections ALTER COLUMN access_token SET NOT NULL;
--   UPDATE public.connections c
--     SET access_token = pc.refresh_token
--     FROM public.platform_credentials pc
--     WHERE c.user_id = pc.user_id
--       AND c.platform = 'google'
--       AND pc.platform = 'google';
--   COMMENT ON COLUMN public.connections.access_token IS NULL;

-- Drop NOT NULL so Google rows can hold NULL (Meta rows remain populated).
ALTER TABLE public.connections ALTER COLUMN access_token DROP NOT NULL;

COMMENT ON COLUMN public.connections.access_token IS
  'Meta access_token (long-lived). Google has migrated to platform_credentials.refresh_token (ADR-017). NULL expected on Google rows.';

UPDATE public.connections
  SET access_token = NULL
  WHERE platform = 'google'
    AND access_token IS NOT NULL;
