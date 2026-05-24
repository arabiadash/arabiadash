# ADR-013: Performance Max architecture

**Status**: Proposed
**Date**: 2026-05-24
**Phase**: 4.8 M-PMax
**Related**: ADR-008 (data hygiene + metadata pattern), ADR-011 (two-query GAQL pattern), ADR-012 (Google asset extensions architecture), Memory #27 (CORE PRINCIPLE — build for long-term best-fit), Memory #29 (design for thousands of future Saudi/Gulf ecommerce, not current accounts), Memory #10 (unified architecture across providers)

## Context

Performance Max campaigns differ structurally from every prior Google milestone (M4 campaigns, M5 text ads, M6 asset extensions). PMax has no `ad_group_ad`, no `ad_group_ad_asset_view` — the existing 5-pass `getAds()` flow returns ZERO rows for PMax campaigns. PMax uses `asset_group` as the row-level entity and `asset_group_asset` for assets within each group.

Stage 3 recon ([pmax-recon-stage-2-3-2026-05-24.md](../recon/pmax-recon-stage-2-3-2026-05-24.md)) against the imaa account also surfaced a new SDK constraint: `asset_group_asset.performance_label` is rejected at runtime despite being documented in Google Ads v18+. This is the third instance of the "SDK field index ≠ runtime queryability" trap (M5 = `image_ad.image_asset`, M6 = `sitelink_asset.description1/2/final_urls`, M-PMax = `performance_label`).

The governing principle (Memory #27) requires building for thousands of future Saudi/Gulf ecommerce clients (TikTok / Snap / Salla / Zid in Phases 7-9), not optimizing for current imaa-specific quirks. Every decision below is checked against this principle explicitly.

## Decisions

### 1. Scope: asset-level only (standard + retail PMax) for M-PMax v1

In scope: `asset_group` queries (metrics, `ad_strength`, `primary_status`), `asset_group_asset` queries (asset breakdown without `performance_label`), per-asset `primary_status` indicators, two-query purchase pattern at asset_group level, JSONB `type_data` hybrid type, cache schema bump v3 → v4.

Out of scope (deferred to M-PMax-Retail milestone): `asset_group_product_group_view`, `shopping_performance_view`, `shopping_product`, `asset_group_listing_filter`, `asset_group_top_combination_view`, `performance_max_placement_view`.

**Rationale:** asset-level surface works for BOTH standard and retail PMax accounts. Retail-specific surfaces are product-feed-driven and need Merchant Center scope token + different data model. Bundling them into M-PMax v1 would inflate scope and risk M5-class regressions. Per the governing principle, this is NOT a shortcut — it's a deliberate scope boundary because mixing them creates more future double-work than splitting them. Both milestones get properly designed; one ships first.

**Principle check:** ✓ — scope split serves long-term clarity; not optimizing-for-now at long-term-cost.

### 2. Row granularity: row-per-asset-group

Backend `getAssetGroups(range)` method returns `UnifiedAd[]` discriminated-union rows where each `asset_group` becomes one row with `ad_type: 'PMAX_ASSET_GROUP'`. Frontend can group visually by campaign but the row-level entity stays asset_group.

**Options considered:**
- (A) row-per-asset-group — each asset_group as one row with its own metrics
- (B) row-per-campaign + nested asset_groups — one row per PMax campaign, drill-down
- (C) hybrid: row-per-asset-group at backend, UI groups visually

**Decision: (C) — backend row-per-asset-group, frontend renders grouped.**

**Rationale:** asset_group IS the creative unit in PMax's mental model (matches Google Ads UI). Stage 3 Q2/Q4 confirmed `asset_group` is fully metricized (per-asset_group spend / clicks / conversions available). Symmetric with M5 RSA-per-row. Per Memory #5 (creative-level analysis = highest-value feature), this is the right row-level entity.

**Principle check:** ✓ — sets correct granularity for future analytics features (per-asset_group A/B comparison, asset_group lifecycle tracking, etc.).

### 3. Per-asset visual indicator: ad_strength + primary_status (performance_label DEFERRED to v2)

**Asset-group-level visual:** colored `ad_strength` badge

| ad_strength | Color | Meaning |
|---|---|---|
| `EXCELLENT` | green | Best — all asset types fully covered |
| `GOOD` | blue | Strong — most asset types covered |
| `AVERAGE` | yellow | Acceptable — some gaps |
| `POOR` | red | Needs attention — significant gaps |
| `NO_ADS` | gray with `!` | No active assets |

**Per-asset visual:** `asset_group_asset.primary_status` indicator (ENABLED/PAUSED). Implementation-verify in M-PMax v1; falls back to omitted badge if SDK also rejects this field.

**Deferred to M-PMax v2:** `asset_group_asset.performance_label` per-asset categorical badge (BEST / GOOD / LOW / LEARNING / PENDING). Will be added when the SDK supports it. JSONB `type_data` shape absorbs the future addition with zero migration.

**Options considered:**
- (a) Show `performance_label` as colored badge — ORIGINAL PLAN, blocked by SDK
- (b) Hide per-asset metrics entirely for PMax — show only at asset_group level
- (c) Show `ad_strength` at asset_group + `primary_status` at per-asset (LOCKED)

**Decision: (c) — ad_strength badge per asset_group + primary_status indicator per asset.**

**Rationale:** Stage 3 Q3 confirmed `performance_label` is rejected at runtime. Per the governing principle, don't block on SDK upgrade investigation (scope creep + production risk). `ad_strength` is the most user-meaningful health signal at the asset_group level (matches Google Ads UI's primary indicator). `primary_status` is sufficient per-asset signal to indicate "currently active" vs "paused". Future v2 enhancement (performance_label) slots in without breaking existing v1 UI — the per-asset card slot already exists, badge just changes from primary_status-only to primary_status + performance_label combo.

**Principle check:** ✓ — works with current SDK, designs for the dense case, gracefully handles sparse retail imaa case. v2 enhancement plan is documented (not lost).

**Implementation note:** SDK returns `ad_strength` as INTEGER (Stage 3: `ad_strength=5`). Must define `AD_STRENGTH_MAP` constant in PMax module (per Memory trap #22 / `CUSTOMER_STATUS_MAP` precedent): `{2: 'NO_ADS', 3: 'POOR', 4: 'AVERAGE', 5: 'GOOD', 6: 'EXCELLENT'}`. Implement in commit 4.

### 4. Component architecture: Option C (new files for new code, leave proven code alone)

**Decision:** Create new files in `src/components/creatives/` for M-PMax UI:
- `src/components/creatives/PMaxAssetGroupCard.tsx` (new)
- `src/components/creatives/PMaxAssetGroupModal.tsx` (new)
- `src/components/creatives/shared/` — helpers module extracting ONLY the helpers PMax needs (`formatAndConvert`, `getROASColor`, `STATUS_COLORS`, etc.) into reusable imports

**Leave untouched:** existing M5/M6 inline code in `ReportsClient.tsx`. Migration of inline → extracted is a separate future task (Memory #30 design pass, OR explicit follow-up after M-PMax ships and the pattern is proven).

**Options considered:**

**Option A — Stay inline, defer extraction (status quo)**
- Pro: zero additional work; lowest M-PMax risk
- Con: each new ad type (TikTok / Snap / Salla / Zid) adds inline code; ReportsClient → 5000-line refactor target by Phase 9
- **Principle check:** ✗ — shortcut that compounds future double-work

**Option B — Extract all inline renderers NOW as part of M-PMax**
- Pro: cleanest end-state; sets pattern for all future ad types
- Pro: most aligned with principle if executed carefully
- Con: ~3-4 hours additional work; touches M5/M6 tested production code
- Con: refactor risk to M5/M6 (mitigated by TypeScript + `npm run check`, but non-zero)
- **Principle check:** ✓ but with execution risk

**Option C — Establish pattern with new files only; leave existing inline as-is**
- Pro: sets the pattern; near-zero M5/M6 regression risk; ~1-2 hours additional work
- Pro: future TikTok/Snap follow established pattern from day one
- Pro: Memory #30 design pass becomes a focused "migrate inline → extracted" task, not an ever-expanding refactor
- Con: codebase temporarily inconsistent (some inline, some extracted) during transition
- **Principle check:** ✓✓ — best long-term-fit; neither shortcut new code nor preemptively refactor proven code

**Decision: Option C — LOCKED.**

**Rationale:** the principle prohibits shortcuts that create future double-work but also implies not preemptively refactoring proven code without strong reason. Option C threads the needle: new code is built right (establishes pattern), proven code is left alone (no regression risk), Memory #30 design pass has a clearly-scoped follow-up task.

### 5. Cache shape: JSONB `type_data` hybrid (discriminated union)

**Decision:** `UnifiedAd` becomes a discriminated union with `ad_type` literal as discriminator + common metrics as proper fields + variant-specific data in `type_data` JSONB-shaped object.

**Common fields** (present on EVERY variant):
- Identity: `id`, `account_id`, `ad_type` (discriminator), `status`, `currency`
- Hierarchy: `campaignId?`, `campaignName?`
- Performance metrics (uniform across all ad types): `impressions`, `clicks`, `spend`, `conversions`, `conversions_value`, `ctr`, `cpc`

**Variant-specific data** lives in `type_data`:
- `RSA`: `{ headlines, descriptions, finalUrl? }`
- `RDA`: `{ headlines, descriptions, marketingImages? }`
- `IMAGE_AD`: `{ imageUrl? }`
- `META_AD`: `{ imageUrl?, thumbnailUrl?, carouselImages?, catalogProducts?, title?, body?, callToAction?, previewLink? }`
- `PMAX_ASSET_GROUP`: `{ adStrength, primaryStatus, assets: Array<{fieldType, assetType, primaryStatus?, text?, imageUrl?, youtubeVideoId?}> }`
- Future Phase 7+: TikTok / Snap / Salla / Zid each add their own variant

**Storage:** for M-PMax v1, serialized into existing `creatives_cache.data` JSONB (no new `unified_ads` real table). Real-table migration deferred to Phase 9-10 analytics work.

**Cache version:** v3 → v4 in same atomic commit as type change (M5 lesson).

**Options considered:**

**Option A — Add nullable columns per ad type** (rejected)
- Wide table with optional fields for every variant. Worked for M5/M6 ("optional sprawl") but breaks down qualitatively as PMax adds 6+ new fields.
- **Principle check:** ✗ — every new ad type compounds the sprawl

**Option B — Separate `pmax_cache` table** (rejected)
- New table + new GRANT + new RLS + new index + mirror helper functions
- Future ad types each want their own table → table proliferation by Phase 8
- **Principle check:** ✗ — table proliferation creates per-table maintenance overhead forever

**Option C — JSONB `type_data` hybrid (LOCKED)**
- Discriminated union with `ad_type` discriminator + structured common fields + variant `type_data`
- Zero migrations for future ad types
- TypeScript discriminated union narrowing is compile-time enforced
- Aligns with ADR-008 metadata pattern (jsonb for variant-specific, columns for queryable)
- **Principle check:** ✓✓ — best long-term-fit; zero schema sprawl, future-proof for Phases 7-9

**Decision: Option C — LOCKED.**

**Rationale:** the principle explicitly prefers patterns that absorb future variability without requiring rework. JSONB `type_data` does this for Phases 7-9 (TikTok / Snap / Salla / Zid). The pattern is also already proven in this codebase (ADR-008 metadata, `connections.metadata` jsonb column), so the team knows how to work with it.

## Consequences

### Positive

- **Zero migrations for future ad types** (Phases 7-9 = TikTok / Snap / Salla / Zid each add one union variant; no schema changes, no new tables, no new GRANTs)
- **Common metrics stay structurally addressable** — when we later add a real `unified_ads` table for SQL-level analytics (Phase 9-10), the data shape already matches; migration is trivial
- **TypeScript discriminated union narrowing** is compile-time enforced — runtime crash risk on shape mismatches reduces to zero
- **Component extraction pattern established** in `src/components/creatives/` — future TikTok / Snap / Salla / Zid follow the same pattern from day one
- **Cache version bump v3 → v4 atomic bundle** prevents the M5 regression class (separate cache+type ships caused b5e3581 production rollback). Cache invalidation cascade is expected on first deploy; users see one slower fetch per account during transition (~30 min window of higher latency). Acceptable per M5→M6 precedent.
- **Two-query purchase pattern (ADR-011) reused cleanly** at asset_group level — sibling `fetchPurchaseAssetGroupTotals` is a near-mechanical copy of `fetchPurchaseCampaignTotals`
- **Hardened error logging maintained** across all new fetchers (M5 lesson — no silent catches)
- **performance_label deferred to v2 cleanly** — JSONB `type_data` shape absorbs the future addition with zero migration when SDK supports it

### Negative

- **Type refactor touches many files in one atomic commit** — types.ts, cache.ts, providers/google.ts, providers/meta.ts (?), ReportsClient.tsx normalize sites, possibly hooks. Mitigated by M5/M6 lessons (local repro + hardened error logging + verify cache bump end-to-end before push)
- **`ad_type` discriminator must be set on EVERY existing M5/M6 normalize site** — TypeScript compiler enforces this (no consumer that forgets compiles), but it's still ~5-10 sites to update mechanically
- **Codebase temporarily inconsistent** during Option C transition — some renderers inline, some extracted. Acceptable per Memory #30 — inconsistency is directional (new pattern is the target state)
- **performance_label deferred** — users won't see the per-asset BEST/GOOD/LOW signals in v1. Acceptable per principle — `ad_strength` + `primary_status` provides sufficient signal; v2 adds the missing categorical dimension
- **Retail PMax sparse-asset-group edge case** — imaa-style retail accounts may show asset_groups with 0-2 assets (product feed carries most creative). UI must gracefully render this; design for the dense case as primary

## Implementation plan

### Branch

`phase-4.8-m-pmax`

### Atomic commit sequence (8 commits)

Each commit is independently sensible + buildable. Each runs through `npm run check` + `npm run build` + local repro before push.

1. **`docs(adr): ADR-013 PMax architecture`** — this file. Locks the decisions before any code changes. Pure docs, zero risk.

2. **`refactor(types): UnifiedAd discriminated union + cache v4 bump`** — `src/lib/ads/types.ts` rewrites `UnifiedAd` to the discriminated union shape. `src/lib/ads/cache.ts` bumps `CACHE_SCHEMA_VERSION` v3 → v4. Bundled per M5 lesson. Existing M5/M6 normalize sites updated to set `ad_type` literal + restructure into `common + type_data` — TypeScript compiler enforces correctness.

3. **`refactor(components): extract creative helpers to shared module`** — `src/components/creatives/shared/` module created with the helpers PMax needs (`formatAndConvert`, `getROASColor`, `STATUS_COLORS`, etc.). Only NEW imports — existing inline code in `ReportsClient.tsx` continues using its inline versions (no refactor risk). Sets up Option C.

4. **`feat(google-ads): fetchPMaxAssetGroups + asset_group queries`** — new `src/lib/google-ads/pmax.ts` module. Three GAQL queries (campaign filter + asset_group + asset_group_asset). Hardened error logging per M5 lesson. Per-field isolation tested for each new SELECT field.

5. **`feat(google-ads): fetchPurchaseAssetGroupTotals (ADR-011 sibling)`** — new function in google.ts mirroring `fetchPurchaseCampaignTotals` but `FROM asset_group`. Same try/catch + null degradation contract.

6. **`feat(google-ads): integrate PMax into adapter response`** — `google.ts` `getAds` / new `getAssetGroups` method wired. API route returns merged union of M5/M6 + PMax rows.

7. **`feat(reports): PMaxAssetGroupCard + PMaxAssetGroupModal`** — new files in `src/components/creatives/`. Cards integrated into Google tab via discriminated union switch on `ad.ad_type`. Existing M5/M6 inline rendering untouched. **Acceptance:** verify dense-case render via mock data (5+ asset_groups, 15+ assets total). Graceful render confirmed in BOTH sparse (imaa-style 1 group, few assets) and dense states before commit pushed.

8. **`docs: close M-PMax + update CLAUDE.md`** — add M-PMax to completed milestones list. Update CLAUDE.md PMax section. Document `performance_label` v2 enhancement plan. Document M-PMax-Retail as next planned milestone. **Plus** create gh issue with `tech-debt` label: "Migrate M5/M6 inline renderers to extracted components matching M-PMax pattern (post-M-PMax-ship, before TikTok phase)". Prevents permanent inline/extracted inconsistency drift.

### Acceptance criteria

- All 8 commits ship atomically (sequential, each green on its own)
- `npm run check` + `npm run build` pass at every commit
- Local repro against imaa account confirms PMax asset_groups render (with sparse-asset graceful state)
- No regression in M5 (RSA cards still render) or M6 (extensions still display) — verified by visiting Reports → Google tab pre- and post-merge
- Cache v3 → v4 invalidation cascade is expected on first deploy; one slower fetch per account during the transition window. Acceptable per M5→M6 precedent (do not gate ship on this)

### Risks during implementation

| Risk | Mitigation |
|---|---|
| New PMax SELECT fields may have additional SDK rejections (M5+M6+M-PMax trifecta) | Per-field isolation testing — add one field at a time, verify with local query before merging |
| `asset_group_asset.primary_status` may be rejected like `performance_label` | Isolation-test field independently in commit 4. If rejected, omit per-asset status badge entirely. Asset_group level `ad_strength` still shows — graceful degradation |
| Discriminated union refactor cascades wider than expected | Atomic commit 2 catches all sites at compile time; verify with full `npm run check` before push |
| Cache v3 → v4 invalidation cascade may cause brief 30-min thrashing | Acceptable — same as M5→M6 transition; user-visible only as one slower fetch per account |
| Imaa sparse retail PMax may not exercise the dense-case UI | Add hardcoded preview/storybook example for dense case before shipping (5+ asset_groups, 15+ assets each) — verify graceful render in BOTH states |
| Retail PMax asset_groups may surface auto-generated feed assets differently or not at all | Verify against imaa retail PMax in commit 4 local repro. Document findings. If absent, surface only manually-uploaded assets in v1 — acceptable, most user-meaningful |

## Related

- ADR-008 — data hygiene + metadata pattern (jsonb for variant-specific data is the existing pattern)
- ADR-011 — two-query GAQL pattern (sibling reused at asset_group level)
- ADR-012 — Google asset extensions architecture (M6 — per-type query pattern + hardened error logging carry over)
- Memory #27 — CORE PRINCIPLE: build for long-term best-fit, never shortcuts that create future double-work
- Memory #29 — design for thousands of future Saudi/Gulf ecommerce, not current accounts
- Memory #10 — unified architecture across providers (discriminated union extends this principle to ad-types within Google)
- Memory #5 — creative-level analysis = highest-value reporting feature (asset_group IS the PMax creative unit)
- Memory #30 — design pass deferred milestone (this ADR explicitly leaves M5/M6 inline code untouched; design pass migrates them later as a focused task)
- M5 post-mortem `memory/feedback_reproduce_before_reship.md` — local-repro-with-prod-env protocol (mandatory for M-PMax implementation)
- M5+M6 SDK lesson `memory/feedback_google_ads_sdk_field_index.md` — SDK field index ≠ runtime queryability (third instance confirmed in M-PMax Stage 3 with `performance_label`)
