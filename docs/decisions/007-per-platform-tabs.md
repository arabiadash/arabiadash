# ADR-007: Per-Platform Tabs in Reports

**Status**: Accepted
**Date**: 2026-05-17
**Related**: ADR-005 (Google integration + multi-currency), ADR-006 (OAuth callback semantics)

## Context

After Phase 4.7 M2 shipped Reports with cross-platform KPIs and chart (Meta + Google aggregated), two user-facing problems surfaced:

1. **Semantic mismatch in aggregated metrics** (issue #15). The "purchases" KPI summed Meta e-commerce purchases (132 in test workspace) with Google "conversions" (586,016 — form fills, calls, page views, etc.), inflating the displayed number ~4,440x. Users couldn't tell what they were actually looking at.

2. **No path to per-platform decisions.** The user journey for ArabiaDash's target audience (Saudi/Gulf brand owners) is:
   - "كم بزنسي إجمالاً؟" — quick high-level overview
   - "أي منصة أحسن؟" — platform comparison to decide budget allocation

   M2 served only the first question.

## Decision

**Adopt a hybrid layout**: top section stays cross-platform (matches the "overview" intent), bottom section becomes per-platform tabs (matches the "comparison" intent). Approach explicitly chosen over fully-tabbed (Approach A) after weighing the user journey.

### Layout

```
┌─────────────────────────────────────────────┐
│ Top: Cross-platform KPIs + chart            │  ← Unchanged from M2
│   (with footnote on "مبيعات" KPI for #15)   │
│                                              │
│ ─────────────────────────────────────────  │
│                                              │
│ Outer tabs: [📘 Meta] [🔵 Google]            │  ← New
│                                              │
│   Per-platform mini KPIs (4 cards)         │
│   Per-platform chart (spend/revenue)        │
│                                              │
│   Meta tab:                                 │
│     Inner tabs: [الحملات] [الإبداعات]        │
│                                              │
│   Google tab:                               │
│     Accounts breakdown table                │
│                                              │
└─────────────────────────────────────────────┘
```

### Tab visibility

Outer tabs are conditionally rendered based on workspace connections:
- Meta tab shows when `metaAccountId` is set
- Google tab shows when `googleAccountIds.length > 0`
- Default tab: Meta if available, else Google. If neither, current empty state handles it (outer container doesn't render).

### Per-platform KPIs

Each platform tab has 4 mini KPI cards (smaller than the top section):
- Meta: إنفاق، إيرادات، ROAS، **مبيعات**
- Google: إنفاق، إيرادات، ROAS، **تحويلات**

The label difference for the 4th KPI explicitly addresses #15 — Google's metric is semantically conversions, not purchases.

### Visual hierarchy

Outer tabs use larger, bolder text (`px-5 py-3 text-base font-bold`) than the inner campaigns/creatives tabs (`px-4 py-2.5 text-sm font-medium`). Eyes go to platform selection first, then to type-within-platform.

### Top section footnote

The top "عدد المبيعات" KPI keeps its label but adds an asterisk and footnote: "* يشمل تحويلات Google". This makes the inflated number's meaning explicit without removing it (the AOV calculation in the same section depends on the count).

## Alternatives considered

### Approach A: Tabs everywhere (rejected)

Wrap the entire Reports content in `[All] [Meta] [Google]` tabs, replacing the M2 cross-platform view as the default.

**Rejected because:**
- The user journey starts with "overview", not "platform-specific". Default view should match the dominant question.
- M2 ships a working cross-platform view; demoting it to a sub-tab undoes that value.
- "All" tab carries the #15 misleading number with no natural fix path — same problem, harder to spot.

### Inline duplicate (rejected for KpiCard)

Inline-duplicate the 70-line KPI rendering JSX for each tab.

**Rejected because:** 4 KPI sections (top + Meta + Google + future TikTok/Snap) × 70 lines = 280 lines of repeated code with drift risk. Extracting `<KpiCard />` with a `size` prop (default + mini) is a small upfront cost for guaranteed visual consistency.

### Replace "مبيعات" with "تحويلات" (rejected for top)

Generic-rename the top KPI to "تحويلات".

**Rejected because:** The Meta-only KPI of "purchases" is well-understood in e-commerce. Renaming everywhere loses precision for Meta users who *are* doing e-commerce. The footnote approach keeps the familiar label and adds context.

## Consequences

### Positive

- **User journey alignment.** Overview → platform comparison maps directly to the layout.
- **Reusable KpiCard.** Future platforms (TikTok, Snap, Salla, Zid) just need to add a tab and reuse the component.
- **Accounts breakdown in Google tab.** Enables per-account budget decisions ("هذا الحساب ROAS منخفض، أوقفه") which M2 didn't support.
- **#15 semantically addressed.** Meta tab shows "مبيعات: 132" (real). Google tab shows "تحويلات: 586,016" (proper label). Top KPI keeps combined number with footnote for the user who wants the big picture.

### Negative

- **The top "مبيعات" KPI is still combined.** The footnote is honest but doesn't fix the inflated displayed number. Phase 4.8 M2 (when expanded metrics land) may revisit whether the top section needs to drop this KPI entirely.
- **Two charts per workspace.** Top (combined) + per-platform (in each tab). Slight redundancy on data fetches, but `useProviderInsights` cache is shared.
- **No Google campaigns table.** Google tab has accounts breakdown but no per-campaign drill-down. Deferred to Phase 4.8 M2 or 4.9 — depends on user feedback after M1 ships.

## Future platforms

When TikTok (Phase 7), Snapchat (Phase 8), or Salla/Zid (Phase 9) integrations land, the outer tab pattern extends directly:

1. Add platform's `accountIds` derivation (mirroring `googleAccountIds`)
2. Add `useProviderInsights({ provider: "tiktok", ... })` calls
3. Add platform-specific aggregated useMemos (mirror `googleAggregated`)
4. Add an outer tab button with `[icon] [name]`
5. Add the tab content section with `<KpiCard size="mini" />` cards + chart + platform-specific details

The KpiCard component, chart rendering pattern, and accounts breakdown table all transfer unchanged. Estimated 1-2h per future platform tab.

### Per-account drill-downs require `accountId` stamping

The Google accounts breakdown table introduced in this phase depends on a small enabling change: `UnifiedInsight` gained an optional `accountId?: string` field, and `useProviderInsights` stamps each row with its source account before concatenating responses (commit 5668bea). Without this, multi-account hooks discard the request→row provenance in the merge — making per-account groupings impossible.

This is a direct extension of ADR-005 D2's "data self-describes" principle: just as `currency` travels with each row to enable currency-aware aggregation without external lookup, `accountId` now travels with each row to enable account-aware grouping. Future platforms reusing `useProviderInsights` get this stamping for free; future platforms with their own multi-account hooks must mirror the pattern.

## Related

- **ADR-005 D2**: "Row-level currency" — the data-self-describes principle that the `accountId` stamping extends.
- **ADR-005 D6**: Phase 4.8 deferral note (this ADR closes that deferral).
- **Issue #15**: Google purchases overcounting (addressed semantically).
