# ADR-016: Keywords Conversion Metrics (M7.5)

**Status**: Draft — awaiting approval
**Date**: 2026-05-25
**Phase**: 4.8 M7.5
**Related**: ADR-008 (no silent defaults), ADR-011 (two-query GAQL purchase filter — the foundational pattern, now extended to a 7th sibling at keyword level), ADR-013 (M-PMax — proved the pattern at asset_group level via `fetchPurchaseAssetGroupTotals`), ADR-014 (M8 cache-bump verification), ADR-015 (M7 Keywords — this milestone extends), Memory #28 (cache bump unmasks broken integration pattern), Memory: M5 `fetchAssetUrls` field-name bug (same risk class as the Path A trap rejected here — see Consequences)
**Recon**: [docs/recon/keywords-conversions-recon-2026-05-25.md](../recon/keywords-conversions-recon-2026-05-25.md) (Q1+Q3+Q4+Q5 empirical against imaa)

## Context

M7 (ADR-015) shipped the keywords surface with **cost, clicks, impressions, CTR, Quality Score** per keyword. User feedback during M7 visual verification surfaced the need to also expose **Revenue + Purchases per keyword** — the same conversion-attribution metrics already surfaced at campaign/ad/asset_group levels (~335K SAR / month total visible at campaign level on imaa).

Stage 1 recon revealed a critical correctness finding:

- **Q1 (single-query `FROM keyword_view` with `metrics.conversions` + `metrics.conversions_value`) works on imaa.** Returns real data: top keyword "عطور" shows 50.8 conversions / 12,909 SAR last 30d. All 7 SELECT fields populate cleanly. No GAQL trap, no SDK trap.
- **Q3 revealed why the single-query path is INCORRECT on real-world accounts.** imaa has exactly 1 conversion action (`6649351374`, category=PURCHASE). The single-query path "works" on imaa purely by coincidence — `metrics.conversions` includes ALL configured conversion actions, but imaa only has PURCHASE configured, so the inflation factor is 1.0. On any account with mixed actions (sign-ups + add-to-cart + lead-forms + page-views) `metrics.conversions` would inflate the "Purchases" column by 2-5×. This is the **same correctness risk class as the M5 `fetchAssetUrls` field-name bug** — ships dark, manifests only on accounts that differ from imaa.
- **Q4 + Q5 confirmed imaa is visually verifiable**: 1,031 account-wide conversions / 262,698 SAR last 30d, Brand campaigns show 16-92 conversions each. No "ship dark" concern for the verification round (unlike M5 fetchAssetUrls which had zero RDA ads to confirm against).
- **The 7-merger ADR-011 family pattern is the established correct path.** `fetchPurchaseCampaignTotals` / `fetchPurchaseAdTotals` / `fetchPurchaseAssetGroupTotals` / time-series / etc. all use this two-query approach precisely to avoid the inflation trap. M7.5 adds the 7th sibling at keyword level.

Memory #29: Saudi/Gulf ecommerce persona typically runs 5+ conversion actions (PURCHASE + ADD_TO_CART + INITIATE_CHECKOUT + LEAD_FORM + SIGN_UP). imaa is the outlier (1 action). Shipping Path A would silently misrepresent purchase counts on ~75% of target persona accounts.

Modal layout impact: the existing Search ad `AdDetailModal` is `max-w-2xl` (672px). M7's 7-column keyword table is already tight (keyword text capped at 200px truncate). Adding Revenue + Purchases = 9 columns at ~70px each — too narrow for SAR-formatted currency values. Layout change required.

## Decision

### 1. Path B — ADR-011 family pattern with new `fetchPurchaseKeywordTotals`

Mirrors the existing 7-merger pattern. Two-query GAQL:

**Q1 (already exists)** — `fetchKeywords` in [src/lib/google-ads/keywords.ts](../../src/lib/google-ads/keywords.ts) — unsegmented from `keyword_view`, returns identity + cost/clicks/impressions/CTR/CPC + quality_info per keyword. No conversion fields in this query.

**Q2 (new)** — `fetchPurchaseKeywordTotals` in same file:

```sql
SELECT
  ad_group.id,
  ad_group_criterion.criterion_id,
  segments.conversion_action,
  metrics.conversions,
  metrics.conversions_value
FROM keyword_view
WHERE ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.negative = FALSE
  AND campaign.advertising_channel_type = 'SEARCH'
  AND ad_group.id IN (${adGroupIdsList})
  AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
```

Then in JS: filter to rows where `purchaseActionIds.has(actionId)`, sum into `Map<criterion_id, {purchases, revenue}>`. Merge step in `fetchKeywords` overlays purchases/revenue/hasConversionData onto each `UnifiedAdKeyword`.

**Strict semantic per ADR-011** (carried verbatim from `fetchPurchaseAssetGroupTotals` precedent):
- `purchaseActionIds === null` → returns `null` Map → keyword's `hasConversionData = false`, purchases/revenue = `null`
- `purchaseActionIds.size === 0` → returns `null` Map → same
- Map returned but specific `criterion_id` absent (no segmented rows for that keyword) → `hasConversionData = false`
- Map has entry → `hasConversionData = true` even if purchases=0 (legitimate "tracking configured, 0 purchases")

### 2. Modal layout — Option D: widen + KPI strip

**Widen `AdDetailModal` from `max-w-2xl` (672px) to `max-w-4xl` (896px).** Aligns with existing `PMaxAssetGroupModalContent` width (672px → 896px convergence across both modals). Side-effect: M5/M6/M7/M8 modals all benefit from wider canvas — net visual improvement, no regression.

**Add 2-card KPI strip above the keyword table:**

| Card | Value | Source |
|---|---|---|
| إجمالي المبيعات | Sum of `revenue` across currently-visible keywords (respects active filter+sort, recomputed reactively) | `formatAndConvert(sum, ad.currency, displayCurrency)` |
| إجمالي عمليات الشراء | Sum of `purchases` across currently-visible keywords | `Math.round(sum).toLocaleString("en-US")` |

Cards update dynamically when user changes filter/sort (e.g., filtering to EXACT match-only updates both totals to reflect only EXACT keywords).

If `hasConversionData === false` for the ad_group as a whole, both cards render `—` with the same tooltip as the row-level empty state.

### 3. Sort options expanded to 7

Existing 5 sort options from M7: التكلفة (default) / الانطباعات / النقرات / CTR / Quality Score.

Add 2 new options:
- **مبيعات** (sorts by `revenue` desc — undefined/null sink to bottom per existing pattern)
- **عمليات الشراء** (sorts by `purchases` desc — same null-sink semantic)

Default remains التكلفة. Users explicitly opt into the new sorts.

### 4. Metric choice — `metrics.conversions_value`, NOT `all_conversions_value`

Matches existing `fetchPurchaseAdTotals` / `fetchPurchaseAssetGroupTotals` pattern. `metrics.conversions_value` is the value attributed to user-configured conversion actions that we further filter via `purchaseActionIds`. `metrics.all_conversions_value` includes everything Google tracks including non-conversion-counted actions (view-through conversions, micro-conversions, etc.) — wrong semantic for a "Revenue" column that users will read as "money from real purchases."

### 5. Cache bump v9 → v10

`UnifiedAdKeyword` gains 4 fields: `purchases?: number | null`, `revenue?: number | null`, `roas?: number | null`, `hasConversionData?: boolean`. Cached v9 rows lack these — bump invalidates so all clients fetch fresh data including conversions.

**5th attempted bump under Memory #28 protocol.** Track record: v5→v6 caught Google `invalid_grant`, v6→v7 caught nothing (baseline), v7→v8 caught both M5 + M8 GAQL bugs, v8→v9 caught nothing on M7 (passed clean). v9→v10 will succeed or block ship per same protocol.

Same 6-step verification gate:
1. `npm run check` + `npm run build` clean
2. Local dev server up against production Supabase
3. Force fresh Google fetch — both endpoints `?refresh=true`, both return HTTP 200 `source: "fresh"`
4. Force fresh Meta fetch — both endpoints `?refresh=true`, both return HTTP 200 `source: "fresh"`
5. ANY HTTP 500 / non-fresh response → push BLOCKED
6. All four green → push to feature branch

Plus a dedicated probe script `_verify-m7.5-fetchpurchasekeywordtotals-shape.mjs` mirroring the M7 probe pattern — exercises the new Q2 GAQL shape against imaa before push.

### 6. Commit timing — 3-atomic on `phase-4.8-m7.5` branch

| # | Commit | Files |
|---|---|---|
| 1 | `chore(recon): keywords-conversions recon + probe script` | docs/recon/keywords-conversions-recon-2026-05-25.md, scripts/_keywords-conversions-recon.mjs |
| 2 | `docs(adr): ADR-016 Keywords Conversion Metrics architecture` | docs/decisions/016-keywords-conversion-metrics.md (this file) |
| 3 | `feat(google): M7.5 conversion metrics + modal widening` | src/lib/google-ads/keywords.ts (extended), src/lib/ads/types.ts, src/lib/ads/cache.ts, src/app/dashboard/reports/ReportsClient.tsx |

Matches M7's 3-commit atomic pattern. Single PR; 3-commit history preserves bisect-ability + ADR-precedes-implementation discipline.

### 7. Empty-data rendering — match M-PMax convention

Per the existing pattern in `fetchPurchaseAssetGroupTotals` + the PMax modal:

| State | Render | Tooltip |
|---|---|---|
| `hasConversionData === true` AND `purchases === 0` | `0` and `0 ر.س` | (none — legitimate zero is self-explanatory) |
| `hasConversionData === false` (cache miss / no purchase actions / null Map) | `—` (em-dash) | `لا توجد بيانات تحويل لهذا الحساب` |
| `purchases > 0` | `Math.round(n).toLocaleString("en-US")` and `formatAndConvert(revenue, ...)` | (none) |

KPI strip cards follow same logic: `—` for both if NO keyword in scope has `hasConversionData=true`, otherwise sum of available + skip nulls.

## Consequences

### Positive

- **Correct purchase + revenue attribution at keyword level** across all account configurations (PURCHASE-only like imaa AND mixed-action accounts that match Memory #29's typical Saudi/Gulf persona)
- **7th sibling of the ADR-011 merger family** — architectural consistency. Every conversion surface in the app now uses the same two-query pattern: campaign / ad / asset_group / product_group / shopping_product / time-series / **keyword**. Future readers don't have to wonder "why does keywords work differently?"
- **Modal widening side-effect benefits M5/M6/M7/M8** — every Search ad modal gets 224px more horizontal space. The cramped 7-column M7 table becomes more readable; M5/M6 text content has more breathing room; M8 image grid can show 4 columns comfortably instead of 3 at edge cases. Net visual improvement across 4 prior milestones.
- **Latent bug class avoided** — same vigilance that caught M5 `fetchAssetUrls` mid-M8 verification. Path A would have shipped looking correct on imaa, then drawn user complaints from any production account with mixed conversion actions. Path B prevents this at the architecture stage, not the post-deploy hotfix stage.
- **KPI strip surfaces aggregate at-a-glance** — users see "total revenue from this ad_group's keywords" without scanning the table. Mirrors the at-a-glance pattern of the existing match-type breakdown chart.
- **5th run of Memory #28 protocol** — pattern continues maturing. Two prior catches (v7→v8) validate the discipline; v8→v9 + v9→v10 will further calibrate whether the protocol's blocking gate triggers false-positives over time.
- **Visual verification possible on imaa** — 1,031 account-wide conversions / 262,698 SAR last 30d means every Brand campaign card's keyword section renders real data post-deploy. No M5-style ship-dark concern.

### Negative

- **+130 LOC vs Path A's ~70** — but justified by the correctness gain. Path A is the "fast and incorrect" option; Path B is the "slightly slower and correct" option. The same trade was made 7 times before across the merger family.
- **Cache v9 → v10 invalidation cascade** — same 30-min transition window blast radius as v8 → v9. Every account's next dashboard load triggers fresh fetches. Mitigated by Memory #28 protocol gate.
- **Modal widening visually affects all 4 prior Search modals (M5/M6/M7/M8)** — though net positive per Positive consequences, any user with strong muscle memory for the old `max-w-2xl` modal width will notice. Worth flagging in PR description, not a regression.
- **Sort options grow from 5 to 7** — slightly busier dropdown. Acceptable since the new options are semantically related (cost / clicks / revenue / purchases all measure "performance"). Could be visually grouped with separators in a future polish pass; deferred.
- **`purchaseActionIds` plumbing extends to fetchKeywords** — minor refactor of `FetchKeywordsOptions` to accept `purchaseActionIds: Set<string> | null`. Caller (google.ts adapter) already has this on the adapter instance from ADR-011. One additional prop pass-through.

## Alternatives considered

### Alternative A — Single-query (Path A from recon)

**Rejected.** Same correctness risk class as the M5 `fetchAssetUrls` field-name bug — ships looking correct on imaa, silently inflates "Purchases" counts by 2-5× on the majority of target Saudi/Gulf accounts (per Memory #29 typical persona = 5+ conversion actions). The 7-merger ADR-011 family was specifically established to prevent this; deviating for keywords would create architectural inconsistency for ~120 LOC of savings.

### Alternative B — Modal Option A (widen modal only, no KPI strip)

**Partially adopted.** Widening alone solves the layout problem but loses the at-a-glance aggregate value. Adopted as the minimum-viable scope path if M7.5 needs to be smaller, but recommend Option D as the full ship.

### Alternative C — Modal Option B (horizontal scroll on table)

**Rejected.** UX-poor on desktop. Mobile already scrolls; forcing desktop users to scroll a numeric table horizontally is bad UX for the data-density users this serves.

### Alternative D — Modal Option C (KPI strip only, no widening)

**Rejected.** Doesn't solve the 9-column overflow. KPI strip is additive; widening is necessary. Both required.

### Alternative E — Use `metrics.all_conversions_value` instead of `metrics.conversions_value`

**Rejected.** `all_conversions` includes Google's auto-tracked actions (view-through conversions, page views, etc.) that aren't "purchases" by any user mental model. Surfacing inflated values labeled "Revenue" would confuse advertisers. Existing 7-merger family uses `conversions_value` consistently; M7.5 maintains this.

### Alternative F — Single-commit atomic

**Rejected per ADR-precedes-implementation discipline.** Same rationale as ADR-015 §Alternative F: 3-commit preserves the architectural decision trail (recon evidence → architectural decision → implementation), making `git log` self-documenting and `git bisect` precise.

### Alternative G — Defer to a later milestone

**Rejected.** User explicitly requested as M7.5 immediately after M7 ship visual verification. The data path exists, the recon is done, the pattern is well-trodden (7 sibling implementations to copy from). Deferring would mean re-running the recon later and re-acquiring the context.

## Implementation plan (3 commits on phase-4.8-m7.5, ~185-200 LOC total)

| Commit | File | Change | Est. LOC |
|---|---|---|---|
| 1 | `docs/recon/keywords-conversions-recon-2026-05-25.md` | NEW (already written, untracked) | — |
| 1 | `scripts/_keywords-conversions-recon.mjs` | NEW (already written, untracked) | — |
| 2 | `docs/decisions/016-keywords-conversion-metrics.md` | NEW — this ADR | — |
| 3 | `src/lib/google-ads/keywords.ts` | NEW `fetchPurchaseKeywordTotals(options: {customerId, refreshToken, ..., adGroupIds, dateFrom, dateTo, purchaseActionIds}): Promise<Map<criterionId, {purchases, revenue}> \| null>`. Strict semantic mirrors `fetchPurchaseAssetGroupTotals`. `fetchKeywords` gains the merge step that layers purchases/revenue/hasConversionData onto each keyword. `FetchKeywordsOptions` gains `purchaseActionIds: Set<string> \| null` field. | +110 |
| 3 | `src/lib/ads/types.ts` | Add `purchases?: number \| null`, `revenue?: number \| null`, `roas?: number \| null`, `hasConversionData?: boolean` to `UnifiedAdKeyword`. | +12 |
| 3 | `src/lib/ads/providers/google.ts` | One-line addition: pass `this.purchaseActionIds` into the existing `fetchKeywords` call in `getAds()`. | +3 |
| 3 | `src/lib/ads/cache.ts` | Bump v9 → v10 + history entry. | +10 |
| 3 | `src/app/dashboard/reports/ReportsClient.tsx` | `max-w-2xl` → `max-w-4xl` on `AdDetailModal` shell (1 LOC). New 2-card KPI strip above keyword table (~25 LOC). 2 new `<th>` + 2 new `<td>` columns in keyword table (~30 LOC). Expand sort dropdown to 7 options + add 2 sort cases in the `useMemo` sort logic (~10 LOC). Update `extensionCount` if it needs to include keyword purchases (TBD during impl — likely no change since purchases aren't "extensions"). | +60 |
| **Total commit 3** | | | **~195** |

Plus a temp probe script `scripts/_verify-m7.5-fetchpurchasekeywordtotals-shape.mjs` for the pre-push verification step (NOT committed pre-push, committed as separate `chore(scripts):` after merge per the M7/M8 precedent).

## Verification plan

### Pre-push (Memory #28 protocol — BLOCKING)

1. `npm run check` + `npm run build` clean
2. Run probe script `_verify-m7.5-fetchpurchasekeywordtotals-shape.mjs`:
   - Confirms Q2 GAQL shape returns rows from imaa keyword_view with segments.conversion_action
   - Verifies a sample keyword's filtered purchase count matches Q5 campaign-level expectations
   - Empirical correctness check before push
3. Local dev server up against production Supabase
4. Force fresh Google fetch — both `/api/ads/{insights,creatives}?provider=google&account_id=<imaa>&refresh=true` return HTTP 200 `source: "fresh"`
5. Force fresh Meta fetch — both `?provider=meta&refresh=true` return HTTP 200 `source: "fresh"`
6. ANY HTTP 500 / non-fresh → push BLOCKED
7. All four green + probe success → push to `phase-4.8-m7.5`

### Vercel preview (visual verification)

Open the preview, navigate to `/dashboard/reports` → Google tab → click any RSA card on imaa Brand campaigns. Expect in modal:

- Modal noticeably wider than before (`max-w-4xl` vs `max-w-2xl`)
- New 2-card KPI strip above the keyword table:
  - **إجمالي المبيعات**: real SAR value (e.g., ~22,195 ر.س for Brand-KSA campaign's keywords)
  - **إجمالي عمليات الشراء**: real count (e.g., ~92 for Brand-KSA)
- Keyword table now 9 columns (added Revenue + Purchases between CTR and Quality)
- Top keyword row "عطور": revenue ~12,909 ر.س, purchases ~51
- Sort dropdown shows 7 options including new مبيعات + عمليات الشراء
- Empty-state rendering: any keyword with 0 purchases shows `0` (not `—`); ad_groups with no conversion actions configured would show `—` everywhere (won't occur on imaa)
- Match-type chart + filter dropdowns + pagination toggle: unchanged
- M-PMax modal, M8 image grid, Meta cards: zero regression

### Post-deploy (production)

Hard-refresh `arabiadash.com/dashboard/reports`. Same checks as preview. Cache v9 → v10 transition window ~30 min from merge.

## Open items deferred (NOT in M7.5 scope)

1. **ROAS sort option** — derivable from revenue / cost but adds UI/logic complexity. Defer until user research justifies (M7.6 if requested).
2. **Per-ad_group rollup card vs current per-displayed-keyword sum** — current spec computes KPI cards from `visibleKeywords` (sort/filter aware). Alternative: compute from entire `keywordsRaw` regardless of filter. Defer the decision; ship with sort/filter-aware behavior, evaluate UX after deploy.
3. **Negative keywords integration** — still M9 territory per ADR-015 §Open Items §2. M7.5 strictly extends positive keywords' attribution.
4. **Search terms reporting (`search_term_view`)** — different resource, different scope. M9 or later per ADR-015 §Open Items §3.
5. **Per-keyword `costPerPurchase` metric** — derivable but adds column complexity. Defer; widening modal already adds 2 columns this round.
6. **Memory entry for "single-query trap" recon-discovery pattern** — the discipline of probing single-query first to expose the inflation factor before committing to ADR-011 is worth capturing as a recon pattern. Defer to a separate memory commit; not blocking M7.5.

## Commits

- *(next on this branch)* — `chore(recon): keywords-conversions recon + probe script`
- *(next on this branch)* — `docs(adr): ADR-016 Keywords Conversion Metrics architecture` (this file)
- *(next on this branch)* — `feat(google): M7.5 conversion metrics + modal widening`
