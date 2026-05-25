# Keywords Recon — Phase 4.8 M7

**Date:** 2026-05-26
**Branch:** main @ `4bfb020` (post-M8)
**Probe script:** [scripts/_keywords-recon.mjs](../../scripts/_keywords-recon.mjs) (uncommitted; preserve after recon close)
**Status:** Stage 1 complete — locked scope decisions empirically verified

---

## 1. Google API data model

### Keyword identity + targeting

| GAQL field | Type | Notes |
|---|---|---|
| `ad_group_criterion.criterion_id` | int64 | Stable keyword ID |
| `ad_group_criterion.type` | enum | Filter `= 'KEYWORD'` to exclude AGE_RANGE, GENDER, etc. |
| `ad_group_criterion.keyword.text` | string | The actual search term |
| `ad_group_criterion.keyword.match_type` | enum int | EXACT=2, PHRASE=3, BROAD=4 (verified — see §4) |
| `ad_group_criterion.status` | enum int | ENABLED=2, PAUSED=3, REMOVED=4 (standard 2/3/4 pattern) |
| `ad_group_criterion.negative` | bool | TRUE = negative keyword |
| `ad_group_criterion.resource_name` | string | `customers/X/adGroupCriteria/AD_GROUP_ID~CRITERION_ID` (no field_type suffix — can't use suffix walk here) |

### Quality info (all 4 subfields SELECTable in v23)

| GAQL field | Notes |
|---|---|
| `ad_group_criterion.quality_info.quality_score` | 1-10 integer |
| `ad_group_criterion.quality_info.creative_quality_score` | Enum: BELOW_AVERAGE / AVERAGE / ABOVE_AVERAGE |
| `ad_group_criterion.quality_info.post_click_quality_score` | Same enum |
| `ad_group_criterion.quality_info.search_predicted_ctr` | Same enum |

**Q2 finding:** All 4 fields accept the SELECT (no SDK trap). However on imaa **none of the sampled keywords have `quality_info` populated** — field returns `undefined` in the response. This is normal Google behavior: quality scores require sufficient impressions/clicks to compute, and many keywords (especially low-traffic ones) never accumulate enough data. UI must treat missing quality_info as "—" not "0".

### Metrics — MUST use `keyword_view`, not `ad_group_criterion` (12th SDK trap)

**🚩 Q3a trap surfaced** — querying `metrics.*` from `FROM ad_group_criterion` returns `query_error: 49`:

```
Cannot select or filter on the following metrics: 'average_cpc', 'clicks',
'conversions', 'conversions_value', 'cost_micros', 'ctr', 'impressions'
(could not support requested resources: 'AD_GROUP_CRITERION'), since metric
is incompatible with the resource in the FROM clause or other selected
segmenting resources.
```

**Q3b confirmed**: `FROM keyword_view` works cleanly — all 7 metrics return per-keyword. Real imaa data sample:

```
"عطور"          cost=3595.46 SAR  clicks=1073  impressions=14413
"عطور"          cost=1402.80      clicks= 419  impressions= 5146
"عطور"          cost=1336.05      clicks= 291  impressions= 4104
"موقع عطور"     cost=1007.92      clicks= 537  impressions= 3713
"مواقع عطور"    cost= 908.98      clicks= 329  impressions= 3476
```

Note: "عطور" appears 3 times in top 5 — same word, different ad_groups (each ad_group can target the same keyword with different match types). UI must show ad_group context to disambiguate.

**Implication for adapter implementation:** the keyword fetcher MUST query `FROM keyword_view` (NOT `FROM ad_group_criterion`). Pull identity fields and metrics in the same query — `keyword_view` exposes both via implicit join to `ad_group_criterion`.

**12th SDK-vs-runtime trap instance** — to be captured in `feedback_google_ads_sdk_field_index.md`. Pattern: "the natural FROM" (the resource the data conceptually lives on) is rejected; the correct FROM is a different view resource that exposes both identity AND metrics through implicit joins.

### Conversion data handling (ADR-011 alignment)

`metrics.conversions` + `metrics.conversions_value` on `keyword_view` are RAW (all conversion-action types — same caveat as M5/M6 ad-level + M-PMax asset_group). If M7 surfaces ROAS or purchase counts per keyword, it MUST use the two-query ADR-011 pattern with `segments.conversion_action` + `purchaseActionIds` filter.

**Recommendation for v1**: M7 v1 ships with cost / clicks / impressions / CTR / CPC only (no conversion metrics). Conversion data per keyword is a separate scope question — most accounts don't have enough per-keyword conversion volume for the data to be meaningful. Defer purchase-merger for keywords until a concrete use case surfaces.

---

## 2. imaa data probe results

### Q1 — keyword inventory (Search campaigns, ENABLED+PAUSED, non-negative)

```
Total: 200 keywords (Q1 LIMIT cap; actual total per Q5: 234)

Per campaign:
  IMA-Sales-2kSAR--NDOffer-Oct       126 keywords
  Sales-Search | perfumes | KSA       41 keywords
  Search-3                            20 keywords
  Sales-Search | Brand | KSA          13 keywords
```

### Q1 — match type distribution (the breakdown chart visual)

```
BROAD   (integer 4):  180 rows  (90%)
PHRASE  (integer 3):   20 rows  (10%)
EXACT   (integer 2):    0 rows  (0% on imaa; confirmed via Q6 reverse — only 1 EXACT keyword exists across whole account on different filter)
```

**Implication for UI:** imaa's match-type breakdown chart will show a near-100% BROAD bar. Visually anticlimactic on this account. Other accounts will vary. **Recommend rendering the chart anyway** (3 bars, even if 2 are 0) — establishes the pattern for accounts where the distribution is more informative.

### Q1 — status distribution

```
ENABLED (integer 2):  190 rows  (95%)
PAUSED  (integer 3):   10 rows  (5%)
```

Filter for "currently serving" = `status = 'ENABLED'` (per M8 strict-ENABLED precedent in ADR-014 §Decision 3). Whether M7 surfaces PAUSED keywords is a scope question — recommend strict ENABLED v1 (matches M8) with filter toggle for "show paused" as a UI enhancement.

### Q3 — top 5 keywords by cost (last 30 days)

| Keyword | Cost (SAR) | Clicks | Impressions | CPC | CTR |
|---|---:|---:|---:|---:|---:|
| عطور | 3,595.46 | 1,073 | 14,413 | 3.35 | 7.4% |
| عطور | 1,402.80 | 419 | 5,146 | 3.35 | 8.1% |
| عطور | 1,336.05 | 291 | 4,104 | 4.59 | 7.1% |
| موقع عطور | 1,007.92 | 537 | 3,713 | 1.88 | 14.5% |
| مواقع عطور | 908.98 | 329 | 3,476 | 2.76 | 9.5% |

Real, meaningful data — top keyword spent 3.6k SAR with 7.4% CTR.

### Q4 — negative keywords: 0 rows

Confirms locked scope decision: **negative keywords deferred from M7 v1**. imaa has zero negative keywords on Search campaigns, so deferring them costs nothing in current imaa visibility. Other accounts may have them; future M7.5 or M11 can address.

### Q5 — per-ad_group keyword distribution

```
ad_group "Ad group 1"                          126 keywords (largest)
ad_group "Ad group 1"                           51 keywords
ad_group "المجموعة الإعلانية رقم 1"             20 keywords
ad_group "Ad group 1"                           13 keywords
ad_group "Ad group 1"                           12 keywords
ad_group "Ad group 1"                           12 keywords

Stats: min=12 max=126 across 6 ad_groups, 234 total active keywords
```

**Implication for UI table sizing:** largest ad_group is 126 keywords. A simple scroll-container with `max-height: 60vh` handles 126 rows without virtualization. **No need for react-window / virtualization for v1.** Pagination at 50 rows would be cleaner UX — recommend "show all / show top 50" toggle.

Note: 5 of 6 ad_groups are named "Ad group 1" — imaa never renamed them. UI label "Keywords for ad group 'Ad group 1' (shared with N ads)" will be repetitive across cards. Consider showing campaign name + ad_group name together in the badge: "Keywords for [Campaign Name] / [Ad group name]".

---

## 3. Modal compatibility — STRUCTURAL FINDING

**The user's spec assumes "alongside existing tabs" but Search/Display ads currently have NO tabs.**

- **PMax modal** ([ReportsClient.tsx:1482](../../src/app/dashboard/reports/ReportsClient.tsx#L1482)): 5 tabs via `useState<PMaxAssetTabKey>` + button-rendered tab header. Tab keys: `images / videos / headlines / descriptions / extras`. This is the only existing tab pattern in the modal layer.
- **Search/Display modal (`AdDetailModal`)** ([ReportsClient.tsx:803](../../src/app/dashboard/reports/ReportsClient.tsx#L803)): single-section render. Headlines, descriptions, sitelinks, callouts, structured snippets, M8 images — all stack vertically in one column.

**M7 needs a structural decision:**

| Option | What | Cost | Tradeoff |
|---|---|---|---|
| **A** — Conditional tabs (only when keywords exist) | Wrap existing render in "Details" tab; add "الكلمات المفتاحية" tab only for Search ads | ~80 LOC refactor + new tab logic | Tabs only appear on Search ads with keywords; M5/M6/M8 single-section visual breaks for Search users |
| **B** — Always tabs on Search ads | Refactor Search modal into 2 tabs always: "تفاصيل" (existing) + "الكلمات المفتاحية" (new) | ~100 LOC refactor | Consistent UX but changes M5/M6 modal layout for all Search users — visual regression risk |
| **C** — Collapsible section, no tabs | Append "الكلمات المفتاحية" as a new collapsible section below extensions, matching the sitelinks/callouts pattern | ~30 LOC | Smallest delta, no tab pattern introduction. Departs from user's spec but architecturally simplest. |
| **D** — Hybrid: tab system only when both extensions AND keywords exist | Adds tabs conditional on data complexity; simple stack when minimal | ~120 LOC | Inconsistent UX (sometimes tabs, sometimes not). Hard to test. Not recommended. |

**Recommendation: B with care, or C if minimizing risk is priority.**

B aligns with the user's spec ("new tab alongside existing tabs") if we interpret "existing tabs" liberally — refactoring the single-section into a "تفاصيل" tab IS adding the existing content to a tab. The visual change is small (everything moves into a tabbed container), and the new keywords tab gives the prominence the spec implies.

C is the YAGNI choice — appended section, no new pattern, but doesn't deliver the visual prominence keywords deserve as a major data surface.

**Surface this decision back to the user before drafting ADR-015.**

---

## 4. Integer-drift findings

### KeywordMatchType — no drift

| Public docs say | imaa observed | Match |
|---|---|---|
| EXACT = 2 | "EXACT" string filter returned 1 row; integer 2 in 0 of Q1's 200 rows | ✓ Consistent (only 1 EXACT keyword in account) |
| PHRASE = 3 | 20 rows of integer 3 | ✓ Consistent |
| BROAD = 4 | 180 rows of integer 4 | ✓ Consistent |

No drift on KeywordMatchType.

### CriterionStatus — no drift

| Public docs say | imaa observed | Match |
|---|---|---|
| ENABLED = 2 | 190 rows of integer 2 | ✓ Consistent |
| PAUSED = 3 | 10 rows of integer 3 | ✓ Consistent |
| REMOVED = 4 | (excluded by WHERE) | (not tested) |

No drift on CriterionStatus. Standard 2/3/4 pattern. Note this DIFFERS from `AssetLinkStatus` (which is 2/3/4 = ENABLED/REMOVED/PAUSED — REMOVED and PAUSED swapped) — `AssetLinkStatus` is the outlier per ADR-014 / M8 recon, not CriterionStatus.

### CriterionType — not probed directly

Q1 filtered to `type = 'KEYWORD'` (string filter), which Google accepted. Other criterion types (AGE_RANGE / GENDER / DEVICE / etc.) weren't enumerated. Per recon-discipline: do not assume any integer mapping for CriterionType until empirically probed.

### 12th SDK-vs-runtime trap (resource compatibility, not field name)

`FROM ad_group_criterion` rejects `metrics.*` with query_error 49. The "natural FROM" is rejected; the correct FROM is `keyword_view`. To be captured in `feedback_google_ads_sdk_field_index.md` as instance #6 of that pattern (after image_ad.image_asset, sitelink_asset.description, asset_group_asset.performance_label, ad_group_ad_asset_view.status, responsive_search_ad.images, and now this).

---

## 5. Scope refinement recommendations

Based on imaa data shape:

1. **Match-type breakdown chart will be ~90% BROAD on imaa** — pattern works visually but informative payload is low. Other accounts will vary. Ship the chart anyway.
2. **No virtualization needed** — 126 keywords max per ad_group; CSS scroll container is sufficient.
3. **Quality score will frequently be missing** — UI must render "—" for keywords without quality_info, not "0".
4. **Conversion metrics per keyword: defer v1** — ADR-011-style purchase merger would add scope; per-keyword conversion volume is often too low to be useful. Ship cost/clicks/impressions/CTR/CPC only.
5. **PAUSED keywords: defer v1** — match M8's strict ENABLED filter. Add "show paused" toggle as M7.5 enhancement if requested.
6. **Negative keywords: deferred** per spec; imaa has 0 anyway.
7. **The "shared across N ads" badge needs ad_count per ad_group** — fetcher must also resolve the ad-count, or the UI looks up from already-loaded ad list. Recommend UI-side lookup (no extra GAQL needed).
8. **ad_group fetching: dedup by ad_group_id** — multiple ads in the same ad_group share the same keyword set; fetcher should query ONCE per ad_group, not once per ad.

---

## 6. Estimated implementation scope (vs M8)

| File | Change | Est. LOC |
|---|---|---|
| `src/lib/google-ads/keywords.ts` | NEW — `fetchKeywords(adGroupIds, dateFrom, dateTo)` querying `FROM keyword_view` with strict-ENABLED filter. Mirrors `fetchAdExtensions` per-type-fetcher pattern with hardened error logging. Dedup by ad_group_id at caller layer. | +90-110 |
| `src/lib/ads/types.ts` | NEW `UnifiedAdKeyword` shape + `keywords?: Array<UnifiedAdKeyword>` field on UnifiedAdCommon (Google-only). Add `KeywordMatchType` string union. | +25 |
| `src/lib/ads/providers/google.ts` | Wire `fetchKeywords` into the existing Promise.all in `getAds()`. Build `adGroupIdsInScope` map, pass to fetcher. Merge keywords onto each ad via per-ad-group lookup. | +25 |
| `src/lib/ads/cache.ts` | Bump v8 → v9 with history entry. | +10 |
| `src/app/dashboard/reports/ReportsClient.tsx` | UI — depends on §3 decision: Option B = ~100 LOC (tab system + tab content + filter/sort + match-type breakdown + scroll table), Option C = ~50 LOC (collapsible section). | +50-100 |
| `docs/decisions/015-keywords.md` | NEW ADR | +1 file |
| `docs/recon/keywords-recon-2026-05-26.md` | This doc | (already this commit) |
| `scripts/_keywords-recon.mjs` | Recon probe (preserve per precedent) | (already this commit) |

**Total: ~200-280 LOC.** Smaller than M8 (~370 LOC) because no integer-drift defensive scaffolding needed (CriterionStatus / KeywordMatchType verified clean), no nested image-shape complexity, and dedup is structurally simpler than M6+M8's per-type linkage join.

**Cache bump v8 → v9** required because adding `keywords?` to UnifiedAdCommon changes cached row shape. Memory #28 protocol applies: pre-push verification on Google + Meta `?refresh=true` endpoints before any push.

---

## 7. Open questions for ADR-015 sign-off

1. **Modal layout — Option B (tabs) vs Option C (collapsible)?** Recommend B for prominence; recommend C for minimal risk. Surface decision before drafting ADR.
2. **Conversion metrics per keyword?** Defer to v2 (recommended) OR include ADR-011 purchase merger in scope (~80 extra LOC + cache implications).
3. **PAUSED keywords visibility?** Match M8 strict ENABLED v1, add toggle later? Or include from v1?
4. **Quality score fields?** All 4 subfields confirmed selectable but mostly empty on imaa. Include all 4 in the SELECT for forward-compat OR start with just `quality_score` (integer)?
5. **Badge text formatting?** "Keywords for [campaign] / [ad_group] · shared with N ads" — sketch the exact Arabic copy before implementation.
6. **Sort/filter UI in tab content?** Recommend: sort by cost/clicks/CTR (desc default cost), filter by match_type (multi-select chip), filter by keyword text (search box). Confirm scope.
7. **Recon doc + probe script commit timing?** Land both as the M7 atomic commit, OR land them separately as `docs(recon)` + `chore(scripts)` ahead of ADR-015?

**Status: data complete. Awaiting your scope refinement answers before drafting ADR-015.**
