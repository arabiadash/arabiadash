# M9 Search Terms — recon (2026-05-28)

**Mode:** READ-ONLY (5-question probe against imaa via [scripts/_search-terms-recon.mjs](../../scripts/_search-terms-recon.mjs))
**Scope:** Inform ADR-018 (M9 Search Terms architecture). NO code changes.
**Date range probed:** 2026-04-27 → 2026-05-26 (30d, matches imaa active reporting window)
**Account:** imaa perfumes (5473228670, standalone, SAR)

---

## TL;DR

- **No SDK-vs-runtime trap.** Full `search_term_view` SELECT bundle (search_term + status + segments.keyword.* + ad_group.* + campaign.* + metrics.*) works against v23 on first attempt.
- **No integer drift.** `segments.keyword.info.match_type` reuses the standard 2/3/4 = EXACT/PHRASE/BROAD enum (same as M7 keywords). `search_term_view.status` returns 2 = ADDED and 5 = NONE — matches Google's documented SearchTermStatusEnum without surprises.
- **🚨 Composite key REQUIRED.** 401 of 4,539 distinct terms (~9%) appear in >1 ad_group on imaa — significantly worse collision rate than the M7.5 keywords case (~6%). `{adGroupId}|{searchTerm}` key, mirroring the M7.5 hotfix.
- **Path B (ADR-011 merger family) REQUIRED for forward-compat,** identical reasoning to M7.5. Probe found `purchaseActionIds` cache is currently EMPTY for imaa — see §Path A vs Path B for what this means and the side-quest to investigate before M9 ships.
- **Volume sufficient** for post-deploy visual verification: 10,351 total rows / 74 with conversions / 9,844 SAR cost / 187 conversions / ~50K SAR revenue over 30d.
- **Modal integration point identified:** [ReportsClient.tsx line 1527](../../src/app/dashboard/reports/ReportsClient.tsx#L1527) — directly after the M7 keywords section's closing `</div>) }` (line 1525-1526) and before the catalog products block. Same outer wrapper + same KPI-strip pattern + same pagination toggle pattern as M7.5.
- **Estimated scope: ~420 LOC** across 6 files — slightly larger than M7.5's ~340 LOC, mostly due to the additional UI columns (match type indicator + status indicator) and the composite-key merger.

---

## 1. API data model — empirical SDK index (v23)

Source: `node_modules/google-ads-api/build/src/protos/autogen/fields.d.ts`. Confirmed SELECTable in Q1 probe.

```
search_term_view.ad_group         — FK to ad_group resource
search_term_view.campaign         — FK to campaign resource
search_term_view.has_matching_keyword   (boolean — would surface "added as keyword" WITHOUT segments.keyword lookup; not used in Q1)
search_term_view.has_negative_keyword   (boolean)
search_term_view.has_negative_url       (boolean)
search_term_view.headline               (string — likely the ad headline that served)
search_term_view.landing_page           (?)
search_term_view.page_url               (?)
search_term_view.resource_name
search_term_view.search_term            (the actual user query string)
search_term_view.status                 (SearchTermStatusEnum integer)
```

Joinable segments observed working:
```
segments.keyword.ad_group_criterion     — FK to triggering criterion
segments.keyword.info.match_type        — KeywordMatchTypeEnum
segments.keyword.info.text              — keyword text
segments.conversion_action              — for Path B merger
segments.date                           — required for WHERE
```

Joinable metrics observed working: `impressions`, `clicks`, `cost_micros`, `ctr`, `average_cpc`, `conversions`, `conversions_value`.

**Trap check (Memory #5):** all of the above co-select cleanly. No "field exists in SDK index but rejects SELECT" instance. M5 image_ad and M6 sitelink_asset traps don't repeat here.

**FROM clause:** `FROM search_term_view` is the natural resource AND accepts metrics — no "12th SDK trap" where the natural FROM rejects metrics and forces a view-resource fallback (the M7 `ad_group_criterion` → `keyword_view` switch). Single-resource query path.

---

## 2. imaa probe results (Q1–Q5)

### Q1 — Inventory + match type + status distribution

✅ Top 100 by spend returned cleanly. Aggregate: **4,580 SAR / 12,255 imp / 1,871 clk**.

**Per-campaign breakdown (top-100 sample):**

| Campaign | Terms | Cost (SAR) |
|---|---|---|
| Sales-Search Brand KSA | 35 | 2,114 |
| Sales-Search perfumes KSA | 39 | 1,562 |
| Sales-Search Brand UAE | 15 | 582 |
| Sales-Search Brand QATAR | 11 | 320 |

**Match-type enum (raw SDK values, all 100 rows):**

| Raw value | Mapped label | Count | % |
|---|---|---|---|
| 4 | BROAD | 100 | 100% |

→ All top-spend terms triggered on broad-match keywords. Wider sample needed to surface PHRASE (3) + EXACT (2). **Existing MATCH_TYPE_MAP in [keywords.ts:43](../../src/lib/google-ads/keywords.ts#L43) is reusable as-is.**

**Status enum (raw SDK values):**

| Raw value | Documented label | Count | % |
|---|---|---|---|
| 2 | ADDED | 10 | 10% |
| 5 | NONE | 90 | 90% |

→ Matches the documented SearchTermStatusEnum (0=UNSPECIFIED, 1=UNKNOWN, 2=ADDED, 3=EXCLUDED, 4=ADDED_EXCLUDED, 5=NONE). EXCLUDED (3) + UNKNOWN (1) NOT visible in top 100 on imaa — likely surface in larger samples or accounts with active negative lists. **No integer-drift trap on the standard test account.**

Sample top-10 (showing the `ADDED` vs `NONE` distinction):

```
 1. "عطر ايما" status=2(ADDED) match=BROAD kw="عطر ايما" ag=168572351171 cost=285.10 SAR
 2. "عطور"     status=2(ADDED) match=BROAD kw="عطور"     ag=168572351171 cost=279.90 SAR
 4. "ايما"     status=5(NONE)  match=BROAD kw="عطور"     ag=168572351171 cost=131.22 SAR
```

→ ADDED = the term exactly matches an enabled keyword. NONE = the term was matched via broad/phrase expansion of a different keyword (here "عطور" expanded to catch "ايما", "سيرج", "اوسما", etc).

### Q2 — Per-search-term conversion attribution

✅ Conversions return per-term. Top 5 by revenue:

| Term | ad_group | conversions | revenue (SAR) |
|---|---|---|---|
| "ايما" | 193181260309 | 35.33 | 10,245.52 |
| "ايما" | 168572351171 | 41.00 | 9,947.50 |
| "عطر ايما" | 168572351171 | 16.50 | 3,631.97 |
| "imaa" | 193840478855 | 5.35 | 1,848.30 |
| "ايما للعطور" | 168572351171 | 4.67 | 1,143.38 |

→ The brand-name terms drive most revenue (consistent with Brand campaign structure). Multiple ad_groups attribute to the same term ("ايما" appears in 2 different ad_groups with different revenue — the composite-key concern from M7.5 applies here too).

### Q3 — Path A inflation check (single-query vs Path B merger)

⚠️ **Initial finding was a false alarm caused by THIS probe querying the WRONG table name.** Corrected via [scripts/_diagnose-conversion-actions-empty.mjs](../../scripts/_diagnose-conversion-actions-empty.mjs) — the actual table is `google_conversion_actions` (not `conversion_actions`). Re-probed correctly: imaa has **8 cached actions**, **2 of category=PURCHASE** (`6605477912` "Purchases" + `6649351374` "imaa.sa (web) purchase"). Sync ran 2026-05-24T22:25:55Z, ~22s after OAuth callback. Cache is healthy. M7.5 KPI strip in production is unaffected.

Path A (raw segmented sum across 50 rows):
- 170.82 conversions
- 46,708.90 SAR revenue
- 1 distinct action ID observed: `6649351374`

Cross-referencing prior M7.5 recon (2026-05-25): action `6649351374` IS the PURCHASE-categorized action for imaa. So Path A and Path B would produce identical numbers on imaa today. **But the conclusion is identical to M7.5's:** the recommendation is **Path B family merger anyway**, because:

1. imaa is the outlier (1 action) — typical Saudi/Gulf ecommerce accounts run 5+ actions per Memory #29
2. Single-query Path A would silently misattribute on any account with mixed actions
3. Architectural consistency — 7 sibling mergers in the ADR-011 family; M9 is the 8th

**Side-quest RESOLVED 2026-05-28** — cause was (c). The recon probe used `.from("conversion_actions")` but the actual table is `google_conversion_actions` per [conversion-actions.ts:169](../../src/lib/google-ads/conversion-actions.ts#L169). Corrected-name probe found 8 rows (2 PURCHASE) — fully populated. No M-hardening-2 hotfix needed. Memory item filed for future probe authors: **always grep `.from("...")` in the production code path before assuming table names from filename.**

### Q4 — Identity uniqueness (composite-key requirement)

🚨 **COMPOSITE KEY REQUIRED.** Sampled 5,000 rows → 4,539 distinct terms → **401 terms appear in >1 ad_group (~9% collision rate)**. Top 12 colliders ALL span 3 ad_groups each:

```
"assaf"          → 3 ad_groups        "imaa عطور"      → 3 ad_groups
"assaf perfume"  → 3 ad_groups        "imma perfumes"  → 3 ad_groups
"eau de parfum"  → 3 ad_groups        "imma عطر"       → 3 ad_groups
"golden coll."   → 3 ad_groups        "imma عطور"      → 3 ad_groups
"ima perfume"    → 3 ad_groups        "match perfumes" → 3 ad_groups
"imaa"           → 3 ad_groups        "match عطور"     → 3 ad_groups
"imaa perfume"   → 3 ad_groups        "osma"           → 3 ad_groups
...
```

**Memory #28 / feedback_merger_composite_keys lesson applies directly.** Map key MUST be `${adGroupId}|${searchTerm}` (or analogous separator). Keying by `search_term` alone would over-attribute revenue/conversions to the colliding terms by ~3× in the worst case (3 ad_groups summed into 1 term's row).

Note: ~9% collision rate vs M7.5's ~6% — search terms collide MORE than keywords. Defensive coding required, no shortcut.

### Q5 — Volume sanity

| Metric | 30d value |
|---|---|
| Total `search_term_view` rows | 10,351 |
| Distinct search terms | 4,539 |
| Terms with conversions > 0 | 74 |
| Total cost | 9,844.96 SAR |
| Total impressions | 39,905 |
| Total conversions | 187.85 |

✅ Sufficient volume for visual verification on imaa post-deploy. No M5-style "ship dark" risk.

---

## 3. Modal integration assessment

**Insertion point identified:** [ReportsClient.tsx between line 1525 and 1528](../../src/app/dashboard/reports/ReportsClient.tsx#L1525-L1528).

```jsx
1288  {totalKeywordCount > 0 && (
1289    <div className="bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 border-y border-gray-200">
        ... M7 keywords section ...
1525    </div>
1526  )}
1527  {/* ← M9 SEARCH TERMS SECTION SLOTS IN HERE */}
1528  {hasCatalogProducts && catalogProducts && (
```

**Patterns reused from M7.5 keywords section:**

- Outer wrapper: `bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 border-y border-gray-200`
- Header + sharing-context badge: `"كلمات البحث الفعلية ({totalSearchTermsCount})" + "لمجموعة 'X' — مشتركة بين N إعلان"`
- KPI strip: 2-card grid (`grid-cols-2 gap-2`) — إجمالي المبيعات + إجمالي عمليات الشراء
- Sort/filter dropdown patterns
- Pagination toggle: `"عرض الأعلى 50 فقط" / "عرض الكل (N)"`
- Empty-state: ad_groups with no conversion data → "—" with tooltip per ADR-011 convention

**New UI columns specific to M9** (versus M7.5):
- Search term text (truncated to ~200px max-w)
- Match type indicator (small badge: BROAD/PHRASE/EXACT — reuse M7.5's color scheme)
- Status indicator (small badge: ADDED / NONE / EXCLUDED — new color scheme needed)

**Shared state from parent AdDetailModal:**
- `ad` (which carries ad_group_id + parent context)
- `ad.currency` for FX conversion
- `displayCurrency` (user-selected display)
- Date range from parent (already plumbed)

---

## 4. Integer-drift findings

Verified clean for both enums per Q1 probe + cross-reference to existing code:

| Enum | Raw values seen | Mapping | Status |
|---|---|---|---|
| `segments.keyword.info.match_type` | 4 (100%) | 2=EXACT, 3=PHRASE, 4=BROAD | ✅ Reuse [MATCH_TYPE_MAP](../../src/lib/google-ads/keywords.ts#L43) |
| `search_term_view.status` | 2 (10%), 5 (90%) | 0=UNSPECIFIED, 1=UNKNOWN, 2=ADDED, 3=EXCLUDED, 4=ADDED_EXCLUDED, 5=NONE | ✅ Standard enum, no drift |

**No 13th integer-drift instance triggered.** EXCLUDED (3) + UNKNOWN (1) + ADDED_EXCLUDED (4) were not exercised on imaa — a future account with active negative lists may surface them; mapping must include all 6 values defensively per the resource-name-over-integer-enums memory.

---

## 5. Scope refinement recommendations

Based on Q4 + Q3 findings, two architectural commitments **lock in** before ADR-018 drafting:

1. **Composite Map key** is non-negotiable for the purchase merger. Pattern: `${adGroupId}|${normalizedSearchTerm}`. Search terms could theoretically contain pipe characters — use a control-character separator (``) or normalize via `encodeURIComponent` if collisions worry. M7.5 used plain pipe since criterion_id is numeric; for M9 the search_term IS the colliding axis, so the separator matters more.

2. **Path B (ADR-011 family merger) — 8th sibling**: new file `src/lib/google-ads/search-terms.ts` mirrors `keywords.ts` structure including the inline `fetchPurchaseSearchTermTotals` helper. Same `purchaseActionIds: Set<string> | null` plumbing from the factory. Same null/empty/Set semantics.

**Suggested scope-narrowing decisions for the locked spec:**

- **Status filter default:** ADDED + NONE only (exclude EXCLUDED + UNKNOWN). User can opt in to EXCLUDED via "الكل" filter if they want to see what's been kept out. Mirrors M7 keyword status filter convention.
- **EXCLUDED handling:** since EXCLUDED terms have 0 cost (they didn't serve), filtering them out by default is the right UX call. If the user enables "الكل", surface them with a "مستبعد" badge.
- **Match type indicator:** small text badge under each term row, color-coded per existing M7 scheme (EXACT=indigo, PHRASE=blue, BROAD=sky)
- **Pagination size:** 50 (matches M7.5)
- **Sort default:** cost desc (matches M7.5)

---

## 6. Estimated scope vs M7.5 actual

| File | New/Modified | M9 estimate | M7.5 actual |
|---|---|---|---|
| `src/lib/google-ads/search-terms.ts` | NEW | ~120 LOC | (M7.5: keywords.ts +110 fetch + 80 purchase) |
| `src/lib/google-ads/search-terms.ts` (inline `fetchPurchaseSearchTermTotals`) | NEW | ~80 LOC | same — 8th ADR-011 sibling |
| `src/lib/ads/types.ts` (UnifiedAdSearchTerm + types) | MOD | ~30 LOC | M7.5 added ~12 LOC |
| `src/lib/ads/providers/google.ts` (Promise.all addition + normalizeAd merge) | MOD | ~25 LOC | M7.5 added 3 |
| `src/lib/ads/cache.ts` v11→v12 + history | MOD | ~12 LOC | M7.5 same |
| `src/app/dashboard/reports/ReportsClient.tsx` (UI section) | MOD | ~150 LOC | M7.5 added ~60 LOC |
| **Total** | | **~420 LOC** | M7.5 actual: **~340 LOC** |

Why M9 is +80 LOC vs M7.5:
- UI section adds 2 new column types (search term text column + status indicator badge) vs M7.5 which only added 2 KPI cards
- Inline `fetchPurchaseSearchTermTotals` adds ~80 LOC for the merger (M7.5 also added a sibling — even-tradeoff)
- Composite-key complexity slightly higher (search_term may contain control characters)

ADR-018 implementation effort roughly equivalent to M7.5 (~2-3 hours including pre-push verification).

---

## 7. Open questions blocking ADR-018 draft

| # | Question | Recommended answer |
|---|---|---|
| 1 | **Path B (family merger) confirmed required?** | **YES** — same reasoning as M7.5. Path A would inflate on accounts with multiple conversion actions. Architecturally consistent (8th merger sibling). |
| 2 | **Composite-key separator?** | `${adGroupId}${normalizedTerm}` — control-character avoids any theoretical collision with terms containing pipes. Or simpler: `${adGroupId}|||${term}` (triple pipe — search terms don't contain this naturally). |
| 3 | **Cache bump v11 → v12?** | **YES** — UnifiedAd schema gains `searchTerms?: UnifiedAdSearchTerm[]`. Cached v11 rows lack the field; bump invalidates per Memory #28 protocol. |
| 4 | **Status filter default?** | **ADDED + NONE only** (exclude EXCLUDED + UNKNOWN). Opt-in to "الكل" surfaces EXCLUDED with badge. |
| 5 | **Branch name?** | `phase-4.8-m9` matching M7/M7.5 convention |
| 6 | **Memory entry triggers?** | • Possible new memory if M9 surfaces the SearchTermStatusEnum 6-value full set on a future account (defensive enum mapping discipline). • If conversion_actions cache empty turns out to be M-hardening-1 fallout, write a memory on schema-migration cascade effects. |
| 7 | **Conversion_actions cache empty for imaa — block M9 or proceed?** | **RESOLVED 2026-05-28** — false alarm caused by probe-side bug (wrong table name `conversion_actions` vs actual `google_conversion_actions`). Corrected probe shows 8 rows / 2 PURCHASE actions, synced 2026-05-24. No fix needed. M9 ADR drafting unblocked. |
| 8 | **Memory #28 cache-bump verification protocol applies?** | **YES** — Path B merger introduces a new GAQL query against `search_term_view` with new field paths; verify pre-push via the established 6-step protocol. 6th cache bump under this discipline. |
| 9 | **PMax behavior?** | PMax campaigns don't have search terms in this sense (no keyword targeting). `UnifiedAd.searchTerms` should be `undefined` for PMAX_ASSET_GROUP variant — same conditional render as M7 keywords. |
| 10 | **Custom "كلمات البحث الفعلية" empty-state copy?** | "لا توجد كلمات بحث في هذه الفترة" — covers both "no data yet" + "ad has zero spend" cases. |

---

## 8. Recon artifacts preserved

- This doc: `docs/recon/search-terms-recon-2026-05-28.md`
- Probe script: `scripts/_search-terms-recon.mjs` (untracked, NOT to be committed unless user requests disposition-B preservation)

DO NOT draft ADR-018 yet. Awaiting user resolutions on the 10 open questions above before ADR can be drafted.
