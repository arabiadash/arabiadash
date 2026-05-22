# ADR-009: Google Discovery Enrichment via customer_client

**Status**: Accepted
**Date**: 2026-05-17
**Related**: ADR-005 (Google integration), ADR-008 (data hygiene)

## Context

The OAuth callback used `listAccessibleCustomers` to discover Google Ads accounts the user can access. This returned bare 10-digit IDs only — no names, no status, no currency. The sync-accounts route then enriched each account via `customer.descriptive_name` GAQL query.

Problem: `customer.descriptive_name` query fails for accounts in CANCELED or CLOSED status. The Google Ads API refuses queries on these accounts even when the user has access (read-only history view). The result was:

- Active accounts: name + currency populated ✓
- Canceled accounts: stuck with `account_name = null`, `currency = null`
- The May 17 user could see "Meraki" in the Google Ads UI but ArabiaDash showed "حساب 6706374790"

## Decision

Replace single-source discovery with a **Hybrid Discovery** pattern:

1. **`listAccessibleCustomers`** (existing) — baseline list of all accessible account IDs, including standalone accounts not linked to our MCC.
2. **`getEnrichedCustomerClients`** (new) — `customer_client` GAQL query from our MCC context. Returns names + status + currency for MCC-linked accounts in ANY status (ENABLED, SUSPENDED, CANCELED, CLOSED).

The callback merges by ID. Each upsert row gets enrichment data if available, falls back to null otherwise. The sync-accounts auto-trigger (PR #18) still runs after upsert to cover standalone accounts that customer_client doesn't return.

## Status display consolidation

Google returns 4 statuses. We collapse them to 3 in the UI:

| Google Status | UI Label | UI Color | Activation Allowed |
|---------------|----------|----------|---------------------|
| ENABLED | نشط | green | ✓ |
| SUSPENDED | متوقف | yellow | ✓ (allows pre-activation before verification clears) |
| CANCELED | ملغي | red | ✗ |
| CLOSED | ملغي | red | ✗ |
| (missing) | غير معروف | gray | ✓ (pre-enrichment connections) |

Rationale: users don't need to distinguish CANCELED (admin-reversible) from CLOSED (permanent). Both mean "this account can't serve ads", which is the only thing that matters for activation decisions.

## Consequences

### Positive

- Cancelled accounts now show real names in the UI
- Users see status clearly via color-coded badges
- Activation button is disabled for accounts that can't run ads (saves user from confusion)
- No new failure modes — Hybrid approach means each path falls back gracefully

### Negative

- Two API calls in the OAuth callback (parallel via Promise.all, so wall-time impact is minimal — slowest of the two)
- Standalone accounts (not in MCC) still rely on sync-accounts for name/currency (no behavior change for them)
- Existing connections in DB don't have google_account_status — they show "غير معروف" until the user re-OAuths or runs manual sync

## Future considerations

- If Google ever adds a "REACTIVATE" feature for CANCELED accounts via the API, we could surface a "request reactivation" button distinguished from CLOSED. Until then, the collapsed "ملغي" label is the right UX.
- The is_test_account field is captured but not currently displayed. Useful for future filtering (e.g., hide test accounts in production billing logic).
- TikTok/Snapchat integrations (Phase 7, 8) should follow this same Hybrid Discovery pattern from day one if their APIs support equivalent enrichment.

## Extension: Sync-accounts Enrichment (C6)

The customer_client query that powers fresh OAuth discovery (C1-C2) is also now used by the sync-accounts route. Previously the route used per-account `customer.descriptive_name` queries exclusively, which fail for CANCELED/CLOSED accounts. After this extension:

- The "تحديث" button refreshes name + status + currency for all MCC-linked accounts in one MCC-context query, then runs the per-account fallback only for standalone accounts that didn't appear in the enrichment map.
- Existing connections in the DB (created before C1-C5 shipped) can get enriched via this button — no re-OAuth required.
- Standalone accounts still fall through to fetchCustomerDetails (no behavior change for them).

This closes the gap where existing connections were stuck on "غير معروف" status badges with no clear path to refresh.

## Extension: Workspace Context Required (C7)

`/api/google-ads/auth` previously accepted direct URL access and silently skipped the workspace cookie when `?workspace=` was missing or malformed; the callback then fell back to the user's default workspace via `getDefaultWorkspaceId`. This caused accounts to land in the wrong workspace (e.g., Brand B instead of the user's currently-viewed workspace) when OAuth was triggered from anything other than the in-UI button.

After this extension:

- `?workspace=<digits>` is required. Missing or malformed → redirect to `/dashboard/connections?google_ads=error&reason=workspace_required`.
- Workspace ownership + not-archived is validated inline (RLS catches it on the callback too, but failing here saves the user an OAuth roundtrip). Invalid workspace → `reason=invalid_workspace`.
- The `ConnectionsClient` gained a `GOOGLE_ADS_ERROR_MESSAGES` map + parsing for `?google_ads=success` and `?google_ads=error&reason=<code>` query params, so the new errors (and the pre-existing `expired_session`, `csrf_mismatch`, `no_accounts`, `internal_error` from the callback) finally surface as Arabic toasts instead of silent URL bar noise.

Decision: workspace context is URL-param-only (matching ADR-002's URL-as-source-of-truth pattern). No `active_workspace` cookie was introduced — the in-UI button already appends `?workspace=${activeWorkspaceId}` to the auth URL, and the OAuth roundtrip is bridged by the existing short-lived `google_ads_oauth_workspace` cookie that `/auth` sets and the callback consumes.

Aligns with ADR-008 (no silent defaults).

## Extension: Reconnect UX (C8)

Standard pattern adopted from industry leaders (Stripe Connect, Plaid Link): when stale/incomplete data exists, surface the refresh action explicitly with explanatory text instead of letting users get stuck on grey badges.

Two actions are exposed in an orange banner above the accounts list:

1. **تحديث الحالات** (Sync) — POSTs to `/api/google-ads/sync-accounts` which now uses the customer_client enrichment (C6). Cheap, fast, no re-auth.
2. **إعادة ربط Google** (Reconnect) — reuses the existing `handleConnectNew` flow (which already passes `?workspace=${activeWorkspaceId}` to `/auth`, preserving workspace integrity per C7). Used when tokens expire or when the user wants to grant access to newly-discovered accounts on the provider side.

The banner only appears when at least one connection has missing `google_account_status`, preventing visual noise for fully-enriched workspaces.

## Related fixes shipped with this ADR

- `feat(google-ads): add customer_client query for enriched discovery` (commit 966cb95)
- `refactor(google-ads): use customer_client enrichment in OAuth callback` (commit 11144c5)
- `feat(types): expose google_account_status in connection metadata` (commit 3b54ecc)
- `feat(connections): show status badges and disable activation for canceled Google accounts` (commit a668f99)
- `feat(sync-accounts): use customer_client enrichment for status + name refresh` (commit 46f5f12)
- `fix(google-ads/auth): require workspace context to prevent silent default` (commit ecb5caf)
- `feat(connections): add Google reconnect banner with refresh actions` (commit 0b7915a)
