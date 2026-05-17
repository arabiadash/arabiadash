# ADR-005: Google Integration + Multi-Currency Architecture

**Status**: Accepted
**Date**: 2026-05-16
**Related**: ADR-001 (Multi-Workspace Architecture), ADR-002 (Workspace State via URL Params), ADR-003 (Workspace CRUD Design), ADR-004 (Workspace Data Filtering)

## Context

Phase 4.x shipped a Meta-only dashboard with single-account aggregation, USD/SAR
currency conversion, and a hardcoded plan-limit constant. Phase 4.7 M1 wires
**Google Ads** into the same dashboard end-to-end and unblocks the multi-
provider, multi-currency, multi-account future of the product.

Three architectural pressures surfaced during M1 implementation and deserve
locked-in decisions before Phase 4.8 (tabs + expanded metrics) and Phase 4.9
(universal currency) build on top:

1. **Multi-account fan-out.** A single Google connection can resolve to N
   active accounts under one MCC. Meta is single-account. The dashboard needs
   one mental model for both that scales to TikTok (Phase 7), Snapchat
   (Phase 8), and Salla/Zid (Phase 9).
2. **Multi-currency aggregation.** Google sub-accounts can each have a
   different currency (USD, SAR, AED, EGP, …). Meta's account currency was
   previously a global state. Mixing currencies in a sum is meaningless;
   silently dropping non-USD/SAR rows excludes Gulf users from their own data.
3. **Plan limits leakage.** `ACTIVE_ACCOUNTS_LIMIT = 3` was hardcoded in
   `src/lib/plans.ts` and read from two Server Component pages, while the API
   route handler used an existing async `getUserAccountsLimit(userId)` that
   delegated to the same constant. The inconsistency forced a Phase 10 refactor
   that wasn't actually required by the work.

Two pieces of Phase 4.7 scope were explicitly deferred: Reports refactor
(M2) and per-platform tabs + expanded metrics (Phase 4.8). They appear here
as D5/D6 to record *why* they're not in M1.

## Decisions

### D1: Multi-account aggregation via `useProviderInsights` (Option C)

A new generic hook `useProviderInsights<P>` fans out one HTTP request per
account in parallel for a given provider, then merges results client-side
into a single `insights: UnifiedInsight[]` array.

Options considered:

- **Option A — Per-provider hooks** (`useGoogleInsights`, `useTikTokInsights`,
  …). Pattern would have to be re-implemented for every future provider.
- **Option B — Server-side aggregation endpoint** (`/api/ads/insights/all`).
  Single client request, but moves multi-account complexity behind an opaque
  API and forces server-side currency handling before D2/D3 are settled.
  Higher leverage but blocks D2.
- **Option C — Generic client-side fan-out** ← chosen. One hook, one factory,
  one currency policy. Provider becomes a parameter, not a code path.

Why C:

- **Scales unchanged for future providers**. TikTok/Snap will reuse the same
  hook with `provider: "tiktok"` once their adapter lands.
- **`Promise.allSettled`, not `all`**. Partial failure is normal (one Google
  sub-account expired token shouldn't blank the dashboard). Surviving
  accounts return; failed ones drop a per-account error.
- **Skip-in-fetch (Phase 4.3 lesson)**. The skip check lives inside the
  fetch function, not only in the `useEffect`. `refresh()` calls also honor
  it. This was the root cause of the Phase 4.3 leak — applied here from
  day one.

Trade-off: N parallel HTTP requests per provider. Threshold to revisit:
~10 active accounts on a single provider in a single workspace. At that
scale, move to Option B server-side aggregation.

### D2: Row-level currency in `UnifiedInsight` (SC-B)

`UnifiedInsight` gains an **optional** `currency?: Currency` field. Each row
returned from any adapter carries its source currency. Conversion happens at
the aggregation site, not at the adapter or the cache.

Schema choices considered:

- **SC-A — Workspace-level currency**. One currency per workspace; assume
  all rows match. Breaks the first time a workspace has Meta-SAR + Google-AED.
- **SC-B — Optional row-level currency** ← chosen. Self-describing data.
  Optional so cached rows from before C0 keep working (fallback to `"USD"`).
- **SC-C — Separate currency metadata table**. Forces an extra lookup on
  every aggregation. Splits source-of-truth.

Why SC-B:

- **Self-describing.** Aggregation logic doesn't need an external lookup —
  the row tells you its currency.
- **Adapter-owned.** Each provider adapter sets the currency from its
  upstream API response (Meta from `account.currency`, Google from
  `customer.currency_code`). The hook never guesses.
- **Backward-compatible.** Pre-C0 cached rows are `undefined`; the
  aggregator falls back to `"USD"` — identical to the prior global
  `accountCurrency` default. Cache TTL refreshes naturally.

This decision deletes the global `accountCurrency` state from
`DashboardClient`. Each row converts on its own. Currency is no longer a
component-level concern; it's a data field.

### D3: No-blocking currency policy

Aggregation across mixed currencies uses a **partition policy**, not a
drop-or-block policy:

| Row currency | Treatment |
|---|---|
| `USD`, `SAR`, missing | Converted to user's display currency, summed into main total |
| `AED`, `EGP`, `EUR`, anything else | Grouped by currency, surfaced as side-badge "+ N CUR" next to the main number |

ROAS computed only from the supported-currency subset (USD/SAR after
conversion to display currency). Rows in other currencies are excluded
from the ratio because cross-currency ratios are mathematically
meaningless without conversion. The KPI card displays this ROAS value
but omits unsupported-currency badges (badges appear on Spend/Revenue
cards only, not on ROAS card).

Why:

- **Every Gulf user sees their data.** A workspace with a single AED account
  is not invisible — it shows AED side-totals, transparently labeled.
- **Transparent about what was converted.** The badges signal "this number
  excludes X — here's the X". No silent misconversion via hardcoded FX rates.
- **Phase 4.9-ready.** When live FX lands, the side-badges fold into the
  main aggregate without changing the contract. UI components keep working.

The aggregator returns an `isMixed` flag + `unsupportedTotals` array so the
UI renders badges conditionally. The KPI cards in `DashboardClient` consume
this directly.

### D4: Plan limits via async function (Phase 10-ready)

`ACTIVE_ACCOUNTS_LIMIT` constant removed. All three callers (Meta page,
Google page, DELETE handler in `/api/ads/connections/[id]`) route through
the existing `getUserAccountsLimit(userId): Promise<number>` resolver in
`src/lib/plans.ts`.

The function is **async on purpose** — Phase 10 (Billing) will wire it to
read the user's subscription tier from the DB:

```ts
// Phase 10 implementation (planned):
//   SELECT plan_tier FROM subscriptions WHERE user_id = $1
//   Map tier → limit (e.g., Free: 2, Pro: 10, Enterprise: unlimited)
```

Keeping the signature `Promise<number>` today means the wiring lands with
zero call-site changes. The Server Component pages use `await` directly. Pages parallelize the fetch via
`Promise.all` to avoid serial latency.

### D5: Reports Google deferred to M2

Phase 4.7 M1 scope is **Dashboard only**. Reports (`ReportsClient`) retains
its own `accountCurrency` state and Meta-only flow until M2.

Reasoning:
- Atomic deliverable (Dashboard works end-to-end with Google)
- Reports refactor needs Phase 4.8 tabs structure anyway
- Pattern proven in Dashboard before applied to Reports

**Status (May 17): COMPLETE.** Reports KPIs + main chart now aggregate
Meta + Google data via the same row-level currency pattern as the Dashboard.
Campaigns table + Creatives grid remain Meta-only, deferred to Phase 4.8
tabs work per D6. Shipped in commits: 2d8c0c1, 5e1d8e4, aa999a3, b9cd3d2, 6586cb5.

### D6: Tabs + expanded metrics deferred to Phase 4.8

Phase 4.7 M1 = data integration. Phase 4.8 = visualization restructure:

- Per-platform tabs (All / Meta / Google / future)
- Expanded metrics: Impressions, Reach, Clicks, CTR, CPC, CPM (for
  non-ecommerce use cases: lead gen, awareness, traffic)
- Per-platform metric displays
- Conditional Revenue/ROAS based on conversion tracking

Phase 4.7 M1's "الأداء حسب المنصة" chart will likely be replaced or
restructured in 4.8.

## Consequences

### Positive

- **Self-describing data**: Currency travels with the value. No external
  lookup needed for conversion logic.
- **Eliminates global state**: Removed `accountCurrency` from DashboardClient
  (was Meta-only artifact from Phase 4.2).
- **Foundation for future providers**: TikTok (Phase 7), Snapchat (Phase 8),
  Salla/Zid (Phase 9) will use the same `useProviderInsights` hook and
  currency pattern.
- **Plan limits separated from core**: `getUserAccountsLimit()` is the single
  resolver. Phase 10 will swap implementation without touching callers.
- **No user excluded by currency**: Any account currency works; aggregation
  graceful when mixed.
- **Test coverage of patterns**: `Promise.allSettled`, token guards, skip-in-
  fetch — Phase 4.3 lessons applied from the start in Phase 4.7.

### Negative

- **Mixed-currency aggregation incomplete**: Workspaces with AED + SAR show
  Meta total + AED side-badge. Universal conversion deferred to Phase 4.9.
- **Cached rows lack currency**: Rows from before C0 have `currency: undefined`.
  Graceful fallback to `"USD"`. Cache TTL naturally refreshes.
- **Chart bars rendering issue**: "الأداء حسب المنصة" chart shows header but
  no bars despite valid `platformPerformance` array (length=2 with valid Meta
  and Google items, all currencies supported, recharts-bar-rectangle elements
  not rendered in DOM). Tracked separately in issue #11. Investigation
  deferred — likely affected by Phase 4.8 chart restructure regardless.

## Lessons

1. **Currency should travel with data**: Global state for currency was
   appropriate for single-account Meta but broke at multi-account multi-currency.
   Self-describing rows scale.

2. **Generic provider hooks beat provider-specific hooks**: Building
   `useGoogleInsights` would have meant rewriting for TikTok later. Generic
   `useProviderInsights<P>` works for all future providers unchanged.

3. **Limits belong to pricing layer**: Hardcoding `ACTIVE_ACCOUNTS_LIMIT = 3`
   in core would have forced a refactor in Phase 10. The async resolver was
   already there (unused in pages) — the inconsistency was the bug.

4. **Skip checks must be in fetch functions, not just `useEffect`**: Phase 4.3
   `useInsights` retrofit caught this (refresh() bypassed the skip).
   `useProviderInsights` applied the lesson from day one.

5. **Promise.allSettled > Promise.all**: When fetching N parallel resources,
   partial failure is normal. `allSettled` returns surviving results;
   `all` rejects on first failure. For dashboards where partial data is
   better than no data, `allSettled` is the correct choice.

6. **The user's "ليش 7 مش 15" question saved the day**: During Phase 4.7 M1
   testing, the user noticed the connections page showed 15 Google accounts
   (not the expected 7). Investigation revealed a critical Google OAuth
   callback bug (issue #10) where new OAuth runs moved all existing Google
   connections to the current workspace and reset their status to pending.
   Without the user's check, Phase 4.7 M1 would have shipped on a corrupted
   DB state. Manual recovery via SQL restored the state.

## Phase 4.9 Roadmap

Phase 4.9 will universalize currency handling:

- **Live exchange rates API**: Integration with exchangerate-api.com or
  openexchangerates.org. Daily cache in DB. Fallback strategy on API failure.
- **Gulf currencies expansion**: Add AED, KWD, QAR, BHD, OMR to
  `SUPPORTED_CURRENCIES`. Test against actual ad accounts in those currencies.
- **Workspace-level currency setting**: Per-workspace primary currency in
  settings UI. Aggregation converts everything to workspace currency.
- **Putler-model normalization**: User's chosen display currency normalizes
  the entire workspace's data, regardless of source currencies.

Threshold for revisiting server-side aggregation (Option B from D1): if any
production workspace exceeds ~10 active accounts on a single provider, the
parallel HTTP request count becomes problematic. Move aggregation server-side
at that point.

## Competitor Context

Research during planning (Triple Whale, Northbeam, AdAmigo, Putler):

- **Triple Whale**: Supports up to 20 Meta ad accounts on a single dashboard.
  Multi-currency exists but described as "USD-centric" with multi-currency
  operations being a known weakness (Putler competitive review, Dec 2025).
- **Putler**: Handles 36+ currencies natively. User-selected reporting
  currency normalizes everything. Best-in-class for multi-currency in
  e-commerce analytics.
- **AdAmigo.ai**: USD only. Tailored for US advertisers.

ArabiaDash's differentiation opportunity in the Gulf market: Arabic-native
+ Gulf-currency-aware (SAR, AED, KWD, QAR) from day one. Phase 4.7 M1
establishes the foundation; Phase 4.9 delivers the user-facing capability.

## Related

- **ADR-001**: Multi-workspace foundation
- **ADR-002**: URL params for workspace state
- **ADR-003**: Workspace CRUD (soft delete, dedicated edit page)
- **ADR-004**: Workspace data filtering (Phase 4.2 + 4.3)
- **Issue #10**: Google OAuth callback bug (moves connections to current workspace)
- **Issue #11**: Platform performance chart bars not rendering despite valid data
