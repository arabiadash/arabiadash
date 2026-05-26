# Google Purchases Formatting Audit — M7.5.1 Scope Recon

**Date:** 2026-05-26
**Branch:** main @ `38d6c6b` (post-M7.5 merge)
**Status:** Audit complete — surprisingly short bug surface

---

## 1. Existing helpers inventory (Task 3)

| Helper | Location | Behavior | Status |
|---|---|---|---|
| `formatCurrency` (aliased `formatCurrencyWithSymbol`) | [src/lib/currency.ts:67-73](../../src/lib/currency.ts#L67) | `toLocaleString("en-US", {maximumFractionDigits: 0})` + currency symbol prefix/suffix | **Exported, canonical for currency.** Used in 12+ sites for revenue/spend. |
| `formatAndConvert` | [src/lib/currency.ts](../../src/lib/currency.ts) | `convertCurrency` + `formatCurrency` combined | **Exported, canonical for cross-currency revenue/spend.** M7+M8+M7.5 use it. |
| `convertCurrency` | [src/lib/currency.ts](../../src/lib/currency.ts) | FX conversion, no formatting | Exported, used by aggregation logic. |
| **`fmtCount`** | **[ReportsClient.tsx:1842-1843](../../src/app/dashboard/reports/ReportsClient.tsx#L1842) — LOCAL ARROW FN** | `Math.round(n).toLocaleString("en-US")` | **Local to `PMaxAssetGroupModalContent` function scope.** Used at L1946 + L1960 only. Everyone else inlines `Math.round(n).toLocaleString("en-US")` — **17 inline duplicates** scattered across the file. |
| `formatNumber` / `formatInteger` / `formatCount` (top-level) | (does not exist) | — | **No exported integer-formatting helper exists.** Inline pattern + one local helper is the current state. |

**Inconsistency flagged:** the canonical count-formatting recipe (`Math.round(n).toLocaleString("en-US")`) is implemented as a 1-line local helper in one place and inlined verbatim 17 other times. M7.5.1 should lift `fmtCount` to `src/lib/currency.ts` (or a new `src/lib/format.ts`) as an exported helper for consistency + future-proofing.

---

## 2. CATEGORY A — Confirmed broken raw-decimal renders (HIGH severity)

**Only 2 sites in the whole codebase.** Both render `{ad.purchases}` directly with no rounding, producing user-visible decimals like "400.219743".

| # | File:Line | Variable | Current render | UI context | User impact |
|---|---|---|---|---|---|
| A1 | [src/app/dashboard/reports/ReportsClient.tsx:667](../../src/app/dashboard/reports/ReportsClient.tsx#L667) | `ad.purchases` | `<p>{ad.purchases}</p>` | **Compact CreativeCard** (the small ad cards in the creatives grid — Google Search/Display variants). Label: `المبيعات`. | Every Google ad card in the grid shows decimal purchases ("400.219743" not "400"). High visibility — first thing the user sees when scrolling creatives. |
| A2 | [src/components/creatives/PMaxAssetGroupCard.tsx:232](../../src/components/creatives/PMaxAssetGroupCard.tsx#L232) | `ad.purchases` | `<p>{ad.purchases}</p>` | **Compact PMaxAssetGroupCard** (the small PMax asset_group cards in the creatives grid). Label: `المبيعات`. | Every PMax card in the grid shows decimal purchases. Same visibility class as A1. |

Both are **exact siblings of the L1610 bug** that M7.5 hotfix `0d90f83` fixed (the AdDetailModal ad-level "المبيعات" KPI). Same render pattern, same component family, just at different scope (compact card grid vs expanded modal). The L1610 fix didn't grep for the pattern elsewhere.

**Metric type**: `ad.purchases` is `number | null` from `UnifiedAdCommon.purchases`, populated by `fetchPurchaseAdTotals` (Google) or `getPurchaseCount(insight)` (Meta). On Google ads it's the sum of `metrics.conversions` for purchase-categorized action IDs — Google returns fractional conversions (attribution model). The fractional decimal is mathematically correct but UX-confusing.

**Fix recipe**: `{ad.purchases}` → `{Math.round(ad.purchases).toLocaleString("en-US")}` (or `{fmtCount(ad.purchases)}` if helper is lifted).

---

## 3. CATEGORY B — Already correctly formatted (CONFIRM BASELINE)

Sample of correctly-formatted sites (not exhaustive — 17+ inline `Math.round(...).toLocaleString` calls across the file):

| File:Line | Variable | Helper |
|---|---|---|
| ReportsClient.tsx:1610 | `ad.purchases` (AdDetailModal ad-level KPI) | `Math.round(...).toLocaleString` — M7.5 hotfix `0d90f83` |
| ReportsClient.tsx:1484 | `k.purchases` (keyword table column) | `Math.round(...).toLocaleString` — M7.5 |
| ReportsClient.tsx:1370 | `keywordKpiTotals.purchases` (KPI strip) | `Math.round(...).toLocaleString` — M7.5 |
| ReportsClient.tsx:1946 | `ad.purchases` (PMax modal ad-level KPI) | `fmtCount(ad.purchases!)` — pre-M7 |
| ReportsClient.tsx:3342 | `aggregated.purchases` (top dashboard KPI) | `Math.round(...).toLocaleString` |
| ReportsClient.tsx:3849 | `metaAggregated.purchases` (Meta tab KPI) | `Math.round(...).toLocaleString` |
| ReportsClient.tsx:4079, 4225, 4695 | `insight.purchases` / `row.purchases` (table cells) | `Math.round(...).toLocaleString` |
| ReportsClient.tsx:4434 | `googleAggregated.conversions` | `Math.round(...).toLocaleString` |
| DashboardClient.tsx:529 | `aggregated.purchases` | `Math.round(...).toLocaleString` |
| Currency/revenue sites (many) | `*.revenue` / `*.spend` | `formatCurrencyWithSymbol` / `formatAndConvert` |

**Pattern is well-established.** A1+A2 are the only stragglers.

---

## 4. CATEGORY C — Inconsistency, not bug (LOW severity)

| File:Line | Variable | Issue |
|---|---|---|
| ReportsClient.tsx:4699 | `row.impressions.toLocaleString("en-US")` | Missing `Math.round`. Defensive: `impressions` is always integer from Google API today, so renders correctly. But inconsistent with the established `Math.round(n).toLocaleString` pattern. If a future API change ever returns fractional impressions (unlikely but possible), this would render decimals. |
| ReportsClient.tsx:4702 | `row.clicks.toLocaleString("en-US")` | Same as above for clicks. |

**Not blocking** — these are defensive style fixes, not user-visible bugs today.

---

## 5. Cross-platform observation (Task 4)

**Meta side: NO bug.** Meta `insight.purchases` is always rendered via `Math.round(...).toLocaleString` at all sites checked (L3849, L4079, L4225). The omni_purchase action_type Meta uses is also fractional (Meta has its own attribution model), but the existing code already rounds it consistently.

**M7.5.1 scope is Google-only** in practice. A1 (Google Search/Display compact card) renders for all Google ads regardless of variant. A2 (PMax compact card) is PMax-specific. Both A1+A2 are visible to any user with Google connected.

---

## 6. Recommended canonical helper + rounding strategy

### Helper

Lift `fmtCount` from its current local-arrow-fn home in ReportsClient L1842 to **`src/lib/currency.ts`** as an exported helper:

```typescript
/**
 * Format an integer count with thousand separators. Used for purchase
 * counts, impressions, clicks — anything that should display as a
 * rounded integer.
 *
 * Google Ads (and Meta) return fractional metrics due to attribution
 * models (e.g., 400.219743 conversions, 43.75 attributed purchases).
 * The fractional value is mathematically meaningful but UX-confusing;
 * users expect integer counts.
 *
 * Use formatCurrencyWithSymbol / formatAndConvert for currency values
 * (revenue, spend) — those carry currency symbols and have separate
 * fractional-digit policy.
 */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
```

Alias `fmtCount` retained at the existing local site to avoid breaking the 2 internal usages (or replaced with `formatCount`).

### Rounding strategy

**`Math.round`** (banker's rounding to nearest integer). NOT `Math.floor` (would truncate "0.7 purchases" to "0" — confusing) and NOT `Math.ceil` (would inflate). NOT `.toFixed(0)` either — `.toFixed(0)` returns a STRING and doesn't apply thousand separators automatically; round-then-toLocaleString is the idiomatic combo.

Already established convention across 17+ sites — no architectural question, just apply uniformly.

---

## 7. Scope estimate + fix plan

| Severity | Site count | Fix LOC | Time |
|---|---:|---:|---|
| **CATEGORY A** (raw decimal) | 2 | +2 / -2 | 5 min |
| **CATEGORY C** (defensive style) | 2 | +2 / -2 | 5 min if included |
| **Helper lift to `src/lib/currency.ts`** (recommended) | 1 export + 17 inline replacements | +15 / -17 | 15 min (mechanical sed-style edit) |
| **TOTAL (recommended scope: A + helper lift)** | | **~30 LOC** | **~20 min** |
| Compared to M7 41e885b precedent (formatCurrency + toLocaleString fix) | ~10 LOC | | Same class |

### Recommended commit shape

Two options:

**Option 1 — Minimal (A only)**: 2-line fix at L667 + L232. No helper lift. ~10 LOC commit, low risk.

**Option 2 — Pattern cleanup (A + helper lift)**: Add `formatCount` to currency.ts. Replace A1+A2 + the 17 inline `Math.round(n).toLocaleString` calls + the local `fmtCount` arrow fn with the new helper. ~30 LOC commit, slightly more risk (more files touched) but consolidates the pattern.

**Option 3 — Comprehensive (A + C + helper lift)**: Above + the 2 defensive Math.round additions at L4699/L4702. ~32 LOC.

---

## 8. Open questions for user decisions

1. **Scope: Option 1, 2, or 3?**
   - Option 1 = minimum-viable user-visible fix
   - Option 2 = pattern consolidation (recommended for long-term maintainability)
   - Option 3 = + defensive style fixes (no current user impact)

2. **Helper name & location**: `formatCount` in `src/lib/currency.ts`, OR new `src/lib/format.ts` for all count/number formatting? Currency.ts is named for currency-specific work; adding a non-currency helper there is a slight naming-vs-locality trade-off. Other option: keep `fmtCount` as the name (matches existing local pattern, lower-friction edit).

3. **Cache bump?** This is purely a RENDER-side fix — no cached values change, no shape change, no semantic change. Memory #28 protocol does NOT trigger. **No cache bump needed** unless you want belt-and-suspenders.

4. **Memory entry?** The "formatCount everywhere" lesson is a small pattern-consistency point. Could append to `feedback_existing_code_audit_during_retrofit.md` or create a new `feedback_formatting_helpers.md`. Recommend lightweight: append a paragraph to the existing audit memory rather than create a new file.

5. **Branch name**: M7.5.1 hotfix branch? `phase-4.8-m7.5.1` or just `fix-google-purchases-formatting`? Past pattern is milestone-numbered branches (`phase-4.8-m7`, `phase-4.8-m8`); a `.1` patch number on a numbered milestone has no precedent. Recommend `phase-4.8-m7.5.1` for consistency with M7.5 naming.

6. **PR or direct-to-main?** CLAUDE.md §7 allows direct-to-main for "Hotfixes when main is broken". This is a UX bug, not main-is-broken — recommend feature-branch + PR for review trail, even though scope is tiny.

7. **Memory #28 protocol applies?** No — no cache changes, no GAQL changes, no upstream fetch changes. Pure UI render formatting. The pre-push protocol exists to catch cache-bump regressions; this fix doesn't bump cache.

---

## Recommended path (synthesizing 1-7)

- **Scope: Option 2** — A1+A2 fix + helper lift to canonical location, replace inline duplicates
- **Helper: `formatCount` in `src/lib/currency.ts`** (lower friction than new file; "format with thousand-separators" sits well alongside the other format helpers)
- **No cache bump**
- **Append paragraph to `feedback_existing_code_audit_during_retrofit.md`** (the lesson: when fixing one site of a render bug, grep for the pattern across the codebase before declaring done — M7.5's L1610 fix should have caught L667+L232 simultaneously)
- **Branch: `phase-4.8-m7.5.1`**, feature-branch + PR, no Memory #28 protocol needed

Estimated end-to-end: 1 commit, ~30 LOC, ~20 min code + ~10 min Vercel + verify + merge.

**Standing by for your decisions on items 1-7 before drafting any ADR or starting implementation.** No code touched. No commits. No new files in working tree apart from this recon doc (untracked).
