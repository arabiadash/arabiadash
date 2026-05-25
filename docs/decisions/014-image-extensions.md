# ADR-014: Image Extensions on Search ads

**Status**: Draft — awaiting approval
**Date**: 2026-05-26
**Phase**: 4.8 M8
**Related**: ADR-005 (Google integration + multi-currency), ADR-008 (no silent defaults), ADR-011 (two-query GAQL pattern), ADR-012 (Asset Extensions architecture — M6, the template this builds on), ADR-013 (PMax architecture + integer-drift discipline), Memory #28 (cache bump unmasks broken integration pattern)
**Recon**: [docs/recon/image-extensions-recon-2026-05-26.md](../recon/image-extensions-recon-2026-05-26.md) (Stages 1 + 2 + 3, Q1–Q10)

## Context

Google Ads Search ads can carry **image extensions** — visual assets that render alongside the ad text in Search results. These are conceptually a new asset type in the M6 ADR-012 family (which shipped SITELINK + CALLOUT + STRUCTURED_SNIPPET) and are the user's stated priority for M8.

Stage 1–3 recon against imaa established the data model + a definitive bug-finding about Google's public documentation:

- Images attach via `campaign_asset` (campaign-level inheritance) — the **same table M6 already queries** for SITELINK + CALLOUT + STRUCTURED_SNIPPET. `ad_group_asset` and `ad_group_ad_asset_view` returned 0 image-typed rows on imaa (H2/H3 rejected). `customer_asset` carries only the account-level BUSINESS_LOGO (H4 partially rejected).
- The image asset itself lives in the `asset` resource with `asset.type=IMAGE` (proto integer 4), URL at `asset.image_asset.full_size_image_url` — the exact field [M5's fetchAssetUrls](../../src/lib/google-ads/assets.ts) already resolves in production for RDA marketing_images.
- **Integer-drift trap (11th documented instance, first where public docs disagree with on-the-wire reality)**: web search across multiple Google docs sources gave `MARKETING_IMAGE=5, LANDSCAPE_LOGO=26, BUSINESS_LOGO=27`. Q9 + Q10 resource_name suffix walk on imaa proved `field_type=26` resolves to **AD_IMAGE** on this account, not LANDSCAPE_LOGO. The fix: trust the resource_name suffix (`...~AD_IMAGE`) as the authoritative label, fall back to the integer only when no suffix is present. Same pattern as M-PMax's [readAssetFieldType](../../src/lib/ads/providers/google.ts) helper.
- **SDK-vs-runtime traps surfaced during recon (instances #5, #6, #7 in the milestone series)**:
  - `asset.image_asset.{file_size, mime_type}` rejects when bundled in SELECT (Q1)
  - `ad_group_ad_asset_view.status` doesn't exist as a SELECTable field (Q5; M6 already avoids this)
  - `ad_group_ad.ad.responsive_search_ad.images` rejected (Q6b) — RSAs have no inline image array, images only attach via asset linkages
- **GAQL semantic constraint**: `campaign.id` MUST appear in SELECT when used in WHERE on `campaign_asset` (`query_error 16` MISSING_REQUIRED_FIELD_IN_SELECT_CLAUSE). Same pattern as M-PMax `fetchPurchaseProductGroupTotals`.

**imaa expected data shape** (Stage 3 Q10):

| Campaign | AD_IMAGE | BUSINESS_LOGO | Total |
|---|---:|---:|---:|
| 4 Brand Search campaigns × | 9 | 1 | 10 each |
| TOTAL | 36 | 4 | 40 |

Same 9 AD_IMAGE asset.ids inherit across all 4 campaigns (one image pack linked to each). One BUSINESS_LOGO inherits via `customer_asset` to each. **LANDSCAPE_LOGO + MARKETING_IMAGE family**: zero rows on imaa, included in the filter clause for forward-compat on other accounts.

## Decision

### 1. Render shape — Option C: single array with per-entry discriminator

```typescript
extensions: {
  // ...existing sitelinks, callouts, structuredSnippets
  images?: Array<{
    url: string;
    fieldType: ImageAssetFieldType;
    assetId: string;
    widthPx?: number;
    heightPx?: number;
  }>;
}

export type ImageAssetFieldType =
  | "AD_IMAGE"
  | "BUSINESS_LOGO"
  | "LANDSCAPE_LOGO"
  | "MARKETING_IMAGE"
  | "SQUARE_MARKETING_IMAGE"
  | "PORTRAIT_MARKETING_IMAGE"
  | string; // forward-compat catch-all per integer-drift discipline
```

**Rationale**: adapter stays simple (one fetcher, one merge step). UI splits by `fieldType` at render time (Decision 4). String-fallback union prevents future field_types from breaking the type at runtime — same defensive pattern used by M-PMax `OTHER_${number}` fallback.

### 2. Filter scope — 6 field_types

```sql
WHERE asset.type = 'IMAGE'
  AND campaign_asset.field_type IN (
    'AD_IMAGE',          -- creative image extension (imaa: 36 rows)
    'BUSINESS_LOGO',     -- square brand logo (imaa: 4 rows)
    'LANDSCAPE_LOGO',    -- wide brand logo (forward-compat; imaa: 0 rows)
    'MARKETING_IMAGE',   -- proto-name field (forward-compat; imaa: 0 rows)
    'SQUARE_MARKETING_IMAGE',
    'PORTRAIT_MARKETING_IMAGE'
  )
  AND campaign_asset.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

**Rationale**: imaa's data shape verifies AD_IMAGE + BUSINESS_LOGO at minimum. The remaining 4 field_types are speculative for other accounts but cost nothing to include in the IN clause. Resource_name suffix walk (Decision 7) decodes each result regardless of the integer-vs-name divergence.

### 3. Status filter — strict `ENABLED` (not `!= REMOVED`)

```sql
AND campaign_asset.status = 'ENABLED'
AND campaign.status = 'ENABLED'
```

**Rationale**: user explicitly requested "currently serving only, not historical" for M8. This is a **deliberate departure from M6's `!= 'REMOVED'` pattern** ([extensions.ts:232](../../src/lib/google-ads/extensions.ts#L232), [extensions.ts:289](../../src/lib/google-ads/extensions.ts#L289)). M6 includes PAUSED extensions; M8 excludes them.

**M6 retrofit is out of M8 scope** — fixing M6's filter retrospectively requires re-verifying sitelink/callout behavior on every active account and shipping a separate `v8.5 → v9` cache bump. Tracked as follow-up in "Open Items Deferred."

### 4. UI render split — creative prominent, logos inline

| `fieldType` | Render | Where |
|---|---|---|
| AD_IMAGE, MARKETING_IMAGE, SQUARE_MARKETING_IMAGE, PORTRAIT_MARKETING_IMAGE | Prominent image grid (larger thumbnails) | Primary creative content slot in CreativeCard |
| BUSINESS_LOGO, LANDSCAPE_LOGO | Small inline badge | Adjacent to advertiser/campaign name in card header |

**Rationale**: mirrors Google Search visual itself — logos appear next to the domain name in the actual search result, not in a separate corner. Inline-only placement also:

- Avoids visual collision with the existing status badge in the card corner
- Keeps card chrome quieter — less visual noise
- Matches the conceptual purpose (logo = identity, not creative)

AD/marketing images stay in their own prominent grid block below headlines (creative content slot). Same field_type discriminator drives both — no adapter changes needed to split, only UI logic in `CreativeCard`.

### 5. Cache bump — v7 → v8 with mandatory pre-deploy verification

`CACHE_SCHEMA_VERSION` bumps from `"v7"` to `"v8"` in the same atomic commit as the type change. **Mandatory pre-push verification per [Memory #28](../../../.claude/projects/c--Users-LENOVO-Desktop-adlytics/memory/feedback_cache_bump_pattern.md)** — the third "cache bump unmasks broken integration" instance is prevented by:

1. Build preview locally with M8 code: `npm run check` + `npm run build` clean
2. Local dev server up against production Supabase (`.env.local`)
3. Force fresh Google fetch with **`?refresh=true`** query param — both endpoints must return HTTP 200 with `source: "fresh"`:
   - `GET /api/ads/insights?provider=google&account_id=<imaa-id>&refresh=true`
   - `GET /api/ads/creatives?provider=google&account_id=<imaa-id>&refresh=true`
4. Force fresh Meta fetch — both endpoints must return HTTP 200 with `source: "fresh"`:
   - `GET /api/ads/insights?provider=meta&refresh=true`
   - `GET /api/ads/creatives?provider=meta&refresh=true`
5. Any HTTP 500 / non-fresh response → upstream OAuth/API failure → **M8 ship BLOCKED** until the underlying issue is resolved
6. Only after all four endpoints return clean fresh data: push to feature branch

Verification mechanism reference: `forceRefresh = searchParams.get("refresh") === "true"` ([insights/route.ts:59-60](../../src/app/api/ads/insights/route.ts#L59), [creatives/route.ts:121-122](../../src/app/api/ads/creatives/route.ts#L121)) — both routes already support the param and skip cache lookup, calling the adapter directly and writing back. No new code needed.

This blocking rule would have prevented the v5→v6 `9caac84` regression (broken imaa Google OAuth surfaced as "0 campaigns") AND the v6→v7 `6859157` Meta exposure (broken `act_` prefix surfaced as "تعذّر جلب البيانات"). Both regressions would have failed step 3 or 4 of this protocol pre-push.

### 6. Dedup — reuse `fetchAssetUrls`'s existing Set-based dedup

[fetchAssetUrls](../../src/lib/google-ads/assets.ts#L58) already does `Array.from(new Set(resourceNames))` before issuing the GAQL `asset.resource_name IN (...)` query. M8 reuses it as-is. imaa's data shape (same 9 AD_IMAGE assets repeated across 4 campaigns) confirms dedup is load-bearing — without it we'd issue 36 lookups for 9 unique URLs.

### 7. Integer-drift trap mitigation — resource_name suffix walk

Per the Q9 + Q10 finding (web docs say `26=LANDSCAPE_LOGO`, on-the-wire reality says `26=AD_IMAGE` for imaa), M8's per-type fetcher reads the `campaign_asset.resource_name` and extracts the `~`-separated suffix as the authoritative `fieldType`. Integer map is the fallback only.

```
campaign_asset.resource_name = "customers/X/campaignAssets/CAMP_ID~ASSET_ID~AD_IMAGE"
                                                                       ↑
                                                          suffix = authoritative label
```

Same pattern as M-PMax's [readAssetFieldType](../../src/lib/ads/providers/google.ts) helper. To be captured as the **11th documented instance** in [feedback_resource_name_over_integer_enums.md](../../../.claude/projects/c--Users-LENOVO-Desktop-adlytics/memory/feedback_resource_name_over_integer_enums.md) — first instance where Google's published docs are themselves wrong.

## Consequences

### Positive

- **9 currently-serving images render per Brand campaign on imaa** + 1 logo badge (the user's primary success criterion)
- Forward-compat across 4 additional field_types for other accounts that use the proto-name fields
- Zero new GAQL resources — reuses M6's `campaign_asset` path + M5's `fetchAssetUrls`
- Per-entry discriminator keeps adapter simple; render-side split is local to CreativeCard
- 11th integer-drift instance captured to memory — future ad-type additions can skip the web-docs-trust trap
- Cache bump verification protocol formalized — third "cache bump unmasks broken integration" instance prevented at the gate, not after the regression

### Negative

- **M6 vs M8 status-filter inconsistency** — M6 ships with `!= REMOVED` (includes PAUSED), M8 ships with `= ENABLED` (strict). Documented here; retrofit deferred to a separate milestone.
- **Cache v7 → v8 invalidation cascade** — every user sees one slower fetch per platform on first M8 deploy load (~30-min transition window). Same blast radius as v6 → v7 (M-PMax retail removal); pre-deploy verification step is the mitigation against repeating the 9caac84-style false regression.
- **Account-level `customer_asset` image extensions remain deferred** per ADR-012 §5. Small accounts that set images at account level lose v1 coverage on M8 too. Q7 confirmed imaa has no account-level images (only the BUSINESS_LOGO, which already inherits to all campaigns via campaign_asset auto-propagation, so coverage isn't lost on imaa specifically).
- **Image-asset metadata (width_px, height_px, file_size, mime_type) limited to what GAQL safely exposes** — Q1 proved that bundling `file_size` + `mime_type` in SELECT rejects with query_error 32. M8 v1 surfaces only `width_px` + `height_px` (optional) plus the resolved URL. Future v2 can add the remaining fields after per-field isolation testing.
- **Single-fetcher failure isolation lost vs M6's pattern**: M6 has per-type fetchers (`fetchSitelinks` / `fetchCallouts` / `fetchStructuredSnippets`) wrapped in Promise.all so one bad field type doesn't break the others. M8 adds one more `fetchImages` to that array — preserves the pattern. **No regression to M6's failure-isolation contract.**

## Alternatives considered

### Alternative A — Render shape: flat `images: string[]` (URL only, no discriminator)

**Rejected.** Loses the AD_IMAGE-vs-LOGO distinction that's load-bearing for Decision 4's UI split. UI would have to re-classify from URL pattern or fetch metadata separately — same lazy-data-availability anti-pattern ADR-013 Alternative 6 rejected.

### Alternative B — Render shape: split arrays `creativeImages?: string[]; logos?: string[]`

**Rejected.** Forces classification at adapter-write time, baking the AD_IMAGE-vs-LOGO split into the cached JSON. Any future shift in which field_types count as "creative" (e.g., Google introduces a new SUPPLEMENTAL_IMAGE that should render prominently) requires a cache bump. Option C's discriminator lets UI re-classify without invalidating cache.

### Alternative C — Different cache strategy: don't bump version, treat `images?` as graceful-degradation optional

**Rejected.** Cached v7 rows would coexist with newly-fetched v8 rows for up to 24h (the SWR stale window). Mixed-shape rendering means existing-account users see no image extensions until their cache rolls over, while new users see them immediately. Memory #28 verification protocol already covers the risk of bumping; bumping is the cleaner UX.

### Alternative D — Fix M6's status filter (`!= REMOVED` → `= ENABLED`) as part of M8

**Rejected for M8.** Would require re-verifying sitelink/callout/structured_snippet rendering behavior on every active account, plus an extra round-trip explanation to the user about why "I'm shipping image extensions" includes touching their text extensions. M6 status filter retrofit gets its own dedicated commit (deferred to Open Items below).

### Alternative E — Integer-only field_type classification (skip suffix walk)

**Rejected.** Q9 + Q10 proved the integer-to-name mapping is wrong in public docs. Trusting the integer means imaa's 9 AD_IMAGE entries would be mislabeled as LANDSCAPE_LOGO in the type_data — Decision 4's render split would route them to "small brand badge" instead of "prominent image grid." Suffix walk costs zero round-trips (resource_name is already in the existing query response) and prevents the misclassification at the source.

## Implementation plan (single atomic commit, ~100-120 LOC net)

| File | Change | Est. LOC |
|---|---|---|
| **A.** [src/lib/google-ads/extensions.ts](../../src/lib/google-ads/extensions.ts) | Extend `FIELD_TYPE_MAP` to include image integers (with the v23 caveat documented). New `fetchImages` per-type fetcher (mirrors `fetchSitelinks` structure) querying `asset.image_asset.full_size_image_url` + `width_pixels` + `height_pixels`. Use resource_name suffix as the authoritative label, integer map as fallback. Extend `fetchAdLevelLinkages` + `fetchCampaignAssetLinkages` to ALSO collect image-suffix linkages (the WHERE clause already filters by status; field_type extraction widens). | +70-90 |
| **B.** [src/lib/ads/types.ts](../../src/lib/ads/types.ts) | Add `ImageAssetFieldType` string union. Add `images?: Array<{...}>` to `UnifiedAdExtensions`. | +12 |
| **C.** [src/lib/ads/providers/google.ts](../../src/lib/ads/providers/google.ts) | **Zero changes — verified Phase 2a.** The merge at L1108 does `const extensions = extensionsMap?.get(ad.id)` and forwards via shorthand property in the `common` object (L1153). The Map's value type is the entire `UnifiedAdExtensions` object, so adding an `images?` field to that interface (File B) automatically flows through. The `images` field gets populated inside [extensions.ts](../../src/lib/google-ads/extensions.ts) join loop (File A's territory). | **0** |
| **D.** [src/lib/ads/cache.ts](../../src/lib/ads/cache.ts) | Bump `CACHE_SCHEMA_VERSION` `"v7"` → `"v8"` + history entry. | +9 |
| **E.** [src/app/dashboard/reports/ReportsClient.tsx](../../src/app/dashboard/reports/ReportsClient.tsx) | Pre-render split: derive `creativeImages` (AD_IMAGE + MARKETING_IMAGE family) and `logos` (BUSINESS_LOGO + LANDSCAPE_LOGO) from `ad.extensions?.images`. New `{creativeImages?.length > 0 && ...}` block (prominent grid). New `{logos?.length > 0 && ...}` block (small badge — corner or inline). Update `extensionCount` aggregator (L442) to include image count. | +30-40 |
| **F.** [docs/decisions/014-image-extensions.md](014-image-extensions.md) | This ADR. | (this file) |
| **G.** [docs/recon/image-extensions-recon-2026-05-26.md](../recon/image-extensions-recon-2026-05-26.md) | **No edits — frozen artifact.** Stages 1+2+3 already captured. | 0 |

## Verification plan

### Local (pre-push, Memory #28 protocol — BLOCKING)

1. `npm run check` + `npm run build` clean
2. Local dev server up with `.env.local` pointing to production Supabase
3. Force fresh fetch on Google via `?refresh=true` on `/api/ads/insights?provider=google` — expect 200, no `invalid_grant`
4. Force fresh fetch on Meta via `?refresh=true` on `/api/ads/insights?provider=meta` — expect 200, no `act_`-prefix-style errors
5. Load `/dashboard/reports` for imaa Google → expect 9 AD_IMAGE entries rendered per Brand campaign card (prominent grid) + 1 BUSINESS_LOGO badge (small)
6. **Only after all 5 pass: push**

### Post-deploy (production, Vercel hard-refresh)

1. `vercel ls --prod` confirms new deploy Ready
2. Hard-refresh `arabiadash.com/dashboard/reports`
3. Inspect any of the 4 Brand campaigns:
   - Count AD_IMAGE entries — must equal 9 per campaign (matches Q10 + Google Ads UI "9/20" counter)
   - Confirm BUSINESS_LOGO renders as small badge, not as a 10th creative image
4. Cross-platform check: Meta cards must still render with all M-PMax fixes intact (Meta data, Google PMax asset_groups)
5. No console errors / no broken cards
6. **If anything regresses**: `git revert <commit-sha> && git push origin main` — same rollback recipe as the Meta act_-prefix hotfix

### imaa-specific expected values

| Card | Expected |
|---|---|
| Any of 4 "Sales-Search \| Brand \| …" campaign cards | 9 AD_IMAGE thumbnails (grid) + 1 BUSINESS_LOGO badge + existing 3 sitelinks + 3 callouts + 1 business name text |
| extensionCount aggregator on those cards | sitelinks (3) + callouts (3) + structuredSnippets (?) + images (10) = ≥ 16 |

## Open items deferred (NOT in M8 scope)

1. **M6 status-filter retrofit** — change M6 sitelink/callout/structured_snippet WHERE from `!= REMOVED` to `= ENABLED` per the new user-stated "currently serving only" semantic. Gets its own commit + cache bump.
2. **Account-level `customer_asset` image extensions** — per ADR-012 §5 deferral. Q7 confirmed imaa doesn't need this (only its BUSINESS_LOGO is account-level, and that already inherits via campaign_asset). Other accounts may; revisit when a real-world account surfaces the gap.
3. **IMAGE_AD legacy display banner type** — M5 noted SDK rejects `image_ad.image_asset` SELECT; M8 didn't re-probe. Re-test in v23 as a separate small commit if any Display-running account surfaces the gap.
4. **Image metadata expansion** — `file_size` + `mime_type` rejected when bundled (Q1). Per-field isolation testing required before adding them to the v1 SELECT.
5. **`asset_field_type` integer map authoritative source** — Google's public docs disagree with on-the-wire reality. Worth filing a Google Ads API issue OR confirming whether the integers shift account-by-account (would explain the docs-vs-imaa divergence). Out of M8 scope; suffix-walk is the safe defense.
6. **Memory updates** — capture the two new memories:
   - `feedback_cache_bump_pattern.md` (Memory #28) — formalize the 3-instance pattern + the pre-push verification protocol
   - `feedback_resource_name_over_integer_enums.md` — add 11th instance with the Google-docs-are-wrong wrinkle

## Commits

- *(next)* — `docs(adr): ADR-014 Image Extensions architecture draft` (this file)
- *(post-approval)* — `feat(google): M8 Image Extensions on Search ads` (single atomic implementation per Phase 2 spec)
