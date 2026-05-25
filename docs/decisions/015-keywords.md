# ADR-015: Keywords on Search ads

**Status**: Draft — awaiting approval
**Date**: 2026-05-26
**Phase**: 4.8 M7
**Related**: ADR-005 (Google integration + multi-currency), ADR-008 (no silent defaults), ADR-011 (two-query GAQL purchase filter pattern), ADR-012 (Asset Extensions — M6, sister Search-side feature with the same `campaign_asset`/`ad_group_ad_asset_view` join discipline), ADR-014 (Image Extensions — M8, structural sibling: strict-ENABLED filter + Memory #28 cache-bump protocol), Memory #28 (cache bump unmasks broken integration pattern), Memory #29 (typical Saudi/Gulf ecommerce persona = PMax + Shopping + RDA + Search ads — keywords directly serve the Search half)
**Recon**: [docs/recon/keywords-recon-2026-05-26.md](../recon/keywords-recon-2026-05-26.md) (Q1-Q6 empirical against imaa)

## Context

Search ads target specific keywords that users type into Google Search. The keyword set lives at the **ad_group level** (one ad_group → N keywords, shared across all ads in that group) and is the primary lever advertisers tune to control which queries trigger their ads. M5+M6+M8 surfaced creative content (headlines, descriptions, sitelinks, callouts, images); M7 surfaces the targeting layer — which keywords each ad serves, with per-keyword performance metrics.

Per Memory #29, the typical Saudi/Gulf ecommerce persona runs Search alongside PMax. Memory #5 places creative-level analysis as the highest-value reporting feature; keyword-level analysis is its companion on the Search side. Without keywords visibility, the user can see "this ad spent 3.6k SAR" but not "this ad spent 3.6k SAR because the keyword 'عطور' got 1,073 clicks" — the second framing is the actionable one for ad budget management.

Stage 1 recon against imaa empirically verified the data shape + uncovered one new SDK trap:

- imaa carries **234 active keywords** across 6 ad_groups on 4 Search campaigns (Q5)
- Top keyword spend: "عطور" at 3,595 SAR / 1,073 clicks / 14,413 impressions / last 30d (Q3b)
- Match-type distribution heavily skewed BROAD (90%) on this account; other accounts will vary
- **12th SDK-vs-runtime trap discovered (Q3a)**: `FROM ad_group_criterion` REJECTS `metrics.*` with `query_error 49` (`could not support requested resources: AD_GROUP_CRITERION`). The correct FROM for per-keyword metrics is **`keyword_view`** — a Google-side view that exposes both `ad_group_criterion.*` identity fields AND metrics via implicit join.
- All 4 `quality_info` subfields are SELECTable, but quality data is **`undefined` on most keywords on imaa** — normal Google behavior for low-traffic keywords that haven't accumulated enough impressions/clicks to compute quality scores.
- Negative keywords: **0 on imaa** — deferring them from M7 v1 costs zero current visibility.
- No new integer-drift instances: `KeywordMatchType` (EXACT=2 / PHRASE=3 / BROAD=4) and `CriterionStatus` (ENABLED=2 / PAUSED=3 / REMOVED=4) follow the standard 2/3/4 pattern. CriterionStatus does NOT have the order-swap quirk that `AssetLinkStatus` has.
- Modal compatibility surprise: the user spec assumed "alongside existing tabs" in `AdDetailModal`, but **Search/Display ads currently render single-section in that modal** — tabs only exist on `PMaxAssetGroupModalContent`. M7 needs a structural decision on tab introduction vs. section extension.

## Decision

### 1. Scope — Option B from the recon: list + filter + sort + match-type breakdown

v1 surfaces per-keyword performance metrics (impressions, clicks, cost_micros, CTR, average_cpc) + identity fields (text, match_type, status) + quality_info (all 4 subfields, render "—" for undefined). UI provides filter dropdowns + sort selector + match-type breakdown chart + scroll/paginated table.

**Out of v1**: conversion metrics per keyword (deferred to M7.5 — needs ADR-011 purchase-merger pattern at keyword level, ~80 LOC + cache implications), negative keywords (zero on imaa, separate scope), search terms (different resource entirely — `search_term_view`).

### 2. Modal layout — Option C: collapsible section, NOT tab refactor

A new collapsible section `الكلمات المفتاحية` is appended to `AdDetailModal`'s existing single-column scroll layout, **below** the M8 image extensions block and **above/below** the existing text extensions block (placement TBD during implementation pass).

**Rationale**:
- PMax modal's tab pattern makes sense because each tab is a **different asset type** (images vs videos vs headlines vs descriptions vs extras) — heterogeneous content with different render shapes.
- Search ads' sections (sitelinks / callouts / structured snippets / images / now keywords) are all **text-based, list-shaped, vertically scrollable content** — homogeneous render shape. Sections in a single scroll read cleanly; forcing them into tabs adds navigation overhead for no comprehension benefit.
- Option B (refactor Search modal into 2 tabs) would create **three different modal UX patterns on the same Reports page** (PMax = 5 tabs, Search = 2 tabs, Display = ? sections). Avoid the divergence.
- The section is collapsible per existing convention (sitelinks/callouts/snippets already render as conditional sections — collapsibility is an enhancement, not a refactor).

### 3. Resource — `keyword_view`, NOT `ad_group_criterion`

**Per recon Q3a: `FROM ad_group_criterion` REJECTS metrics with `query_error 49`.** The query path is:

```sql
SELECT
  ad_group.id,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  ad_group_criterion.status,
  ad_group_criterion.quality_info.quality_score,
  ad_group_criterion.quality_info.creative_quality_score,
  ad_group_criterion.quality_info.post_click_quality_score,
  ad_group_criterion.quality_info.search_predicted_ctr,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.ctr,
  metrics.average_cpc
FROM keyword_view
WHERE ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.negative = FALSE
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
```

`keyword_view` exposes both `ad_group_criterion.*` identity fields AND `metrics.*` via implicit join — no separate query needed for the two-source merge. **12th SDK-vs-runtime trap instance documented** in `feedback_google_ads_sdk_field_index.md` (pattern: "the natural FROM is rejected; use the view resource instead").

### 4. Conversion metrics — DEFERRED to M7.5

v1 surfaces cost / clicks / impressions / CTR / average_cpc only. ROAS / purchases / conversions per keyword would require:
- An ADR-011 sibling purchase merger at keyword level (~80 LOC mirroring `fetchPurchaseAssetGroupTotals`)
- `purchaseActionIds` cache integration
- An additional cache shape change
- Most per-keyword conversion volumes are too low to be statistically meaningful at the keyword level (campaign-level aggregation is usually the right surface for ROAS analysis)

If user research shows demand for per-keyword conversion analysis, M7.5 adds it as a standalone commit reusing the ADR-011 family pattern.

### 5. Status filter — strict `ENABLED` by default, UI toggle for "show all"

Matches M8's locked decision (ADR-014 §Decision 3). UI provides a filter dropdown:

```
نشط فقط (default)   ← strict ENABLED
الكل                ← ENABLED + PAUSED (excludes REMOVED via WHERE)
```

The strict-ENABLED default is enforced at the GAQL WHERE level; the "all" option triggers a re-fetch with `status != 'REMOVED'` instead of `status = 'ENABLED'`. Two separate cached payloads keyed by filter choice.

### 6. Quality info — fetch all 4 subfields, render "—" for undefined

All 4 subfields are SELECTable in v23 per Q2 isolation probe. None populated on imaa's sampled keywords. UI must:
- Render `—` (em-dash) for `undefined` quality_score
- Render `—` for any of the 3 enum subfields when undefined
- Add tooltip: "غير كافي البيانات لحساب جودة الكلمة" (not enough data to compute quality score)
- Sort-by-quality-score puts undefined rows at the bottom (treat as -Infinity for sort)

### 7. Badge Arabic copy

Header text above the keywords list:

```
الكلمات المفتاحية لمجموعة 'Sales-Search | Brand | KSA / Ad group 1' — مشتركة بين 1 إعلان في نفس المجموعة
```

Format: `الكلمات المفتاحية لمجموعة '[campaign.name] / [ad_group.name]' — مشتركة بين [N] إعلان في نفس المجموعة`

The campaign-name prefix disambiguates imaa's "Ad group 1" duplicates (5 of 6 ad_groups share that name). The `N إعلان` count comes from the already-loaded `googleAds` list — no extra GAQL needed; UI counts ads sharing the same `adsetId` (which is the ad_group_id field on UnifiedAdCommon).

### 8. Filter / sort UI controls

Single control row above the keywords table:

| Control | Default | Options |
|---|---|---|
| Sort | التكلفة | التكلفة / الانطباعات / النقرات / CTR / Quality Score |
| Status | نشط فقط | نشط فقط / الكل |
| Match type | الكل | الكل / EXACT / PHRASE / BROAD |

Sort + match-type filters apply client-side (already-loaded array). Status filter triggers a re-fetch (different GAQL payload). Match-type filter uses the integer-mapped string labels from `KeywordMatchType` per recon §4 — no integer drift, so a small static map suffices:

```typescript
// MATCH_TYPE_MAP — verified clean enum via Q1 recon 2026-05-26.
// Standard 2/3/4 = EXACT/PHRASE/BROAD pattern. No suffix walk needed.
// If future Google API version introduces new match types (e.g.,
// NEAR_PHRASE), add to map. Suffix walk discipline not enforced
// here per recon proof.
const MATCH_TYPE_MAP: Record<number, KeywordMatchType> = {
  2: "EXACT",
  3: "PHRASE",
  4: "BROAD",
};
```

A small match-type **breakdown chart** (3 bars: EXACT count + PHRASE count + BROAD count) sits above the controls — visual at-a-glance of targeting mix.

### 9. Pagination — top 50 default, "show all" toggle for larger sets

Default sort: cost desc. Show top 50 rows. If `keywords.length > 50`, render a toggle button: `عرض الكل (N)` — clicking expands to all rows.

imaa's largest ad_group has 126 keywords → toggle WILL surface on imaa, so visual verification can confirm both the default-50 and expanded-126 views work cleanly. No virtualization needed at this scale (CSS `max-height: 60vh` + scroll handles 126 rows).

### 10. Cache bump v8 → v9 + Memory #28 protocol

Adding `keywords?: Array<UnifiedAdKeyword>` to `UnifiedAdCommon` changes the cached row shape. `CACHE_SCHEMA_VERSION` bumps from `"v8"` to `"v9"` in the same atomic commit as the type change.

**Memory #28 pre-push verification protocol is MANDATORY** — same 6-step gate as ADR-014 §Decision 5:

1. `npm run check` + `npm run build` clean
2. Local dev server up against production Supabase
3. `?refresh=true` on Google insights + creatives — both return HTTP 200 `source: "fresh"`
4. `?refresh=true` on Meta insights + creatives — both return HTTP 200 `source: "fresh"`
5. Any failure → push BLOCKED
6. All four green → push

This is the 4th attempted cache-bump with verification gate. Prior 3: v5→v6 (regression, before protocol formalized), v6→v7 (regression, before protocol formalized), v7→v8 (protocol active — caught the M5 fetchAssetUrls bug pre-push).

### 11. Commit timing — atomic, 3 commits on `phase-4.8-m7` branch

| # | Commit | Files |
|---|---|---|
| 1 | `chore(recon): keywords-recon-2026-05-26 + probe script` | docs/recon/keywords-recon-2026-05-26.md, scripts/_keywords-recon.mjs |
| 2 | `docs(adr): ADR-015 Keywords architecture` | docs/decisions/015-keywords.md (this file) |
| 3 | `feat(google): M7 Keywords on Search ads` | src/lib/google-ads/keywords.ts (NEW), src/lib/ads/types.ts, src/lib/ads/providers/google.ts, src/lib/ads/cache.ts, src/app/dashboard/reports/ReportsClient.tsx |

All 3 commits ship via PR to main. Single atomic PR; 3-commit history preserves bisect-ability.

## Consequences

### Positive

- **Per-keyword performance analysis** unlocks the targeting-layer view of Search ads — the actionable companion to M5+M6 creative-level reporting
- Reuses M8's strict-ENABLED filter pattern + Memory #28 verification protocol — no new architectural patterns introduced
- Section pattern (Option C) extends cleanly to future Search-side features (search terms in M7.5+, audience signals, etc.) without forcing tab proliferation
- 12th SDK trap captured for future readers — `feedback_google_ads_sdk_field_index.md` formalizes the "the natural FROM is rejected, use the view" pattern across 6 documented instances now
- v8→v9 will be the 4th attempted cache bump under the Memory #28 verification protocol. Previous attempts: v5→v6 (caught Google `invalid_grant`), v6→v7 (caught nothing — established baseline), v7→v8 (caught both M8 GAQL bug + pre-existing M5 bug, prevented silent regression). v9 bump will succeed or block ship per same protocol.
- Defers conversion metrics cleanly — M7.5 has a clear scope when/if user research justifies it
- Memory #29 persona coverage extends to the Search half (was previously partial: PMax + RDA + creative-level; now adds keywords)

### Negative

- **Cache v8 → v9 invalidation cascade** — every account's next dashboard load triggers fresh fetches (~30 min transition window). Same blast radius as v7 → v8 (M8 + M5 fix). Verification protocol mitigates the regression risk.
- Pagination toggle adds small UX complexity — first time we surface "show all" vs "show top N" in a modal section. Other M5/M6/M8 sections render all-or-nothing; keywords are the first with potential 100+ entries per ad.
- **Quality score sparse on imaa** means visual verification will be muted — most rows show "—" in the quality column. Other accounts will have richer data; imaa is the wrong test bed for the quality-score UI specifically. Worth noting in the PR description so reviewer doesn't expect quality scores everywhere.
- **No conversion metrics per keyword in v1** — some users may expect to see ROAS in a keywords table by default (Google Ads UI does show conversion data in its keyword tables). Mitigation: tooltip on the controls explaining "conversion metrics coming in M7.5" + pointing to the ADR-015 deferral rationale.
- The `M5/M6` modal-render contract slightly expands: the existing "single-column scroll" gets one more conditional section. No structural change.

## Alternatives considered

### Alternative A — Modal Option B (refactor to tabs)

**Rejected.** Would force the Search-side modal into a 2-tab layout, creating 3 different modal UX patterns on the same Reports page (PMax = 5 tabs, Search = 2 tabs, future Display = ?). Section-shaped content reads well in scroll; tabs add navigation overhead for homogeneous text content. Option C preserves the existing pattern and lets future Search-side features (search terms, etc.) extend the same scroll without re-asking the layout question.

### Alternative B — Resource: `FROM ad_group_criterion` for metrics

**Rejected.** Recon Q3a confirmed `query_error 49` rejection. Even if Google adds support in a future API version, switching back later is mechanical (one FROM clause change). Until then, `keyword_view` is the canonical Google-recommended path per the official Criteria Metrics docs.

### Alternative C — Conversion metrics in v1

**Deferred to M7.5.** Two reasons: (1) per-keyword conversion volume is often statistically thin (most keywords convert <5 times/month even on healthy accounts), making the data noisy at the keyword level; (2) the implementation cost is non-trivial (ADR-011 sibling purchase merger + cache integration + ROAS-color UI = ~80 LOC + cache complexity). Defer until user research surfaces concrete demand.

### Alternative D — PAUSED keywords visible by default

**Rejected.** Breaks consistency with M8's strict-ENABLED filter (ADR-014 §Decision 3). Both M7 and M8 use the user-stated principle "currently serving only, not historical" as the default. UI toggle "الكل" lets users opt into PAUSED visibility when needed.

### Alternative E — Skip quality info entirely (since mostly empty on imaa)

**Rejected.** Quality scores are highly valued by experienced Google Ads users — even sparse coverage gives signal where it exists. The fetch cost is zero (one additional SELECT field on an already-issued query); the UI cost is one row + "—" fallback handling. The risk of NOT shipping it is reviewer confusion ("why doesn't the keyword table show quality score? that's a standard column"). Ship with sparse-data tolerance built in.

### Alternative F — Atomic single-commit (recon + ADR + impl all in one)

**Rejected per ADR-precedes-implementation memory.** The 3-commit sequence preserves the architectural decision trail (recon evidence → architecture decision → implementation), making `git log` self-documenting and `git bisect` precise. ~5 additional LOC of git overhead in exchange for permanent provenance.

## Implementation plan (3 commits on phase-4.8-m7, ~200-280 LOC total)

| Commit | File | Change | Est. LOC |
|---|---|---|---|
| 1 | `docs/recon/keywords-recon-2026-05-26.md` | NEW — Stage 1 recon (already written, untracked) | — |
| 1 | `scripts/_keywords-recon.mjs` | NEW — Q1-Q6 probe harness (already written, untracked) | — |
| 2 | `docs/decisions/015-keywords.md` | NEW — this ADR | — |
| 3 | `src/lib/google-ads/keywords.ts` | NEW — `fetchKeywords(options: {customerId, refreshToken, loginCustomerId, adGroupIds, dateFrom, dateTo, statusFilter})` returning `Map<adGroupId, UnifiedAdKeyword[]>`. Hardened error logging per M5+M8 lesson. Dedup at caller via Map key. | +100-120 |
| 3 | `src/lib/ads/types.ts` | NEW `UnifiedAdKeyword` interface + `keywords?: Array<UnifiedAdKeyword>` field on UnifiedAdCommon (Google-only; Meta variants leave undefined). New `KeywordMatchType` string union. | +30 |
| 3 | `src/lib/ads/providers/google.ts` | Wire `fetchKeywords` into existing Promise.all in `getAds()`. Build `adGroupIdsInScope` Set from `activeAds`. Apply per-ad-group keywords via lookup in normalize step. | +25 |
| 3 | `src/lib/ads/cache.ts` | Bump `CACHE_SCHEMA_VERSION` `"v8"` → `"v9"` + history entry citing ADR-015 + Memory #28. | +10 |
| 3 | `src/app/dashboard/reports/ReportsClient.tsx` | NEW collapsible `الكلمات المفتاحية` section in AdDetailModal. Filter/sort controls. Match-type breakdown chart (3 bars). Scroll table with top-50 default + "show all" toggle. Badge with ad_group sharing context. Update `extensionCount` aggregator to include keywords count (or keep keywords separate from the extensions chip — TBD during impl, leaning toward separate since keywords are targeting not creative). | +60-90 |
| **Total** | | | **~225-275** |

## Verification plan

### Pre-push (Memory #28 protocol — BLOCKING)

1. `npm run check` + `npm run build` clean
2. Local dev server up against production Supabase
3. Force fresh Google fetch — both endpoints must return HTTP 200 `source: "fresh"`:
   - `GET /api/ads/insights?provider=google&account_id=<imaa-id>&refresh=true`
   - `GET /api/ads/creatives?provider=google&account_id=<imaa-id>&refresh=true`
4. Force fresh Meta fetch — both endpoints must return HTTP 200 `source: "fresh"`:
   - `GET /api/ads/insights?provider=meta&refresh=true`
   - `GET /api/ads/creatives?provider=meta&refresh=true`
5. ANY HTTP 500 / non-fresh → push BLOCKED
6. All four green → push to feature branch

### Vercel preview (visual verification)

Open the preview, navigate to `/dashboard/reports` → Google tab → click any RSA card on imaa Brand campaigns. Expect in modal:

- New `الكلمات المفتاحية` section below the M8 image grid (or above sitelinks — TBD)
- Header: `الكلمات المفتاحية لمجموعة 'Sales-Search | Brand | KSA / Ad group 1' — مشتركة بين 1 إعلان في نفس المجموعة`
- Match-type breakdown chart: ~90% BROAD bar, ~10% PHRASE bar
- Filter/sort controls row
- Top-50 keyword table (or all if <50). For `IMA-Sales-2kSAR--NDOffer-Oct` ad_group (126 keywords): table shows top 50 with `عرض الكل (126)` toggle
- Top row: "عطور" with cost ~3,595 SAR / 1,073 clicks / 14,413 impressions
- Quality score column: most rows "—" (sparse data on imaa)
- Other ads / Meta cards / PMax modal: zero visual regression

### Post-deploy (production)

Hard-refresh `arabiadash.com/dashboard/reports`. Same checks as preview. Cache v8 → v9 transition window ~30 min from merge — every account's first dashboard load triggers fresh fetch.

## Open items deferred (NOT in M7 scope)

1. **Conversion metrics per keyword (M7.5)** — ROAS / purchases / conversions per keyword. Requires ADR-011 sibling purchase merger + cache integration. ~80 LOC. Track demand via user feedback after M7 ship.
2. **Negative keywords surface** — separate UI section (probably collapsible like positive keywords). imaa has 0 currently; deferred until an account with negative keyword usage connects.
3. **Search terms (`search_term_view`)** — actual queries users typed that triggered ads. Different resource entirely; significant scope (search terms can number in the thousands per account). Likely M8 or later.
4. **Keyword bid adjustments + manual CPC editing** — write-side mutations. Out of scope for the reporting-only product; would require ADR-008 write-mode discussion first.
5. **Per-keyword device/geography segments** — `segments.device`, `segments.geo_target_constant` — too many cells, low signal-to-noise. Defer indefinitely unless user research justifies.
6. **Memory entry for the 12th SDK-vs-runtime trap** — append to `feedback_google_ads_sdk_field_index.md` as instance #6 with the "the natural FROM is rejected, use the view" pattern. To be done as part of the implementation commit (per the M8 pattern where memory updates ship with the implementation, not separately).

## Commits

- *(next on this branch)* — `chore(recon): keywords-recon-2026-05-26 + probe script`
- *(next on this branch)* — `docs(adr): ADR-015 Keywords architecture` (this file)
- *(next on this branch)* — `feat(google): M7 Keywords on Search ads`
