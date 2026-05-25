# M7.5 Keywords Conversion Metrics — Recon

**Date:** 2026-05-25
**Branch:** main @ `fe0215f` (post-M7 merge)
**Probe script:** [scripts/_keywords-conversions-recon.mjs](../../scripts/_keywords-conversions-recon.mjs) (uncommitted; preserve after recon close)
**Status:** Stage 1 complete — empirical verdict on single-query vs ADR-011 path

---

## 1. Single-query viability (Q1)

`FROM keyword_view` **DOES support direct conversion metrics on imaa.** Real data returned, all 7 SELECTed fields populated, top spenders show meaningful conversion counts + values:

| Keyword | Cost (SAR) | conversions | conversions_value | all_conversions | all_conversions_value |
|---|---:|---:|---:|---:|---:|
| عطور (ad_group A) | 3,627 | 50.82 | 12,909 | 123.79 | 30,565 |
| عطور (ad_group B) | 1,403 | 15.85 | 5,086 | 33.52 | 10,634 |
| عطور (ad_group C) | 1,336 | 11.00 | 4,163 | 24.00 | 9,124 |
| موقع عطور | 1,028 | 22.00 | 6,200 | 51.00 | 13,941 |
| مواقع عطور | 925 | 18.34 | 4,297 | 40.39 | 9,641 |

**Q1 verdict: technically viable as single-query.** The query succeeds, returns real numbers per-keyword, no GAQL trap.

**But this is the wrong question.** Both `metrics.conversions` and `metrics.all_conversions` populate, and they differ by ~2.4× on the top keyword (50.8 vs 123.8). The semantic question is **which one** to surface as "Purchases" — and the answer reveals why the simple path is incorrect on a meaningful subset of accounts.

---

## 2. ADR-011 necessity (Q3) — required for correctness

**Q3 confirmed `segments.conversion_action` IS SELECTable on `keyword_view`** (returns 20 rows). On imaa specifically, **only 1 distinct conversion action exists** (`6649351374`, category=4 = PURCHASE). Lucky alignment: imaa's `metrics.conversions` happens to equal "purchase-categorized conversions" because there are no non-purchase actions to inflate the count.

**But the project already documented this exact trap (ADR-011).** From [src/lib/ads/providers/google.ts L685-700](../../src/lib/ads/providers/google.ts#L685) — the existing `fetchPurchaseAdTotals` does this dance for ad-level conversions:

```sql
SELECT ad_group_ad.ad.id, segments.conversion_action,
       metrics.conversions, metrics.conversions_value
FROM ad_group_ad
WHERE ...
```

Then filters in JS: `if (this.purchaseActionIds.has(actionId)) { ... sum }`. The 7-merger family (`fetchPurchaseCampaignTotals` / `fetchPurchaseAdTotals` / `fetchPurchaseAssetGroupTotals` / time-series / etc.) all use this pattern because **the alternative — trusting `metrics.conversions` directly — produces inflated numbers on any account whose conversion actions include sign-ups, lead forms, add-to-cart, page views, or anything other than PURCHASE/STORE_SALE**.

### On imaa today vs. real Saudi/Gulf ecommerce accounts

- imaa: 1 conversion action, category=PURCHASE → single-query result is correct
- Typical Saudi/Gulf ecommerce: PURCHASE + ADD_TO_CART + INITIATE_CHECKOUT + LEAD_FORM + NEWSLETTER_SIGNUP (5+ actions) → single-query result inflated by 2-5×

This is the **same correctness risk class** as the M5 `fetchAssetUrls` field-name bug — would ship dark and only manifest on accounts that differ from imaa. Caught locally only via someone connecting an account with mixed actions and noticing wrong numbers in the keywords table.

**Path verdict: ADR-011 family pattern is required for correctness even though single-query works on imaa.** Follow the established 7-merger precedent.

---

## 3. imaa data availability (Q4 + Q5) — visually verifiable

| Probe | Result |
|---|---|
| Q4 (account-wide last 30d) | `conversions=1,030.96`, `conversions_value=262,698 SAR`, `all_conversions=2,494` |
| Q5 (Search campaigns top 5) | Real per-campaign conversions: Brand-KSA 92.8 conv / 22,195 SAR, perfumes-KSA 62.3 / 16,386, etc. |

**imaa is fully visually verifiable for M7.5.** Every Brand campaign card's keyword section will show real Revenue + Purchases numbers post-deploy. No "ship dark" concern (unlike M5 fetchAssetUrls where imaa lacked RDA ads).

Q5 also confirms imaa's `metrics.conversions` matches the same data path used by Reports' campaign-level KPIs — so the user's existing "335,142 ر.س" sighting comes from this same conversion data, just aggregated at campaign level. Trust transfers cleanly to the keyword level.

---

## 4. Modal layout impact (Task 4) — layout change required

### Current state (M7 shipped)

- AdDetailModal: `max-w-2xl` (= 672px) — [ReportsClient.tsx L954](../../src/app/dashboard/reports/ReportsClient.tsx#L954)
- Keyword section breaks out via `-mx-4 sm:-mx-6` to use full 672px (~624px content width after padding)
- 7 columns currently: الكلمة | المطابقة | التكلفة | النقرات | الانطباعات | CTR | جودة
- Keyword text column already capped at `max-w-[200px] truncate` — already tight

### Adding +2 columns (Revenue + Purchases) = 9 columns

A 9-column table in ~624px width gives each column ~70px — too narrow for SAR-formatted currency (`84,540 ر.س` needs ~90-100px) and for Arabic header labels. **Horizontal scroll OR layout change required.**

### Options for ADR-016 §Layout decision

| Option | What | Cost | Tradeoff |
|---|---|---|---|
| **A** — Widen modal to `max-w-4xl` (896px) | Match PMax modal width ([L1747](../../src/app/dashboard/reports/ReportsClient.tsx#L1747)) | +1 LOC | Visual change to ALL Search ad modals (M5/M6/M7/M8 all open in this modal); consistency win with PMax |
| **B** — Horizontal scroll on table | Add `overflow-x-auto` to table container | +1 LOC | Cheap but UX-poor; mobile already scrolls but desktop shouldn't have to |
| **C** — KPI strip above table | Aggregate Revenue + Purchases for the whole ad_group as a 2-card strip above the table; keep 7-col detail unchanged | +20 LOC | Sums lose per-keyword granularity unless table also expands; KPI strip alone may not satisfy "Revenue + Purchases per keyword" intent |
| **D** — Combine A + C | Widen modal AND add KPI strip | +25 LOC | Best UX: aggregate visible at-a-glance, per-keyword detail in widened table |

**Recommendation: D.** Widening to `max-w-4xl` is justified by PMax-modal consistency precedent. KPI strip adds at-a-glance value for users who want totals without scanning. Per-keyword Revenue + Purchases columns ship in the widened table.

---

## 5. Implementation scope estimate

| Path | Files | LOC | vs M7 |
|---|---|---|---|
| **A — Single-query (incorrect on multi-action accounts)** | keywords.ts (+30), types.ts (+10), ReportsClient.tsx (+30) | ~70 | smaller |
| **B — ADR-011 family pattern (recommended)** | NEW `fetchPurchaseKeywordTotals` in keywords.ts (+80), keywords.ts merge step (+30), types.ts (+15: purchases/revenue/hasConversionData on UnifiedAdKeyword), google.ts (+10: pass purchaseActionIds), factory.ts (already loads purchaseActionIds for campaigns), cache.ts v9→v10 (+10), ReportsClient.tsx (+30 for cols, +20 for KPI strip + width change), ADR-016 doc | **~195** | comparable to M7 (~370 was M7) |

**Path B detailed file breakdown:**

| File | Change | Est. LOC |
|---|---|---|
| `src/lib/google-ads/keywords.ts` | NEW `fetchPurchaseKeywordTotals(options: {customerId, refreshToken, ..., adGroupIds, dateFrom, dateTo, purchaseActionIds}): Promise<Map<criterionId, {purchases, revenue}> \| null>`. Same shape as `fetchPurchaseAdTotals`. Strict semantic: null when `purchaseActionIds === null \|\| size===0`. Merge step in `fetchKeywords` overlays purchases/revenue/hasConversionData onto each keyword. | +110 |
| `src/lib/ads/types.ts` | Add `purchases?: number \| null`, `revenue?: number \| null`, `roas?: number \| null`, `hasConversionData?: boolean` to `UnifiedAdKeyword`. | +12 |
| `src/lib/ads/providers/google.ts` | Update `FetchKeywordsOptions` call site to pass `purchaseActionIds: this.purchaseActionIds` (already available on adapter from ADR-011). | +3 |
| `src/lib/ads/cache.ts` | Bump v9 → v10 + history entry. | +10 |
| `src/app/dashboard/reports/ReportsClient.tsx` | Modal `max-w-2xl` → `max-w-4xl`. KPI strip above table (2 cards: total Revenue + total Purchases for ad_group). Add Revenue + Purchases columns to table. Update sort options to include revenue + purchases. | +50 |
| `docs/decisions/016-keywords-conversions.md` | NEW ADR | +1 file |
| `docs/recon/keywords-conversions-recon-2026-05-25.md` | This doc (preserve as committed artifact) | (this commit) |
| `scripts/_keywords-conversions-recon.mjs` | Probe (preserve) | (this commit) |
| **Total** | | **~185-200** |

Cache bump v9 → v10 + Memory #28 protocol applies (5th attempted bump). Pre-push verification mandatory.

---

## 6. Open questions for ADR-016 sign-off

1. **Path A vs Path B?** Recommend B (ADR-011 family) for correctness consistency with existing 7-merger pattern. Path A is faster to ship but ships latent bug on multi-action accounts (~75% of typical Saudi/Gulf ecommerce per Memory #29).
2. **Modal layout: Option A/B/C/D?** Recommend D (widen + KPI strip). A alone is the minimum viable path if scope tightness matters. Confirm before drafting.
3. **Sort options expansion?** v1 has sort by: cost / impressions / clicks / CTR / quality. Add: revenue, purchases (defaults to cost)? Or stick with v1 sorts and let users derive ranking visually from the new columns?
4. **`metrics.conversions_value` vs `metrics.all_conversions_value`?** Per Q1, imaa's `conversions_value` is the purchase-only value (correct). But under Path B's filter-by-purchaseActionIds approach, we re-derive value from segmented conversion data — should the merger sum `conversions_value` (purchase-categorized server-side) or `all_conversions_value` (everything, then filter client-side)? Recommend the former; matches existing `fetchPurchaseAdTotals` pattern.
5. **Cache bump v9 → v10?** Recommend yes; new optional fields on `UnifiedAdKeyword` are graceful-degrading but verification protocol prefers explicit bump.
6. **Commit timing?** 3-commit atomic (recon + ADR + impl) per M7 precedent, OR fold recon into ADR commit (since recon is shorter for M7.5 — only 5 probes vs M7's 6)?
7. **Render "—" vs "0" semantics?** For keywords with hasConversionData=true but 0 purchases: render `0 ر.س` (legitimate zero). For hasConversionData=false (purchaseActionIds cache miss): render `—`. Matches M-PMax convention.

---

## Recommendation summary

- **Path B (ADR-011 family)** for correctness
- **Layout Option D** (widen modal + KPI strip) for UX
- **~185-200 LOC total** across 5 source files + 2 docs
- **Cache bump v9 → v10** with Memory #28 protocol (5th attempt)
- **Visually verifiable on imaa** — real conversion data flowing
- **3-commit atomic** on a new `phase-4.8-m7.5` branch

**Status: data complete. Awaiting answers on items 1-7 before drafting ADR-016.**
