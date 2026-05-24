# ADR-013: Performance Max architecture (asset group + product group)

**Status**: Accepted
**Accepted on**: 2026-05-24
**Date**: 2026-05-24
**Supersedes**: prior draft of ADR-013 (asset-level only, retail deferred) — rejected on no-deferrals principle
**Related**: ADR-005 (Google integration + multi-currency), ADR-008 (no silent defaults), ADR-011 (two-query GAQL purchase filter — reused at asset_group AND product_group level), ADR-012 (Google asset extensions — per-type query pattern + hardened error logging carry over), Memory #27 (CORE PRINCIPLE — build for long-term best-fit), Memory #29 (design for thousands of future Saudi/Gulf ecommerce; typical persona = PMax + Shopping + RDA), Memory #18 (PMax priority), Memory #5 (creative-level analysis = highest-value reporting feature)

## Context

Performance Max campaigns differ structurally from every prior Google milestone (M4 campaigns, M5 text ads, M6 asset extensions). PMax has no `ad_group_ad`, no `ad_group_ad_asset_view` — the existing 5-pass `getAds()` flow returns ZERO rows for PMax campaigns. PMax uses `asset_group` as the row-level entity and `asset_group_asset` for assets within each group, plus retail-specific resources (`asset_group_product_group_view`, `shopping_performance_view`) for product-feed-driven accounts.

Memory #29 defines the typical Saudi/Gulf ecommerce persona as running PMax + Shopping + RDA campaigns concurrently. Memory #18 places PMax above other ad-type extensions in priority. Imaa serves as Stage 3 verification that retail PMax queries execute successfully against real accounts (Q4 returned a healthy 30-day window confirming the asset_group resource is fully queryable, Q5 confirmed merchant_id link for retail-specific tables). The persona design target remains the thousands of typical Saudi/Gulf ecommerce accounts (Memory #29) — imaa is testbed, not design target.

Recon findings (full detail in [pmax-recon-stage-2-3-2026-05-24.md](../recon/pmax-recon-stage-2-3-2026-05-24.md)):

- **Asset groups are fully metricized** — `metrics.cost_micros / clicks / impressions / conversions / conversions_value` per asset_group confirmed working (Q4)
- **`asset_group_asset.performance_label` is rejected at runtime** despite documented at Google Ads v18+ — third instance of "SDK field index ≠ runtime queryability" trap (M5 = `image_ad.image_asset`, M6 = `sitelink_asset.description1/2/final_urls`). Must validate every new SELECT field via isolated query during implementation.
- **`asset_group.ad_strength` returns an INTEGER enum** (Stage 3: `ad_strength=5`), not a string. Requires `AD_STRENGTH_MAP` constant per existing `CUSTOMER_STATUS_MAP` precedent (Memory trap #22).

**Governing principle** (Memory #27, verbatim):

> "Build for long-term best-fit — NEVER shortcuts that create future double-work. Design for thousands of Saudi/Gulf ecommerce, not imaa. Default to ROBUST."

User's exact words: **"ابني كل شي على مبدأ الاحصن والافضل لقدام عشان ما يصير دبل ورك"**

This principle overrides previous "ship-fast / extract-later" defaults. Every architectural answer below is checked against it explicitly. The earlier-drafted version of this ADR scoped M-PMax as "asset-level only, defer retail to M-PMax-Retail" — that split was rejected on the principle: shipping PMax without retail for the typical Saudi/Gulf persona is half-baked, and the deferred retail work compounds into future-session refactor cost. Full PMax (standard + retail) ships in the same milestone.

## Implementation status (as of this ADR write)

The discriminated union + cache v4 foundation work was executed before this ADR was finalized (an honest violation of the new `feedback_adr_precedes_implementation.md` lesson — that feedback was written in the same session as this ADR to codify the lesson going forward). The completed work survives the scope expansion because the discriminated union + cache v4 bump are foundational regardless of whether retail is in or out of scope.

- ✓ Commit 1: ADR-013 doc (initial narrower-scope draft — superseded by this rewrite)
- ✓ Commit 2 (uncommitted in working tree, locally verified): Cache schema `CACHE_SCHEMA_VERSION` v3 → v4 + `UnifiedAd` discriminated union types (`RSA`, `RDA`, `IMAGE_AD`, `META_AD`, `PMAX_ASSET_GROUP`, `UNKNOWN_GOOGLE` variants) + Meta + Google + ReportsClient adapted to new shape; `npm run check` + `npm run build` clean
- ⏳ Pending: `PMAX_PRODUCT_GROUP` variant added to discriminated union
- ⏳ Pending: Google adapter `getAssetGroups` (asset_group query, sub-decision 2)
- ⏳ Pending: Google adapter `getAssetGroupAssets` (asset_group_asset query)
- ⏳ Pending: Two-query purchase filter at asset_group level (sibling of ADR-011's `fetchPurchaseCampaignTotals`)
- ⏳ Pending: Google adapter retail queries (`asset_group_product_group_view`, `shopping_performance_view`)
- ⏳ Pending: Two-query purchase filter at product_group level
- ⏳ Pending: Component extraction — `MetaCreativeCard`, `GoogleCreativeCard`, `PMaxAssetGroupCard`, `PMaxProductGroupCard`
- ⏳ Pending: `ReportsClient.tsx` integration + sub-tab navigation + e2e verification

## Decision

### 1. Full scope: standard + retail PMax ship in the same milestone

**In scope:**
- `asset_group` queries — metrics (spend/clicks/impressions/conversions/conversions_value), `ad_strength`, `asset_coverage`, `primary_status`
- `asset_group_asset` queries — assets bundle, `performance_label` (with SDK-rejection fallback), content URLs
- `asset_group_product_group_view` queries — retail per-product-group performance
- `shopping_performance_view` queries — retail per-product metrics
- Two-query purchase filter at BOTH asset_group AND product_group level (ADR-011 sibling pattern, two new fetchers)
- Component extraction — `MetaCreativeCard`, `GoogleCreativeCard`, `PMaxAssetGroupCard`, `PMaxProductGroupCard` (refactor existing inline + add new)
- UI for `ad_strength` colored badges + `performance_label` colored badges + retail ROAS-colored product card borders

**Out of scope** (legitimately different work, not deferrals):
- TikTok / Snap / Salla / Zid integrations — Phases 7-9, separate provider work
- Smart Alerts — Phase 5
- AI Recommendations — Phase 6

**PMax-related features explicitly out of M-PMax scope** (tertiary value, separate follow-up if business case emerges):
- `campaign_search_term_view` — PMax search terms reporting
- `performance_max_placement_view` — channel-level placement breakdown
- `asset_group_top_combination_view` — top-performing asset combinations

These are PMax-internal features but address advanced optimization questions, not the core "how is each creative unit performing" question. Not deferrals — different scope. Tracked as potential M-PMax-Advanced if customer interviews surface demand.

**Reasoning:** Memory #29 (typical Saudi/Gulf ecommerce persona = PMax + Shopping + RDA). Shipping PMax without retail surfaces leaves the typical persona with a half-baked dashboard and queues a second M-PMax-Retail milestone that touches the same files. That second pass is the "double-work" Memory #27 prohibits.

The earlier draft of this ADR scoped narrowly on the assumption that scope discipline (smaller, faster) was the better default. That assumption is wrong under the governing principle when the deferred work compounds into future-session rework. Retail's incremental cost (2-3 additional GAQL queries + 1 new product-group variant + 1 new card component) is much smaller than the cost of returning to this area later.

### 2. Row granularity: row-per-asset-group AND row-per-product-group

Backend exposes two new methods: `getAssetGroups(range)` and `getProductGroups(range)`. Each row is one `UnifiedAd` discriminated-union entry — asset_group → `ad_type: "PMAX_ASSET_GROUP"`, product_group → `ad_type: "PMAX_PRODUCT_GROUP"`.

Frontend groups visually by campaign → asset_group → product_group hierarchy. Per Memory #5 (creative-level analysis = highest-value feature), asset_group is the "creative unit" in PMax (matches Google Ads UI's own structuring) and product_group is the analogous unit for retail/Shopping product hierarchy.

**Options considered:**
- (A) Row-per-asset-group only, fold product_groups into asset_group's `type_data` — rejected. Product groups have their own metrics + lifecycle; nesting flattens analytics.
- (B) Row-per-campaign + nested asset_groups + nested product_groups — rejected. Breaks symmetry with M5/M6 row-per-creative-unit pattern; deeper nesting in cache payload.
- (C) **Row-per-asset-group AND row-per-product-group as siblings** (LOCKED) — both are top-level UnifiedAd rows; UI handles visual grouping; analytics queries (future) can aggregate at any level.

### 3. Cache schema: JSONB `type_data` hybrid, v3 → v4 atomic bump

`UnifiedAd` is a discriminated union with `ad_type` literal as discriminator + common metrics as proper fields + variant-specific data in `type_data` JSONB-shaped object.

**Common fields** (present on EVERY variant):
- Identity: `id`, `name`, `ad_type` (discriminator), `status`, `currency`, `accountId?`
- Hierarchy: `campaignId?`, `campaignName?`, `adsetId?`, `adsetName?`
- Performance metrics: `impressions`, `clicks`, `spend`, `purchases` (number|null), `revenue` (number|null), `roas` (number|null), `ctr`, `cpc`, **`hasConversionData: boolean`** (ADR-011 pattern — distinguishes "purchase conversion action not configured" from "configured but zero purchases"; essential for honest UI display)
- Asset Extensions: `extensions?: UnifiedAdExtensions` (M6 ADR-012 — Google-only at common level)
- `provider: AdProvider`

**Variant-specific data** lives in `type_data`:
- `RSA`: `{ headlines, descriptions, finalUrl? }`
- `RDA`: `{ headlines, descriptions, marketingImages?, finalUrl? }`
- `IMAGE_AD`: `{ imageUrl?, finalUrl? }`
- `META_AD`: `{ subType, creativeId?, imageUrl?, thumbnailUrl?, videoId?, title?, body?, callToAction?, productSetId?, catalogProducts?, carouselImages?, carouselImageHashes?, previewLink? }`
- `PMAX_ASSET_GROUP`: `{ adStrength, primaryStatus, assets: Array<{fieldType, assetType, primaryStatus?, text?, imageUrl?, youtubeVideoId?}> }`
- **NEW `PMAX_PRODUCT_GROUP`**: `{ assetGroupId, assetGroupName, productGroupDimensionPath: string[], productCount?, /* retail-specific metrics still in common */ }` — shape finalized during commit 5 with isolation-test of each field
- `UNKNOWN_GOOGLE`: `{ googleAdType, finalUrl? }`
- Future Phase 7+: TikTok / Snap / Salla / Zid each add their own variant

**Storage:** the cache schema architectural question (Q4) from PMax recon Stage 1 framed this as "separate pmax_cache table vs JSONB type_data in unified_ads table" — the actual answer is option three: no new real table at all. The discriminated union shape lives only in TypeScript and in serialized form within existing `creatives_cache.data` blob storage. Real-table normalization is deferred to Phase 9-10 analytics work, which is different scope (analytics queries, not caching), not a deferral of M-PMax work.

**Cache version:** v3 → v4 in same atomic commit as type change (M5 lesson). Already in working tree from Commit 2.

### 4. Component extraction

Create new files in `src/components/creatives/`:
- `PMaxAssetGroupCard.tsx` (new — render asset_group with ad_strength badge + nested asset chips)
- `PMaxProductGroupCard.tsx` (new — render product_group with ROAS-colored border + product hierarchy crumbs)
- `MetaCreativeCard.tsx` (new — refactored from inline `CreativeCard` in ReportsClient.tsx, restricted to META_AD variants)
- `GoogleCreativeCard.tsx` (new — refactored from inline `CreativeCard` in ReportsClient.tsx, handles RSA / RDA / IMAGE_AD / UNKNOWN_GOOGLE variants)
- `src/components/creatives/shared/` — helpers module extracting shared accessors (`formatAndConvert`, `getROASColor`, `STATUS_COLORS`, etc.)

`ReportsClient.tsx` becomes a dispatcher: switch on `ad.ad_type`, render the corresponding card component. Memory #30's design-pass milestone becomes a focused per-component redesign rather than a 3000-line file untangle.

**Reasoning:** Memory #27 — establishing the component-extraction pattern as part of M-PMax (the milestone that introduces the discriminated union) avoids compounding inline render code over Phases 7-9 (TikTok / Snap / Salla / Zid). The marginal cost of extracting M5/M6 inline renderers is ~3-4 hours now; deferring it adds compound refactor pain across 4+ ad types later.

The earlier draft of this ADR proposed "new files for new code, leave proven code alone" (Option C). That option was the right call when scope was narrow; under expanded scope, the all-in extraction is correct — we're already touching ReportsClient.tsx for the discriminated union refactor, so consolidating the component split into the same milestone amortizes the verification cost (`npm run dev` regression check happens once, not twice).

### 5. UI representation — colored badges + ROAS-colored borders

**Asset_group level:**

| `ad_strength` | Color | Meaning |
|---|---|---|
| `EXCELLENT` | green | Best — all asset types fully covered |
| `GOOD` | lime | Strong — most asset types covered |
| `AVERAGE` | yellow | Acceptable — some gaps |
| `POOR` | red | Needs attention — significant gaps |
| `NO_ADS` | gray with `!` | No active assets |

**Per-asset (when `performance_label` becomes selectable; deferred to v2 if SDK still rejects at impl time):**

| `performance_label` | Color | Meaning |
|---|---|---|
| `BEST` | green | Top performer |
| `GOOD` | yellow | Above average |
| `LOW` | red | Below average — needs attention |
| `LEARNING` | gray | Still gathering data |
| `PENDING` | striped/light gray | Awaiting first review |
| `UNSPECIFIED` / unknown | neutral gray with `?` | Edge case fallback |

**Retail product cards (ROAS-colored borders):**

| ROAS | Border color |
|---|---|
| `> 3x` | green |
| `1-3x` | yellow |
| `< 1x` | red |

Fallback per-asset visual when `performance_label` rejects: `primary_status` indicator (ENABLED / PAUSED). Asset_group-level `ad_strength` always shows — graceful degradation.

## Consequences

### Positive

- **Full PMax value for typical Saudi/Gulf ecommerce persona on first ship** — standard + retail surfaces both rendered, matches Memory #29 persona's real campaign mix
- **Cache schema absorbs all future ad types without migrations** — Phase 7-9 (TikTok / Snap / Salla / Zid) each add a new union variant with their own `type_data` shape; zero new columns, zero new tables
- **Component pattern scales to all future ad types** — `src/components/creatives/` becomes the canonical home; TikTok/Snap/etc. add their card sibling-files following the same pattern
- **Zero deferred PMax work** — no M-PMax-Retail follow-up milestone needed; this is the whole PMax surface
- **Two-query purchase pattern (ADR-011) reused cleanly** at both asset_group AND product_group level (two near-mechanical copies of `fetchPurchaseCampaignTotals`)
- **`ad_type` is sole structural discriminator** — TypeScript narrowing is compile-time enforced; no overlapping discriminators (the old `creativeType` render hint was removed)
- **`feedback_adr_precedes_implementation.md` lesson codified** — protects future milestones from the parallel ADR/implementation drift that this M-PMax session almost hit

### Negative

- **Larger milestone (~6-8 hours total, ~2-3 already done in working tree)** vs the original narrow ~3-4 hour scope
- **More atomic commits (~12 total, 2 done)** — each must pass `npm run check` + `npm run build` + local repro per M5 lesson
- **Retail-specific GAQL patterns expand complexity** — 2 additional resources (`asset_group_product_group_view`, `shopping_performance_view`), each requires field isolation testing per the M5+M6+M-PMax trifecta lesson
- **Stage 3 Q3 unverified at asset level** — `performance_label` rejected at runtime; must validate `asset_group_asset` field names individually during commit 3 implementation (M5 lesson: trust nothing without GAQL verification)
- **Cache v3 → v4 invalidation cascade** — users see one slower fetch per account on first deploy (~30-min transition window). Acceptable per M5→M6 precedent
- **Component refactor touches M5/M6 tested production code** — mitigated by TypeScript compiler + `npm run check` + local repro before each push; the all-in-one milestone reduces verification overhead vs splitting

## Alternatives considered

**Alternative 1 — Defer retail PMax to a separate M-PMax-Retail milestone** (REJECTED). Reasoning: violates the no-deferrals direction of Memory #27. Memory #29 typical persona includes Shopping/retail. Shipping PMax without retail = half-baked surface for target persona = a guaranteed follow-up milestone touching the same files. The deferred follow-up is the "double-work" trap.

**Alternative 2 — Separate `pmax_cache` table** (REJECTED). Reasoning: table proliferation across Phases 7-9. Each new ad-type family wanting its own table compounds GRANT / RLS / migration pain (M5 lesson: service_role GRANT issue on `creatives_cache` cost ~1 hr to debug). JSONB `type_data` hybrid handles polymorphism cleanly via discriminated union without per-table maintenance.

**Alternative 3 — Inline rendering (no component extraction)** (REJECTED). Reasoning: each future ad type adds inline code to `ReportsClient.tsx`. By Phase 9 the file is ~5000 lines with 8+ render variants. The earlier draft of this ADR accepted this trade as "principled compromise" (Option C — new files for new code, leave proven code alone). Under the expanded-scope decision in sub-decision 4, the full extraction is the right call now to amortize verification overhead against the already-required ReportsClient.tsx touches.

**Alternative 4 — Nullable columns per ad type** (REJECTED). Reasoning: wide table with optional fields for every variant. Worked for M5/M6 ("optional sprawl") but breaks down qualitatively as PMax adds 6+ new fields per variant and Phase 7+ adds more. Column sprawl creates migration debt on every new ad type. JSONB `type_data` absorbs the variability without schema changes.

## Trade-offs accepted

- **Atomic commit count expands from ~6 to ~12** — each commit smaller, but the sequence is longer. Acceptable because each commit is independently testable; bisecting a regression stays clean.
- **Retail surface adds GAQL field-isolation testing burden** — per the M5+M6+M-PMax trifecta lesson, every new SELECT field needs an isolated test query before reaching production. This adds dev-time overhead but is the only reliable detection method for SDK runtime rejections.
- **Component extraction risk to M5/M6 production paths** — mitigated by TypeScript compiler (no consumer that misses a narrowing site compiles) + `npm run check` gating + local repro before each push. Risk is real but bounded by the verification protocol.
- **`performance_label` deferred to v2 if still rejected** — UI design accommodates the v1-without-label state via `primary_status` fallback. JSONB `type_data` shape adds `performanceLabel?` later with zero migration cost. This is a constraint-driven exception to the no-deferrals principle — Google's API itself rejects the field at runtime (third instance of the SDK-field-vs-runtime-queryability trap). We ship the fallback design now and revisit when Google enables or our field-isolation test during commit 5 reveals an alternative path.

## Implementation plan (atomic commits)

**Done:**
- Commit 1: `docs(adr): ADR-013 PMax architecture` — initial doc (SHA `6ead05f`, narrower-scope draft, superseded by this rewrite)
- Commit 2 ✓ Committed as `b002516`: Cache schema v3 → v4 + UnifiedAd discriminated union types (7 variants: `RSA`, `RDA`, `IMAGE_AD`, `META_AD`, `PMAX_ASSET_GROUP`, `PMAX_PRODUCT_GROUP`, `UNKNOWN_GOOGLE`) + Meta + Google + ReportsClient adapted. `PMAX_PRODUCT_GROUP` variant absorbed per Option B (see note below).

**Pending:**
- Commit 3: Google adapter — `fetchAssetGroups` query (`FROM asset_group`)
- Commit 4: Google adapter — `fetchAssetGroupAssets` query (`FROM asset_group_asset`); per-field isolation testing
- Commit 5: Google adapter — `fetchPurchaseAssetGroupTotals` (ADR-011 sibling at asset_group level)
- Commit 6: Google adapter — `fetchProductGroups` query (`FROM asset_group_product_group_view`, retail) — also finalizes the provisional `PMAX_PRODUCT_GROUP` `type_data` shape via field-isolation testing
- Commit 7: Google adapter — `fetchShoppingPerformance` query (`FROM shopping_performance_view`, retail per-product)
- Commit 8: Google adapter — `fetchPurchaseProductGroupTotals` (ADR-011 sibling at product_group level)
- Commit 9: UI extraction — `MetaCreativeCard.tsx` + `GoogleCreativeCard.tsx` from inline; shared helpers module created
- Commit 10: UI new — `PMaxAssetGroupCard.tsx`
- Commit 11: UI new — `PMaxProductGroupCard.tsx`
- Commit 12: ReportsClient integration — dispatcher switch on `ad.ad_type` + sub-tab navigation for asset_group/product_group views
- Commit 13: e2e verification + close-out — verify on imaa retail account (Stage 3 baseline), CLAUDE.md update, M-PMax closed in milestone list, gh issue with `tech-debt` label for any deferred items (e.g., `performance_label` if still rejected)

The final atomic-commit count may merge or split during execution (e.g., commits 3 and 4 may bundle if asset_group_asset is sufficiently coupled to asset_group). The structure above is the planning target, not a hard contract.

**Commit 3 strategy revised post-acceptance:** Option B (bundle `PMAX_PRODUCT_GROUP` variant with Commit 2 atomic foundation) approved in chat. The variant is provisional pending field-isolation testing during commit 6. Reflected in the renumbering above (was 14 commits → now 13).

## Implementation reference

- Recon: [docs/recon/pmax-recon-stage-2-3-2026-05-24.md](../recon/pmax-recon-stage-2-3-2026-05-24.md) — Stage 1 external API docs (in chat session memory), Stage 2 internal codebase analysis, Stage 3 imaa GAQL findings
- Diagnostic script: [scripts/_pmax-recon.mjs](../../scripts/_pmax-recon.mjs) — read-only GAQL probe, re-runnable
- Types refactor (working tree, uncommitted): `src/lib/ads/types.ts` (UnifiedAd discriminated union), `src/lib/ads/cache.ts` (v3 → v4)
- Adapters refactored to discriminated shape (working tree, uncommitted): `src/lib/ads/providers/google.ts`, `src/lib/ads/providers/meta.ts`, `src/lib/meta/api.ts`
- ReportsClient adapted (working tree, uncommitted): `src/app/dashboard/reports/ReportsClient.tsx` (narrowing-based access throughout `CreativeCard` + `AdDetailModal`)
- Memory feedback: [feedback_adr_precedes_implementation.md](../../../.claude/projects/c--Users-LENOVO-Desktop-adlytics/memory/feedback_adr_precedes_implementation.md) — codifies the ADR-precedes-implementation lesson learned during this milestone

## Commits

- `6ead05f` — docs(adr): ADR-013 PMax architecture (initial narrower-scope draft, superseded by this rewrite)
- *(further SHAs added as commits land)*
