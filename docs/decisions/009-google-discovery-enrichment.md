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

## Related fixes shipped with this ADR

- `feat(google-ads): add customer_client query for enriched discovery` (commit 966cb95)
- `refactor(google-ads): use customer_client enrichment in OAuth callback` (commit 11144c5)
- `feat(types): expose google_account_status in connection metadata` (commit 3b54ecc)
- `feat(connections): show status badges and disable activation for canceled Google accounts` (commit a668f99)
