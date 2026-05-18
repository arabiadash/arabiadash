# ADR-010: Industry-Standard Account Selection

**Status**: Accepted
**Date**: 2026-05-18
**Related**: ADR-005 (Google integration), ADR-008 (data hygiene), ADR-009 (deprecated — superseded by this)

## Context

The original architecture for Meta + Google integration discovered ALL accessible accounts during OAuth and saved them all to the DB as "pending", letting the user activate which ones they wanted from the connections page.

This approach surfaced multiple compounding issues during the May 17-18 investigation:

1. Display pollution: Users with 10+ Google accounts saw all of them, including cancelled and standalone accounts they had no intention of using
2. API limitations: Google's `customer.descriptive_name` query fails for CANCELED/CLOSED accounts (e.g., the "Meraki" account showed as "حساب 6706374790" with no way to retrieve its name)
3. Architectural complexity: PR #20 attempted to fix this with customer_client enrichment, status badges, reconnect banners, fallback logic — increasing UI complexity to manage data the user didn't want in the first place
4. Plan-aware limits don't compose well with pre-populated DB rows

Research into industry leaders revealed the universal pattern:
- Triple Whale: "a popup will prompt you to select the Google Ads account/s you'd like to import"
- Northbeam: explicit "Connect Ad Accounts" / "Remove Ad Accounts" actions per account

Every serious analytics platform handles this with **explicit user selection**, not auto-discovery.

## Decision

Pivot to **account selection** for all current and future platforms (Meta, Google, and the upcoming TikTok, Snapchat, Salla, Zid).

### Architecture

1. **Schema separation**: New `platform_credentials` table (user_id, platform, refresh_token, ...) — one row per (user, platform). The `connections` table becomes purely "ad accounts the user has chosen to import" with no token-mixing.

2. **Discovery endpoint** (`/api/{platform}/discover`): Read-only, returns available accounts (active + suspended only, cancelled hidden).

3. **Selection endpoint** (`/api/{platform}/select-accounts`): Validates against cross-platform plan limit (canAddMoreAccounts), persists chosen accounts with full metadata.

4. **Selector UI** (`/dashboard/connections/{platform}/select`): Industry-standard pattern with checkboxes, plan limit progress bar, upgrade prompts.

5. **OAuth callbacks**: Save refresh token to platform_credentials only. No pre-population of connections.

### Plan-aware limits

A unified `PlanLimits` service in `src/lib/plans.ts` defines total-accounts limits across all platforms:

| Tier | Total Accounts | Workspaces | Features |
|------|---------------|------------|----------|
| Trial (default) | 3 | Infinity* | — |
| Starter (299 SAR) | 3 | 1 | — |
| Growth (799 SAR) | 10 | 2 | Smart alerts |
| Agency (2,499 SAR) | Unlimited | Unlimited | All features |

*Trial workspace limit set to Infinity to avoid retroactive breakage for existing users with multiple workspaces. Phase 10 billing will enforce stricter limits.

`getUserTier()` is currently stubbed to return "trial". Phase 10 will swap in a real Stripe subscription lookup. No structural changes needed — the selector and limit-check logic already respect tier values.

### Cancelled/inactive account handling

The selector hides accounts with status CANCELED, CLOSED, DISABLED. Users who genuinely need historical data for cancelled accounts can request that feature explicitly — it's not a default we want.

## Build notes

- `npx supabase gen types typescript` appended a `<claude-code-hint>` annotation that broke `tsc`. Stripped manually post-generation. If a future regen has the same issue, check Supabase CLI flags for a no-hints option.

- The `_token_placeholder` sentinel-row approach was considered and rejected in favor of the `platform_credentials` table. Reasoning: avoids the need for `AND account_id != '_token_placeholder'` filters in every connections query, future-proofs for additional OAuth metadata (scopes, expiry), and follows the standard credentials-separation pattern.

- Backward-compat wrappers in plans.ts (ACTIVE_ACCOUNTS_LIMIT, getUserAccountsLimit, buildLimitError) are kept as @deprecated during the migration to support the old connections pages until C10 rebuilds them.

## Migration permission gotcha

New tables created in Supabase require explicit GRANT statements for the service_role to access them, even though service_role nominally bypasses RLS. The initial `2026-05-18-platform-credentials-table.sql` migration created the table + enabled RLS + added a SELECT policy for authenticated users, but did NOT include:

```sql
GRANT ALL ON platform_credentials TO service_role;
GRANT USAGE ON SEQUENCE platform_credentials_id_seq TO service_role;
```

This caused the discover endpoint to fail with `permission denied for table platform_credentials` (Postgres error 42501) when admin clients tried to read tokens. Future schema migrations creating new tables MUST include these GRANTs.

## Hybrid discovery (resolved)

Initial implementation used `customer_client` GAQL query (MCC-scoped) for Google account discovery only. This worked for agency users whose accounts are linked under our MCC, but returned 0 results for standalone account owners (the user owns accounts directly, not via an MCC).

For Saudi/Gulf market reality (mostly brand-owners with standalone Google Ads accounts, not agencies with MCCs), this was a blocking gap.

**Resolved in PR #22 (commit `8540553`)**: `/api/google-ads/discover` now uses hybrid discovery — customer_client first, falls back to listAccessibleCustomers + per-account fetchCustomerDetails when MCC query is empty. Standalone account owners (majority of Saudi market) now see their accounts in the selector. Cancelled/inaccessible accounts drop naturally because `fetchCustomerDetails` returns null for them; the standalone path assumes ENABLED status for surviving rows since the API only allows queries on queryable accounts.

## Consequences

### Positive

- Industry-standard UX matching Triple Whale, Northbeam
- Clean DB — only accounts the user actually uses
- No cancelled-account name workarounds — hidden from selector
- Plan-aware from day 1 — Phase 10 billing slots in cleanly
- Future platforms (TikTok, Snapchat, Salla, Zid) follow the same pattern — copy the Google discover+select structure
- Schema separation: tokens and account data don't entangle

### Negative

- Throws away PR #20's status enrichment work (~6 hours). Branch preserved for reference.
- Existing pending connections deleted in migration. Active connections preserved with their tokens migrated to platform_credentials.
- Standalone Google accounts (not MCC-linked) won't appear in selector for now. The customer_client query only returns MCC-linked accounts. Future iteration can add a "manually enter account ID" path for that edge case.

## Migration

`src/lib/migrations/2026-05-18-pivot-to-selection.sql` does three things:
1. Backup pending connections to a snapshot table for recovery
2. Move refresh tokens from `connections.access_token` → `platform_credentials.refresh_token` (for active connections, via INSERT ... ON CONFLICT DO NOTHING)
3. Delete pending Google/Meta connections so users start fresh in the new flow

Active connections are preserved end-to-end.

## Phase 10 hook points

When billing arrives:
1. Replace `getUserTier(userId)` body with Stripe subscription lookup
2. Add upgrade flow that links from the plan limit banner to checkout
3. Add per-feature checks (e.g., `userHasFeature("smart_alerts")`) using the `features` array on PlanLimits
4. Lower trial workspace limit from Infinity to a real number

No structural changes needed.
