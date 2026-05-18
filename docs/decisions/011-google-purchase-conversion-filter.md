# ADR-011: Google Ads purchase conversion filtering via two-query GAQL pattern

**Status**: Accepted  
**Date**: 2026-05-18  
**Supersedes**: N/A  
**Related**: ADR-005 (Google integration + multi-currency), ADR-008 (no silent defaults), Issue #15, Issue #17

## Context

The Google Ads adapter (`src/lib/ads/providers/google.ts`) previously 
mapped `metrics.conversions` directly to `UnifiedInsight.purchases`. 
This conflated real e-commerce purchases with all other conversion 
events tracked in the customer's Google Ads account — form fills 
(SUBMIT_LEAD_FORM), app installs (DOWNLOAD), page views (PAGE_VIEW), 
phone-call leads (PHONE_CALL_LEAD), engagement events (ENGAGEMENT), 
and any custom conversion actions the operator had configured.

For imaa perfumes (production data, last 7 days, May 12-18 2026), 
this produced KPI inflation of approximately 4,400× — 586,148 "sales" 
displayed when the real purchase count was in the low hundreds (~178 
across both purchase actions).

This was filed as Issue #15 (Google purchases semantics) and Issue 
#17 (top-section KPI inflation). The two were ultimately the same 
bug surfacing at different aggregation layers.

## Decision

The Google adapter filters `metrics.conversions` and `metrics.conversions_value` 
to ONLY conversion actions categorized as `PURCHASE` (category integer 
4) or `STORE_SALE` (category 21) at the time of sync. The filtering 
happens via a two-query GAQL pattern:

**Q1** (existing): unsegmented totals for spend, clicks, impressions, 
CTR, CPC, CPM, conversions (raw). Continues to use `fetchCampaigns` 
and `fetchTimeSeries` helpers.

**Q2** (new): `segments.conversion_action` segmented query, summed 
across action IDs from a pre-loaded purchase action ID set. Two new 
adapter methods: `fetchPurchaseCampaignTotals` (FROM campaign) and 
`fetchPurchaseTimeSeriesTotals` (FROM customer).

The two queries are required because GAQL prohibits 
`segments.conversion_action` alongside `metrics.cost_micros` / 
`metrics.clicks` / `metrics.impressions` in the same query (error 
code 53 — `PROHIBITED_SEGMENT_WITH_METRIC_IN_SELECT_OR_WHERE_CLAUSE`, 
verified empirically pre-commit).

The purchase action IDs come from `google_conversion_actions`, a new 
Supabase table populated by `syncConversionActionsForCustomer` during 
the existing `/api/google-ads/sync-accounts` flow. Sync writes the 
full conversion action catalog for each customer; the adapter reads 
only the rows where `counts_as_purchase = true`.

## Type semantics

`UnifiedInsight.purchases`, `revenue`, `roas`, and `costPerPurchase` 
become `number | null`:

- **null**: cache not populated yet (sync hasn't run, or transient 
  Q2 failure caught by the adapter's internal try/catch). Indicates 
  "we don't yet know this account's purchase definition." Companion 
  flag `hasConversionData: false` makes this explicit.
- **0**: cache populated, account has zero PURCHASE/STORE_SALE 
  conversion actions configured. Legitimate zero. `hasConversionData: true`.
- **positive number**: filtered purchase count from Q2. `hasConversionData: true`.

Meta always sets `hasConversionData: true` — its `omni_purchase` 
action_type filter is platform-native and always authoritative.

## Display rules

Counts (purchases, conversions) are rounded to integer at display 
time only — `Math.round(value).toLocaleString("en-US")` — because 
Google's `metrics.conversions` returns fractional values due to 
multi-touch attribution (e.g., 177.701 conversions across 6 days). 
The fractional precision is preserved in the data layer for downstream 
calculations (AOV, ROAS), only collapsed for the UI display.

Currency fields (revenue, spend) keep their decimals.

## Rejected alternatives

**Alternative A — single segmented query**: would have required dropping 
spend/click/impression metrics from the main query, breaking every 
other KPI. Rejected.

**Alternative B — filter at aggregation in client**: client can't 
filter the underlying SDK response without re-fetching with different 
GAQL. Rejected.

**Alternative C — hard-code well-known PURCHASE action names** ("Website 
purchase", "Purchases"): brittle (operators rename actions, use 
non-English names, etc.). Sync-time discovery of the category integer 
is the only robust path. Rejected.

**Alternative D — defer until v2**: not viable. The 4,400× inflation 
was visible to every user with any Google account that had non-purchase 
conversion actions configured (which is most of them). Hotfix priority.

## Trade-offs accepted

- **2× API calls** per insights fetch (Q1 + Q2 in parallel). The 
  Promise.all keeps latency additive only when one query is slower 
  than the other; in practice both finish within similar windows. 
  Acceptable at current scale. Q2 result caching deferred to a future 
  optimization phase.
- **Cache rollover window**: the 15-min `fresh_until` TTL on the 
  insights cache means deployed instances briefly serve pre-fix rows 
  with the old high purchase counts. Acceptable — covered by the 
  defensive consumer check `if (!insight.hasConversionData)` treating 
  undefined as false.
- **Per-ad surface (`normalizeAd`) not filtered**: out of scope. 
  The per-ad creative view will still surface raw `metrics.conversions` 
  until a follow-up tech-debt fix mirrors this pattern there.
- **`addToCart` / `initiateCheckout` / `leads` / `costPerLead` 
  unchanged**: Meta-only fields, honest zero on Google. A future phase 
  may filter these via parallel ADD_TO_CART / BEGIN_CHECKOUT / 
  SUBMIT_LEAD_FORM action ID sets if cross-platform parity is needed.

## Future work

- Mirror this pattern in `normalizeAd` (per-ad creative purchases filter).
- Filter `addToCart`, `initiateCheckout`, `leads` on Google for parity 
  with Meta's custom_conversions.
- Q2 result caching at adapter layer (or merge into insights_cache 
  same TTL) once API cost or latency become measurable concerns.
- Rename `admin` parameter to `client` in `conversion-actions.ts` 
  helpers (now ambiguous — used with both service_role admin client 
  from sync and authenticated user client from factory).
- Encrypt `platform_credentials.refresh_token` at rest before public 
  launch (Phase 11).

## Implementation reference

- Schema: `supabase/migrations/20260518_create_google_conversion_actions.sql` 
  (table) + `supabase/migrations/20260518_grant_authenticated_conversion_actions.sql` 
  (RLS grant hotfix — see commit `b5e0b8c`)
- Sync: `src/lib/google-ads/conversion-actions.ts` 
  (`syncConversionActionsForCustomer`, `getPurchaseActionIds`)
- Factory: `src/lib/ads/factory.ts` (pre-loads purchase action IDs 
  before constructing the adapter)
- Adapter: `src/lib/ads/providers/google.ts` (two-query implementation, 
  three normalize functions accept purchase context)
- Display rounding: `src/app/dashboard/DashboardClient.tsx` and 
  `src/app/dashboard/reports/ReportsClient.tsx` (9 sites)
- Chart hook robustness: `src/lib/hooks/useElementHeight.ts` 
  (callback-ref pattern — see commit `4313303`)

## Commits

- `e76ebab` — primary implementation (types nullable, factory pre-load, 
  adapter two-query, UI null-safety pass)
- `b5e0b8c` — RLS GRANT hotfix (table-level SELECT for authenticated)
- `4313303` — display rounding + callback-ref chart fix
