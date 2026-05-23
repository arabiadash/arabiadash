# ADR-012: Google Asset Extensions architecture

**Status**: Accepted  
**Date**: 2026-05-23  
**Phase**: 4.8 M6  
**Related**: ADR-005 (Google integration + multi-currency), ADR-008 (no silent defaults), ADR-011 (two-query GAQL pattern), M5 merge 4c9b9de + post-mortem in `feedback_reproduce_before_reship.md`

## Context

Google Ads ads carry "Asset Extensions" (sitelinks, callouts, structured
snippets, prices, promotions, calls, images, etc.) that are critical to
the search/display experience but invisible in the M5 creatives surface.
Memory: creative-level analysis is the highest-value reporting feature —
extensions must be surfaced for the user to evaluate ad performance
honestly.

Google's API exposes extensions via three linkage tables:

- `customer_asset` (account-level — applies to all campaigns)
- `campaign_asset` (campaign-level)
- `ad_group_asset` (ad-group-level)

Plus a denormalized view: `ad_group_ad_asset_view` that pre-joins ad →
asset linkage at the row level.

Each asset has its OWN payload shape — `sitelink_asset`, `callout_asset`,
`structured_snippet_asset`, etc. — accessed via `asset.{type}_asset.*`
nested fields. The full AssetFieldType enum has ~35 values; only a
subset is relevant to ecommerce search/display ads.

## Decisions

### 1. Per-type queries, NOT single mega-SELECT

Each asset type gets its own GAQL query against the `asset` resource,
parallelized via `Promise.allSettled`.

**Rationale**: M5 regression (b5e3581 reverted) was caused by a single
invalid field (`ad_group_ad.ad.image_ad.image_asset`) tanking the entire
`fetchAds` query with `error_code: query_error 23`
(INVALID_FIELD_IN_SELECT_CLAUSE). A mega-SELECT-everything approach
maximizes exposure to that exact failure mode. Per-type queries isolate
failures — a broken sitelinks query doesn't break callouts.

**Trade-off**: N round trips instead of 1. With `Promise.allSettled`,
wall time = max(per-type latency), not sum.

### 2. Attribution via `ad_group_ad_asset_view`

Use the denormalized view as the primary entry point, NOT walking three
hierarchy levels client-side.

Query plan (single discovery query):

```sql
SELECT
  ad_group_ad.ad.id,
  ad_group_ad_asset_view.field_type,
  ad_group_ad_asset_view.asset,
  ad_group_ad_asset_view.performance_label,
  ad_group_ad_asset_view.pinned_field
FROM ad_group_ad_asset_view
WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
  AND ad_group_ad.status != 'REMOVED'
```

Yields `(ad_id, field_type, asset_resource_name)` tuples. Group by
`field_type`, then per-type batched fetches against the `asset` resource:

```sql
SELECT asset.resource_name, asset.sitelink_asset.link_text, ...
FROM asset
WHERE asset.resource_name IN ('customers/X/assets/1', ...)
```

**Rationale**: Google pre-joins the linkage in
`ad_group_ad_asset_view`. Avoids client-side hierarchy walking and the
missing-edge-case risk that comes with it.

### 3. Extensions placement: `UnifiedAd.extensions?`

New optional field on UnifiedAd, populated only by the Google adapter.
Meta side untouched — extensions are a Google-only concept.

```typescript
export interface UnifiedAdExtensions {
  sitelinks?: Array<{
    text: string;
    description1?: string;
    description2?: string;
    finalUrl?: string;
  }>;
  callouts?: string[];
  structuredSnippets?: Array<{
    header: string;
    values: string[];
  }>;
  // v1 scope ends here; future: prices, promotions, calls, leadForms, images
}

export interface UnifiedAd {
  // ... existing
  extensions?: UnifiedAdExtensions;
}
```

**Rationale**: Inline keeps the single-payload API (no extra round trips
client-side), reuses the existing `creatives_cache`. Optional +
nullable per-array fields handle graceful degradation — Meta ads and
non-extension Google ads simply omit the field.

### 4. Cache piggyback (creatives_cache + version bump)

No new cache table. UnifiedAd serializes to JSON in
`creatives_cache.data`. New fields appear automatically when
`setCachedCreatives` writes the next entry.

`CACHE_SCHEMA_VERSION` bumped from `v2` → `v3` to invalidate M5-shape
entries that lack the `extensions` field.

**Rationale**: M5 regression also taught us that schema changes without
paired cache invalidation = stale-shape serving = production regression.
Bundled bump (in the same commit as the type change) prevents the gap.

### 5. v1 scope: 3 extension types

v1 ships: **SITELINK + CALLOUT + STRUCTURED_SNIPPET**.

Deferred to future commits/sessions:

- PROMOTION + PRICE (ecommerce-specific, more complex nested shapes)
- CALL + LEAD_FORM (service/lead-gen accounts)
- MARKETING_IMAGE + SQUARE_MARKETING_IMAGE + PORTRAIT_MARKETING_IMAGE
  (display extensions; would reuse M5's `fetchAssetUrls` URL resolution
  pattern)
- YOUTUBE_VIDEO, LOCATION, MOBILE_APP, BUSINESS_NAME, LOGO, etc.
- Account-level (`customer_asset`) extensions — small accounts that set
  extensions at account level lose coverage in v1

**Rationale**: SITELINK + CALLOUT + STRUCTURED_SNIPPET = the visible
majority of what users see on Google Search ads. Smaller scope = less
surface for query failures. Iterate based on observed usage.

### 6. Hardened error path (M5 lesson)

Per-type fetchers log `error.message` (one line, no stack) before
returning empty `Map`. Replaces the previous silent
`catch {} return null;` pattern that hid the M5 regression for hours.

**Rationale**: M5 silent catch swallowed the `GoogleAdsFailure` with
error_code 23. Cost hours of debugging. Brief production-safe logging
is cheap insurance — the trade-off (one log line per upstream failure
vs. blind production regressions) is overwhelmingly worth it.

## Consequences

### Positive

- Per-ad extension visibility for sitelinks, callouts, structured
  snippets — the highest-frequency extensions on real search ads
- Failure isolation per extension type (one bad SDK field doesn't kill
  the rest)
- Schema-change cache invalidation pattern (v2 → v3) is reusable for
  future shape changes
- Foundation for future extension types: each one is a new per-type
  fetcher in `extensions.ts`, no architectural redesign

### Negative

- N+1 queries (1 `ad_group_ad_asset_view` + N per-type asset queries)
  per `getAds` call — mitigated by `Promise.allSettled` parallelism
  (wall time = slowest per-type call, not sum)
- Cache payload size grows ~3KB per ad with full extensions populated
  (search ad with 6 sitelinks + 4 callouts + 2 structured snippets).
  Within `creatives_cache.data` JSONB capacity but worth monitoring
- Account-level extensions (`customer_asset`) deferred — small accounts
  that set extensions at account level lose v1 coverage

## Related

- ADR-005: Google Ads adapter + multi-currency
- ADR-008: Data hygiene (no silent defaults) — extended here to "no
  silent error swallows on third-party APIs"
- ADR-011: Google Ads purchase conversion filtering (two-query GAQL
  pattern — same architectural shape we use here)
- M5 merge commit `4c9b9de` — image asset URL resolution in
  `src/lib/google-ads/assets.ts` (pattern this builds on for per-type
  asset payload fetching)
- M5 post-mortem in `memory/feedback_reproduce_before_reship.md` —
  local-repro-with-prod-env-vars protocol, derived from the M5
  regression investigation that produced this ADR's per-type +
  error-logging decisions
