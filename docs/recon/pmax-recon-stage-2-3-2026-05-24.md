# PMax Recon Report — Stage 2 + 3 + Decisions

**Date:** May 24, 2026
**Branch:** main (recon-only, no commits)
**Scope:** Internal codebase recon (Stage 2) + imaa GAQL recon (Stage 3) + locked architectural decisions for M-PMax
**Companion:** [pmax-recon-2026-05-24.md](pmax-recon-2026-05-24.md) (Stage 1 — external API docs)

---

## Governing principle (Memory #27)

> **"Build for long-term best-fit — NEVER shortcuts that create future double-work.
> Always analyze tradeoffs methodically before deciding — present options + reasoning.
> Design for future clients (thousands of Saudi/Gulf ecommerce), NOT current accounts (imaa).
> 'Simpler now vs robust now' — default to ROBUST."**

This principle overrides previous "ship-fast / extract-later" defaults. Every architectural answer below is checked against it explicitly.

---

## Executive summary

1. **All 4 architectural questions LOCKED.** Q1 row-per-asset-group, Q2 ad_strength+primary_status (performance_label deferred to v2), Q3 Option C (new files for new code, leave proven code alone), Q4 JSONB `type_data` hybrid with discriminated union.
2. **Stage 3 Q3 SURFACED A NEW SDK CONSTRAINT.** `asset_group_asset.performance_label` is rejected by the API at runtime despite being documented at Google Ads v18+. M5 lesson re-confirmed: SDK `fields.d.ts` ≠ SELECTable. Deferred to M-PMax v2 (post-SDK-upgrade investigation) — JSONB `type_data` shape absorbs the future addition with zero migration.
3. **Q2 adjusted accordingly.** Asset-group-level visual = `ad_strength` colored badge (working ✓). Per-asset visual = `primary_status` badge (ENABLED/PAUSED — likely working, implementation-verify). Performance_label categorical badges = deferred.
4. **Imaa is retail PMax** (Q5 confirmed). Risk: asset_groups may be sparse (feed-driven). Per Memory #27/#29 — UI designed for the typical dense case (thousands of future Gulf ecommerce), with graceful empty/sparse states.
5. **Cache version bump v3 → v4 bundled with type change** per M5 lesson. JSONB `type_data` pattern means future Phase 7 (TikTok) / Phase 8 (Snap) / Phase 9 (Salla/Zid) add new union variants — zero schema sprawl, zero new tables.

---

## Locked scope decisions

### In scope for M-PMax (v1)

- `asset_group` queries — metrics, `ad_strength`, `primary_status`
- `asset_group_asset` queries — asset breakdown WITHOUT `performance_label`
- `asset_group_asset.primary_status` per-asset signal (ENABLED/PAUSED)
- Two-query purchase pattern at asset_group level (ADR-011 sibling)
- New `PMAX_ASSET_GROUP` ad_type variant in `UnifiedAd` discriminated union
- Cache shape change with paired schema version bump (M5 lesson)

### Out of scope for M-PMax v1 (deferred to v2 or M-PMax-Retail)

| Item | Reason for deferral | Reachable from current architecture? |
|---|---|---|
| `asset_group_asset.performance_label` (BEST / GOOD / LOW / LEARNING / PENDING) | SDK rejects field; needs upgrade investigation | ✓ JSONB shape absorbs it later, zero migration |
| `asset_group_product_group_view` | Retail PMax — Merchant Center scope | M-PMax-Retail milestone |
| `shopping_performance_view` | Retail PMax — Merchant Center scope | M-PMax-Retail milestone |
| `shopping_product` | Retail PMax — catalog data | M-PMax-Retail milestone |
| `asset_group_listing_filter` | Retail-specific filtering rules | M-PMax-Retail milestone |
| `asset_group_top_combination_view` | Advanced "top combinations" analysis | Future enhancement |
| `performance_max_placement_view` | YouTube/Search/Display channel breakdown | Future enhancement |
| `customer_asset` account-level extensions in PMax | Out of M-PMax scope (M6 ADR-012 already deferred this for non-PMax too) | Future enhancement |

---

## Stage 2 — Internal codebase recon

### File 1: `src/lib/ads/providers/google.ts` (762 lines)

| Member | Lines | Purpose |
|---|---|---|
| Constructor | 41-65 | Takes `refreshToken`, `customerId`, `accountInfo`, `loginCustomerId?`, `purchaseActionIds` |
| `getAccount()` | 67-76 | Returns minimal `UnifiedAccount` |
| `getCampaigns()` | 78-94 | 30d window, delegates to `fetchCampaigns()` |
| `getAccountInsights(range, timeIncrement?)` | 96-145 | Daily series OR aggregate, both with purchase Q2 |
| `getCampaignInsights(range, _timeIncrement?)` | 147-173 | `fetchCampaigns` + purchase Q2 in parallel |
| `getAds(range)` | 175-234 | **5-pass flow** (extension point for M-PMax) |
| `resolveDateRange()` | 244-272 | Date string resolution |
| `normalizeCampaign()` | 280-288 | `CampaignRow` → `UnifiedCampaign` |
| `normalizeCampaignStatus()` | 290-303 | enum mapping |
| `fetchPurchaseCampaignTotals()` | 330-405 | **ADR-011 Q2 template** — pattern for PMax sibling |
| `fetchPurchaseTimeSeriesTotals()` | 418-488 | Same, segmented by date |
| `normalizeTimeSeriesPoint()` | 496-539 | Daily → `UnifiedInsight` |
| `normalizeTotalsToInsight()` | 545-610 | Aggregated totals → `UnifiedInsight` |
| `normalizeCampaignToInsight()` | 615-664 | Per-campaign → `UnifiedInsight` |
| `normalizeAd()` | 672-728 | `AdRow` → `UnifiedAd` |
| `normalizeAdStatus()` | 730-734 | enum mapping |
| `adTypeToCreativeType()` | 743-760 | M5 render-hint mapper |

**5-pass `getAds()` flow** — [google.ts:175-234](src/lib/ads/providers/google.ts#L175-L234):
```
Pass 1 — fetchAds (queries ad_group_ad — won't return PMax rows)
Pass 2 — collect image asset resource names
Pass 3 + 4 — Promise.all: fetchAssetUrls + fetchAdExtensions
Pass 5 — normalize, returning UnifiedAd[]
```

**For PMax:** parallel sibling method `getAssetGroups(range)` returning `UnifiedAd[]` discriminated-union rows with `ad_type: 'PMAX_ASSET_GROUP'`. API route merges both arrays.

**Two-query purchase pattern (ADR-011):** sibling `fetchPurchaseAssetGroupTotals` (FROM asset_group) is a near-mechanical copy.

### File 2: `src/lib/ads/types.ts` — current `UnifiedAd` shape

Types live in `types.ts`. Current `UnifiedAd` is flat with 25+ optional fields, no `kind` discriminator. Q4 locks the rewrite to discriminated union.

### File 3: `src/lib/ads/cache.ts` (224 lines)

`CACHE_SCHEMA_VERSION = "v3"` at [cache.ts:16](src/lib/ads/cache.ts#L16). Both `insights_cache` and `creatives_cache` store `data` as JSONB; no `ad_id` assumption at the SQL layer. Version-suffixed key pipeline already in place — v3 → v4 bump is mechanical.

### File 4: CreativeCard rendering (inline in ReportsClient.tsx)

⚠️ Stage 1 framing wrong: no `src/components/CreativeCard.tsx`. Renderer lives inline in [ReportsClient.tsx](src/app/dashboard/reports/ReportsClient.tsx):
- `CreativeCard` — line 372
- `AdDetailModal` — line 700
- `<CarouselImage>` — line ~260
- `<CarouselDisplay>` — line ~593
- Sub-tab toggle JSX — ~L3147-3220
- `googleActiveTab` state — ~L1244
- Helpers (`useCurrency`, `formatAndConvert`, `getROASColor`, `STATUS_COLORS`, etc.) — inline in same file

---

## Stage 3 — imaa GAQL recon (results)

### Q1 (PMax campaigns) — PASSED ✓
PMax campaigns confirmed in imaa. Counts noted in chat session; design uses ad_type discriminator regardless of exact count per governing principle (design for thousands, not imaa specifics).

### Q2 (asset groups + ad_strength + primary_status) — PASSED ✓
Returns asset_group rows with `ad_strength` + `primary_status` populated. Both fields confirmed working at runtime. Drives Q2 architectural answer.

### Q3 (asset breakdown) — PARTIAL SUCCESS

**Working fields (confirmed at runtime):**
- `asset_group_asset.field_type`
- `asset.type`
- `asset.text_asset.text`
- `asset.image_asset.full_size.url` (fixed from `full_size_image_url`)

**REJECTED field (runtime):**
- `asset_group_asset.performance_label` — SDK error:
  > "Unrecognized field in the query: 'asset_group_asset.performance_label'"

**Documented at Google Ads v18+; rejected by current SDK at runtime.** Same trap as M5 (`image_ad.image_asset` documented but rejected) and M6 (`sitelink_asset.description1/2` documented but rejected). The SDK `fields.d.ts` listing a field ≠ guarantee it's SELECTable. See "Known SDK constraints for M-PMax v1" section below.

**Strategic decision:** drop `performance_label` from M-PMax v1. Do NOT block on SDK upgrade investigation (scope creep + production risk). JSONB `type_data` shape accommodates the future addition with zero migration when SDK is upgraded.

### Q4 (asset_group metrics, 30-day) — PASSED ✓
Per-asset_group 30-day metrics returned. Confirms metrics ARE per-asset_group, not just campaign-level. Supports Q1's row-per-asset-group answer.

### Q5 (retail PMax detection) — PASSED ✓
`shopping_setting.merchant_id` populated → **imaa IS retail PMax.** Risk flagged in section below.

---

## Known SDK constraints for M-PMax v1

| Field | Status | Mitigation |
|---|---|---|
| `asset_group_asset.performance_label` | REJECTED at runtime (current `google-ads-api` v23) | Defer to M-PMax v2. JSONB `type_data` shape adds zero-migration cost when SDK supports it |
| Other PMax fields (untested) | Unknown — every new SELECT field carries the same risk | Incremental field addition during implementation; verify each new field with isolated test query before adding to production GAQL |

**M5 + M6 + M-PMax trifecta lesson:** every Google Ads API field is innocent-until-tested. The SDK type system tells us what SHOULD exist; the runtime tells us what's actually queryable. Per the M5 lesson (`feedback_reproduce_before_reship.md`), local repro with prod env vars + per-field isolation is the only reliable detection method.

**Future investigation (not part of M-PMax v1):**
- Pin SDK version explicitly in `package.json` if upgrade is needed
- Consider creating a lightweight GAQL field validator helper that runs an isolated SELECT-1-field query per new field added — would have caught the M5 / M6 / M-PMax regressions at dev time

---

## Architectural answers — Q1-Q4 (LOCKED)

### Q1: row granularity — LOCKED: row-per-asset-group, UI groups visually

Backend returns one row per asset_group. Frontend groups by campaign visually.

**Principle check:** ✓ — asset_group IS the creative unit in PMax's mental model. Matches Google's own UI. Symmetric with M5 RSA-per-row.

### Q2: visual indicators — LOCKED (adjusted from initial plan)

**Asset-group-level visual:** colored `ad_strength` badge

| ad_strength | Color | Meaning |
|---|---|---|
| `EXCELLENT` | green | Best — all asset types fully covered |
| `GOOD` | blue | Strong — most asset types covered |
| `AVERAGE` | yellow | Acceptable — some gaps |
| `POOR` | red | Needs attention — significant gaps |
| `NO_ADS` | gray with `!` | No active assets |

**Per-asset visual:** `primary_status` indicator (NOT `performance_label`)

| primary_status | Color | Meaning |
|---|---|---|
| `ENABLED` | green | Currently active |
| `PAUSED` | gray | Currently paused |
| `REMOVED` | (excluded by WHERE clause) | — |

**Deferred to M-PMax v2:** `performance_label` per-asset categorical badge (BEST / GOOD / LOW / LEARNING / PENDING). Will be added when SDK supports the field. UI design will need to integrate it into existing per-asset card slot — straightforward addition.

**Principle check:** ✓ — works with current SDK constraints, designs for the dense case (thousands of future accounts with rich asset coverage), gracefully handles sparse retail imaa case. Future v2 enhancement (performance_label) slots in without breaking existing v1 UI.

### Q3: component architecture — LOCKED: Option C (new files for new code, leave proven code alone)

**Decision:** Create new files in `src/components/creatives/` for M-PMax UI:
- `src/components/creatives/PMaxAssetGroupCard.tsx` (new)
- `src/components/creatives/PMaxAssetGroupModal.tsx` (new)
- `src/components/creatives/shared/` — helpers module extracting ONLY the helpers PMax needs (`formatAndConvert`, `getROASColor`, `STATUS_COLORS`, etc.) into reusable imports

**Leave untouched:** existing M5/M6 inline code in `ReportsClient.tsx`. Migration of inline → extracted is a separate future task (Memory #30 design pass, OR an explicit follow-up after M-PMax ships and proves the pattern).

**Why Option C wins** (vs Option A inline-defer, vs Option B extract-everything-now):

1. **Principle alignment:** the principle prohibits shortcuts that create future double-work. Option A shortcuts the new code (inline forever → compounds with TikTok/Snap). Option C does NOT shortcut new code.
2. **Risk minimization:** Option B touches tested M5/M6 production code for a structural-only reason. Option C does not.
3. **Sets the exemplar:** future TikTok/Snap follow the established pattern from day one. Memory #30 design pass becomes a focused "migrate the remaining 2 inline renderers" task — not an ever-expanding refactor.
4. **Tradeoff accepted:** codebase has temporary inconsistency (some inline, some extracted) during the transition. The inconsistency points in the right direction — new pattern IS the target state.

**Principle check:** ✓✓ — best long-term-fit. Neither shortcut nor preemptive refactor.

### Q4: cache shape — LOCKED: JSONB `type_data` hybrid (discriminated union)

**Decision:** `UnifiedAd` becomes a discriminated union with `ad_type` literal as discriminator + common metrics as proper fields + variant-specific data in `type_data` JSONB-shaped object.

**Type shape:**

```ts
// Common fields — present on EVERY ad type (always populated, never optional)
interface UnifiedAdCommon {
  id: string;
  account_id: string;
  ad_type: AdType;        // the discriminator
  status: "ACTIVE" | "PAUSED" | "DELETED";
  currency: string;
  campaignId?: string;
  campaignName?: string;
  // Performance metrics — uniform across ALL ad types
  impressions: number;
  clicks: number;
  spend: number;          // cost_micros / 1M, already in account currency
  conversions: number;    // purchases
  conversions_value: number;  // revenue
  ctr: number;
  cpc: number;
}

// Discriminated union — each variant has its own type_data shape
export type UnifiedAd =
  | (UnifiedAdCommon & {
      ad_type: "RSA";
      type_data: {
        headlines: string[];
        descriptions: string[];
        finalUrl?: string;
      };
    })
  | (UnifiedAdCommon & {
      ad_type: "RDA";
      type_data: {
        headlines: string[];
        descriptions: string[];
        marketingImages?: string[];
      };
    })
  | (UnifiedAdCommon & {
      ad_type: "IMAGE_AD";
      type_data: {
        imageUrl?: string;
      };
    })
  | (UnifiedAdCommon & {
      ad_type: "META_AD";
      type_data: {
        imageUrl?: string;
        thumbnailUrl?: string;
        carouselImages?: string[];
        catalogProducts?: Array<{ id: string; name?: string; imageUrl?: string }>;
        title?: string;
        body?: string;
        callToAction?: string;
        previewLink?: string;
      };
    })
  | (UnifiedAdCommon & {
      ad_type: "PMAX_ASSET_GROUP";
      type_data: {
        adStrength: "EXCELLENT" | "GOOD" | "AVERAGE" | "POOR" | "NO_ADS";
        primaryStatus: "ENABLED" | "PAUSED";
        assets: Array<{
          fieldType: string;            // HEADLINE / DESCRIPTION / MARKETING_IMAGE / ...
          assetType: string;            // TEXT / IMAGE / YOUTUBE_VIDEO
          primaryStatus?: string;       // per-asset ENABLED/PAUSED (verify in impl)
          text?: string;
          imageUrl?: string;
          youtubeVideoId?: string;
          // performance_label deferred to v2 — see Known SDK constraints
        }>;
      };
    });
// Future Phase 7+: TikTok, Snap, Salla, Zid add their own variants here
```

**Storage:** for M-PMax v1, serialized into existing `creatives_cache.data` JSONB (no new `unified_ads` real table). Real-table migration deferred to Phase 9-10 analytics work where SQL-level cross-ad-type aggregation matters.

**Cache version:** v3 → v4 in same atomic commit as type change (M5 lesson).

**Principle alignment** (5 points, briefly):
1. Zero migrations for future ad types (TikTok / Snap / Salla / Zid all just add union variants)
2. Common metrics stay structurally addressable — future `unified_ads` real table migration is trivial because shape already matches
3. TypeScript discriminated union narrowing is compile-time-enforced
4. Aligns with ADR-008 metadata pattern (jsonb for variant-specific, columns for queryable)
5. Avoids table proliferation (Phase 8 would otherwise have 4-6 cache tables)

---

## Updated risks

| Risk | Mitigation |
|---|---|
| **NEW: `asset_group_asset.performance_label` rejected at runtime despite SDK type index** | Defer to M-PMax v2. JSONB `type_data` shape absorbs future addition. Document in Known SDK constraints |
| **NEW: Other PMax fields may have similar SDK constraint issues** | Incremental field addition during implementation; isolated test query per new field. Per M5 lesson: SDK field index ≠ runtime queryability |
| `google-ads-api` SDK may not expose all PMax fields cleanly (M5+M6+M-PMax trifecta lesson) | Per-type query isolation (M6 pattern), error extraction via `errors.GoogleAdsFailure.errors[]`, local repro with prod env before push |
| Cache schema bump (v3 → v4) must land **with** the type change (M5 lesson) | Bundled in atomic commit |
| Two-query GAQL purchase pattern may behave differently for asset_group resource | Test on isolated query first; sibling fetcher modeled after `fetchPurchaseCampaignTotals` |
| Discriminated union refactor touches many files in one commit | M5/M6 lessons — local repro + hardened error logging + verify cache bump end-to-end before push |
| `ad_type` discriminator must be set on EVERY existing M5/M6 row in normalize functions | TypeScript compiler rejects normalizes that forget — compile-time enforcement |
| ⚠️ **imaa is RETAIL PMax** — `shopping_setting.merchant_id` populated | Retail PMax asset_groups may be sparse (product feed carries most creative). UI MUST gracefully render asset_group with `assets.length === 0` or near-zero — show metrics + ad_strength + "(retail PMax — assets driven by product feed)" hint |
| ⚠️ **imaa is the only test account available — Memory #29 trap risk** | **Per governing principle:** design UI for the typical dense case (5-asset_group / 15+ assets / EXCELLENT/GOOD ad_strength distribution) explicitly. Add hardcoded preview/storybook example for the dense case before shipping. Imaa's sparse retail case is the edge, not the primary |
| Option C component-extraction creates inconsistency (some inline, some extracted) during transition | Acceptable per Memory #30 — inconsistency is directional (new pattern is target state). Migration of M5/M6 inline → extracted is focused future task, not ever-expanding refactor |
| `asset_group.ad_strength` enum added in v22 or v23 — SDK version compatibility | SDK is v23 per package.json — verified working in Stage 3 Q2 |

---

## Flags / contradictions with Stage 1

| ⚠️ | Topic | Stage 1 said | Stage 2/3 found | Decision impact |
|---|---|---|---|---|
| ⚠️ | CreativeCard location | `src/components/CreativeCard.tsx` (separate file) | Inline at [ReportsClient.tsx:372](src/app/dashboard/reports/ReportsClient.tsx#L372) | Q3 framing collapsed; expanded to 3-option analysis → Option C locked |
| ⚠️ | `unified.ts` location | Stage 1 referenced `src/lib/ads/unified.ts` | Types live in `src/lib/ads/types.ts` | Cosmetic |
| ⚠️ | Q4 initial recommendation | Stage 2 first draft recommended Option B (separate table) | After principle-based analysis: **JSONB `type_data` hybrid is correct** | LOCKED |
| ⚠️ | Q3 inline-defer recommendation | Stage 2 first draft accepted "inline + defer to Memory #30" | After principle-based re-analysis: Option C (new files for new code, leave proven code alone) | LOCKED |
| ⚠️ | Q3 field name in script | Stage 1 sample used `asset.image_asset.full_size.url` | First script run used wrong path; error_code 32 | FIXED — re-run confirmed working |
| ⚠️ | **NEW:** `performance_label` availability | Stage 1 listed it as the per-asset metric (Q2 design depended on it) | Runtime rejection by SDK | Q2 architectural answer adjusted — `primary_status` substitutes; `performance_label` deferred to v2 |
| (no contradiction) | Two-query pattern reusable | Asserted yes | Confirmed | Reduces M-PMax risk |
| (no contradiction) | Cache schema bump bundled | Asserted via M5 lesson | Confirmed via cache.ts read | v3 → v4 path clear |

---

## Next steps

1. **Recon doc finalized** ✓
2. **ADR-013 drafted** (Status: Proposed) — see [013-pmax-architecture.md](../decisions/013-pmax-architecture.md)
3. **You review** ADR-013 + greenlight or push back
4. **Once ADR-013 accepted:** open branch `phase-4.8-m-pmax` and execute the 8-commit atomic sequence from ADR-013 implementation plan

---

## Phase 2 field-isolation results (M-PMax Commit 4, 2026-05-24)

Per ADR-013 field-isolation discipline, the `asset_group_asset` SELECT surface for `fetchAssetGroupAssets` was widened via additive Q6 iterations against imaa. Run via `node scripts/_pmax-recon.mjs`.

### Q6a — base 6 fields

**Status:** ✓ PASSED (50 rows returned)

```
SELECT
  asset_group.id, asset_group.name,
  asset_group_asset.field_type,
  asset.id, asset.type,
  asset.text_asset.text
FROM asset_group_asset
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
LIMIT 50
```

**Confirmed working:** all six fields. Sample row (HEADLINE text asset):
```json
{
  "asset": { "id": 111574805265, "type": 5, "text_asset": { "text": "متجر ايما للعطور" } },
  "asset_group": { "id": 6500713373, "name": "Asset Group 1" },
  "asset_group_asset": { "field_type": 2, "resource_name": "customers/.../assetGroupAssets/6500713373~111574805265~HEADLINE" }
}
```

**Trap noticed (pre-existing API behavior, not a new constraint):** `field_type` integer enum has shifted between Google Ads API versions. imaa returned `field_type=19` for a row whose `resource_name` suffix is `SQUARE_MARKETING_IMAGE`, while older protos numbered 19 as `LONG_HEADLINE`. The `resource_name` suffix is the version-stable label and is now the primary source for `fieldType` in `readAssetFieldType()`; the integer is the fallback.

### Q6b — base + `asset.image_asset.full_size.url`

**Status:** ✓ PASSED (50 rows returned, 3 with populated `image_asset.full_size.url`)

Sample image row (MARKETING_IMAGE):
```json
{
  "asset": {
    "id": 142427938232,
    "type": 4,
    "image_asset": { "full_size": { "url": "https://tpc.googlesyndication.com/simgad/11995517737630841982" } }
  },
  "asset_group_asset": { "field_type": 5, "resource_name": "...~MARKETING_IMAGE" }
}
```

### Q6c — base + image + `asset.youtube_video_asset.youtube_video_id`

**Status:** ✓ PASSED (50 rows; no YouTube video assets in imaa's PMax retail account so no populated values, but the SELECT clause itself parsed and executed cleanly)

This is the most important success: it confirms the field name is correct and the SDK accepts it at runtime, even without sample data in this account. Future accounts with video assets will surface the ID without further field-isolation work.

### Q6 summary

| Iteration | Field added | Status |
|---|---|---|
| Q6a | base 6 fields | ✓ PASSED (50 rows) |
| Q6b | `asset.image_asset.full_size.url` | ✓ PASSED (50 rows) |
| Q6c | `asset.youtube_video_asset.youtube_video_id` | ✓ PASSED (50 rows) |
| Q6d | `asset_group_asset.performance_label` | SKIPPED (confirmed rejected in Stage 3 Q3 — re-testing would just re-confirm the trap) |

**Total field surface for `fetchAssetGroupAssets`:** 8 confirmed-working fields. The implementation in `src/lib/ads/providers/google.ts` uses exactly this set — no field added that wasn't isolation-tested.

### Field not in Q6 (flagged for follow-up)

- `asset_group_asset.primary_status` — needed for the optional `assets[i].primaryStatus` slot in `PMAX_ASSET_GROUP.type_data.assets`. Not added to Q6 to keep the iteration scope tight; can be added in a follow-up with the same field-isolation discipline. The shape's optional `?` means omitting is safe.

---

## Phase 3 Retail field-isolation results (M-PMax Commit 6, 2026-05-24)

Web-search prep:
- [asset_group_product_group_view (v23)](https://developers.google.com/google-ads/api/fields/v23/asset_group_product_group_view) — confirmed resource + metrics availability
- [Retail Performance Max reporting](https://developers.google.com/google-ads/api/performance-max/retail-reporting) — documented GAQL examples for `asset_group_listing_group_filter.case_value.product_brand.value` and `asset_group_listing_group_filter.path`
- [Listing Groups for Retail](https://developers.google.com/google-ads/api/performance-max/listing-groups) — confirmed listing groups apply at AssetGroup level via `AssetGroupListingGroupFilter`

### Q7a — base 6 fields

**Status:** ✓ PASSED (20 rows)

```
SELECT
  asset_group.id, asset_group.name,
  asset_group_product_group_view.resource_name,
  metrics.impressions, metrics.clicks, metrics.cost_micros
FROM asset_group_product_group_view
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
LIMIT 20
```

imaa's retail PMax returned 20 product_groups, all under a single Asset Group ("Asset Group 1"). Top row: 7.2M impressions, 26.3K clicks, 41.86K SAR spend.

### Q7b — + conversion metrics + campaign context

**Status:** ✓ PASSED (20 rows). Conversions: top row 1271.8 conversions, 279K SAR conversions_value. Campaign: "Performance Max" (id 21330832483).

### Q7c — + `asset_group_listing_group_filter.id` + `.path`

**Status:** ✓ PASSED (20 rows). **Critical shape discovery:**

`asset_group_listing_group_filter.path` returns a STRUCTURED object, not a string:

```jsonc
// Root catch-all (UNIT_INCLUDED everything-else node):
"path": {}

// Subdivision row (parent that further subdivides on product_item_id):
"path": { "dimensions": [ { "product_item_id": {} } ] }

// Leaf row (specific product offer ID):
"path": {
  "dimensions": [
    { "product_item_id": { "value": "1001595639" } }
  ]
}
```

Each dimension entry is a oneof with a key (`product_item_id`, `product_brand`, `product_category_level1`, etc.) and a body that's either `{}` (wildcard / parent subdivision) or `{ value: "X" }` (specific bucket). Multi-level paths are arrays of multiple dimension entries.

### Q7d — + `asset_group_listing_group_filter.case_value.product_brand.value` (oneof probe)

**Status:** ✓ PASSED (20 rows). The SDK accepted the nested per-dimension oneof path, but every row's `case_value.product_brand.value` was empty because imaa's tree subdivides on `product_item_id`, not `product_brand`. Confirms case_value access works in principle; reading per-dimension values requires a separate SELECT per dimension type.

**Implication for the variant shape:** `.path` is the unified surface we should use — it gives us the structured tree without needing per-dimension SELECTs. `.case_value` access would only be useful for future filtering/grouping queries.

### Q7e — + `asset_group_listing_group_filter.type` + `.vertical`

**Status:** ✗ FAILED.

> "Unrecognized field in the query: 'asset_group_listing_group_filter.vertical'." (query_error 32)

**Fourth instance of the SDK-vs-runtime trap** (after M5 `image_ad.image_asset`, M6 `sitelink_asset.description1/2`, M-PMax `asset_group_asset.performance_label`). Documented in the Google Ads API field listings, rejected at runtime by SDK v23.

Q7e bundled both `.type` and `.vertical`, so `.type` couldn't be isolated in this iteration. Whether `.type` alone is queryable is unknown without a follow-up Q7f probe. The PMAX_PRODUCT_GROUP shape doesn't strictly need `.type` — `path` already lets the UI distinguish root vs leaf via `dimensions.length`, so we can ship without it and add later if a use case emerges.

### Q7 summary

| Iteration | Field added | Status |
|---|---|---|
| Q7a | base 6 fields | ✓ 20 rows |
| Q7b | + conversions + campaign context | ✓ 20 rows |
| Q7c | + `asset_group_listing_group_filter.id` + `.path` | ✓ 20 rows |
| Q7d | + `case_value.product_brand.value` oneof probe | ✓ 20 rows |
| Q7e | + `.type` + `.vertical` | ✗ FAILED (`.vertical` rejected; `.type` couldn't be isolated) |

**Confirmed-working production GAQL field surface for `fetchProductGroups`:**

```
SELECT
  campaign.id,
  campaign.name,
  asset_group.id,
  asset_group.name,
  asset_group_product_group_view.resource_name,
  asset_group_listing_group_filter.id,
  asset_group_listing_group_filter.path,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM asset_group_product_group_view
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND segments.date BETWEEN '<from>' AND '<to>'
```

12 fields. `metrics.conversions` + `metrics.conversions_value` are RAW (all conversion-action types — same caveat as the M5/M6 ad-level data); the purchase-filtered values come in Commit 8 via `fetchPurchaseProductGroupTotals`. Until then PMAX_PRODUCT_GROUP rows surface raw spend/impressions/clicks with `purchases/revenue/roas: null` + `hasConversionData: false` per the Commit 4 retrofit pattern.

### Shape revisions needed for `PMAX_PRODUCT_GROUP.type_data`

Provisional shape from ADR-013:
```ts
PMAX_PRODUCT_GROUP: {
  assetGroupId: string;
  assetGroupName: string;
  productGroupDimensionPath: string[];
  productCount?: number;
};
```

Q7 forces these revisions:
1. **`productGroupDimensionPath` should be `Array<{ dimension: string; value?: string }>`**, NOT `string[]`. Pure string array loses the dimension-type metadata. Example:
   ```
   [{ dimension: "product_item_id", value: "1001595639" }]   // leaf
   [{ dimension: "product_item_id" }]                        // subdivision (no value)
   []                                                         // root catch-all
   ```
2. **`productCount` is not exposed by `asset_group_product_group_view`** — comes from `shopping_performance_view` (Commit 7) if needed. Either drop the field or keep optional and source from Commit 7's join. Recommend drop now, re-add in Commit 7 if Commit 7 work surfaces a clean per-product-group count.
3. **Add `listingGroupFilterId: string`** — enables cross-referencing with future shopping_performance_view rows and is a stable identifier for the row (resource_name has `~`-separated suffix that includes it, but explicit is cleaner).
4. **Add `isRootGroup: boolean`** — derived from `path.dimensions` being empty. UI uses this to distinguish "All products (catch-all)" rows from specific subdivisions/leaves. Cheap to compute at adapter time.
