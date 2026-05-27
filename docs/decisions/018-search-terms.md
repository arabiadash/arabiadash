# ADR-018: Search Terms View (M9)

**Status**: Draft — awaiting approval
**Date**: 2026-05-28
**Phase**: 4.8 M9
**Related**: ADR-008 (no silent defaults), ADR-011 (two-query GAQL purchase filter — foundational family pattern; M9 adds the 8th sibling), ADR-013 (M-PMax — proved the family at asset_group level), ADR-015 (M7 Keywords — direct UI pattern parent for the rendered table), ADR-016 (M7.5 Keywords Conversion Metrics — direct pattern parent for the conversion-attribution layer; composite-key hotfix precedent), ADR-017 (M-hardening-1 — verified `platform_credentials` read path + reauth UX; M9 builds on that hardened credential layer), Memory: feedback_merger_composite_keys (the M7.5 hotfix lesson, directly applicable here), Memory #28 (cache bump pre-push verification protocol)
**Recon**: [docs/recon/search-terms-recon-2026-05-28.md](../recon/search-terms-recon-2026-05-28.md) (5-question empirical probe against imaa via [scripts/_search-terms-recon.mjs](../../scripts/_search-terms-recon.mjs); Q1-Q5 ran cleanly + diagnosed/dismissed the false-alarm conversion_actions side-quest)

## Context

User feedback after M7.5 ship: keywords table reveals WHICH keywords drive performance, but masks the question "**what did users actually type to trigger these ads?**" Search Terms View answers that question directly — it's the report Google Ads UI itself centers around for keyword optimization workflows (which terms convert vs which to negative-out).

M9 recon (2026-05-28) ran a 5-question empirical probe against imaa's Search campaigns over the last 30 days. Findings establish four architectural commitments before any implementation:

**Finding 1 — Composite Map key is non-negotiable.** Q4 found 401 of 4,539 distinct search terms (**~9% collision rate**) appear in >1 ad_group on imaa. Top 12 colliders all span 3 ad_groups each ("imaa", "imaa perfumes", "ايما للعطور", etc — generic brand terms that any of 3 different Search ad_groups can match). This is a **higher collision rate than M7.5 keywords** (which was ~6% on the same account), so the composite-key requirement is even more load-bearing for M9 than it was for M7.5. The merger Map MUST be keyed by `${adGroupId}${searchTerm}` — keying by `searchTerm` alone would over-attribute revenue/conversions by up to 3× on the colliding rows.

**Finding 2 — Path B (ADR-011 family merger) is required for forward-compat.** Q3 segmented-conversions analysis was inconclusive on imaa specifically (only 1 PURCHASE-categorized action ID present, action `6649351374` — Path A and Path B numerically equivalent on this account), but the inflation risk is identical to M7.5's: a typical Saudi/Gulf ecommerce account per Memory #29 runs 5+ conversion actions (PURCHASE + ADD_TO_CART + INITIATE_CHECKOUT + LEAD_FORM + SIGN_UP). Path A on those accounts would inflate "Purchases" counts by 2-5×. M9 is the 8th sibling in the family — campaign / time-series / ad / asset_group / (product_group + shopping_product removed) / keyword / search_term — architectural consistency demands Path B.

**Finding 3 — No SDK/runtime trap. No integer drift.** Q1 confirmed `FROM search_term_view` accepts the full SELECT bundle (search_term + status + segments.keyword.info.* + ad_group.* + campaign.* + metrics.*) on first attempt. Both enums (`segments.keyword.info.match_type` returning standard 2/3/4 = EXACT/PHRASE/BROAD; `search_term_view.status` returning 2=ADDED and 5=NONE per documented SearchTermStatusEnum) are clean. No "12th SDK trap" where the natural FROM rejects metrics; no 13th integer-drift instance.

**Finding 4 — Volume sufficient for visual verification.** Q5 confirmed imaa has 10,351 search-term rows / 74 with conversions / 9,844 SAR cost / 187 conversions / ~50K SAR revenue over the last 30 days. Visual verification of the rendered section against ground truth will be rich; no M5-style "ship dark" concern.

Two non-goals are explicitly out of scope, captured here so future readers don't wonder why they were deferred:

- **Write-back actions** ("add as keyword" / "add as negative" buttons). These require a new OAuth scope (`https://www.googleapis.com/auth/adwords` already covers it, but mutation methods need explicit user-OAuth-confirmation flow plus Google review). Defer to a hypothetical M9.5 if user demand surfaces.
- **PMax search terms** (resource: `paid_organic_search_term_view`). Different schema, different scope. PMax search-terms surface is a separate feature, not a port of this one.

## Decision

### 1. Path B — ADR-011 family pattern with new `fetchPurchaseSearchTermTotals`

Mirrors the existing 7-merger pattern (8th sibling). Two-query GAQL inside a single helper file:

**Q1 (new)** — `fetchSearchTerms` in `src/lib/google-ads/search-terms.ts` — unsegmented from `search_term_view`, returns identity + cost/clicks/impressions/CTR/CPC per search term, scoped to a set of ad_group IDs. No conversion fields in Q1.

```sql
SELECT
  search_term_view.search_term,
  search_term_view.status,
  segments.keyword.info.text,
  segments.keyword.info.match_type,
  ad_group.id,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.ctr,
  metrics.average_cpc
FROM search_term_view
WHERE ad_group.id IN (${adGroupIdsList})
  AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
  AND campaign.advertising_channel_type = 'SEARCH'
```

Status filter is applied AT THE JS LEVEL after fetch (see Decision §3) — not in the WHERE clause. Rationale: status filter is a per-user UI preference, not a fetch-time concern. Fetching all statuses once + filtering client-side keeps the cache shape stable across status-filter changes (no separate cache entry per status preset).

**Q2 (new)** — `fetchPurchaseSearchTermTotals` in the same file:

```sql
SELECT
  ad_group.id,
  search_term_view.search_term,
  segments.conversion_action,
  metrics.conversions,
  metrics.conversions_value
FROM search_term_view
WHERE ad_group.id IN (${adGroupIdsList})
  AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
  AND campaign.advertising_channel_type = 'SEARCH'
```

Then in JS: filter rows where `purchaseActionIds.has(actionId)`, sum into `Map<compositeKey, {purchases, revenue}>` where `compositeKey = ${adGroupId}${searchTerm}`. The merge step in `fetchSearchTerms` overlays purchases/revenue/hasConversionData onto each `UnifiedAdSearchTerm`.

Strict semantic per ADR-011 (carried verbatim from M7.5 + M-PMax precedent):
- `purchaseActionIds === null` → returns `null` Map → search term's `hasConversionData = false`, purchases/revenue = `null`
- `purchaseActionIds.size === 0` → returns `null` Map → same
- Map returned but specific `compositeKey` absent (no segmented rows for that ad_group/search-term pair) → `hasConversionData = false`
- Map has entry → `hasConversionData = true` even if purchases = 0 (legitimate "tracking configured, 0 purchases from this specific term")

### 2. Composite-key separator: `` (control character, Start-of-Heading byte)

`${adGroupId}${searchTerm}` keys every Map entry. The recon Q4 verified 9% of imaa's search terms collide across ad_groups, so keying by `search_term` alone would silently over-attribute conversions.

**Why a control character instead of the M7.5 `|`?** Search terms are arbitrary user-typed strings (Arabic, English, transliteration, symbols, emoji). They CAN contain pipes (`|`), question marks, even null bytes. Control byte `` (SOH) is reserved in Unicode for "Start of Heading" — it has no legitimate use in user-typed search queries and is therefore guaranteed not to collide with content. The separator is invisible in console output but visible as the literal byte if you ever need to debug-print a Map key.

M7.5 used `|` because criterion_id is numeric and can't contain pipes. M9 cannot reuse that assumption — search_term is text and the threat model is different.

### 3. Status filter: ADDED + NONE default; UI dropdown opens 5 options

Filter applied client-side in the React component, NOT in the GAQL WHERE clause. Reasoning: fetch-time filtering would force separate cache entries per filter selection (cache fragmentation); JS-side filtering keeps one cached UnifiedAd payload and lets the UI swap views instantly.

Status enum maps verbatim from the recon Q1 empirical observation + standard SearchTermStatusEnum:

```typescript
const SEARCH_TERM_STATUS_MAP: Record<number, SearchTermStatus> = {
  0: "UNKNOWN",      // UNSPECIFIED — defensive fallback
  1: "UNKNOWN",      // UNKNOWN — should rarely surface
  2: "ADDED",
  3: "EXCLUDED",
  4: "ADDED_EXCLUDED", // rare edge state
  5: "NONE",
};
```

UI dropdown displays 5 options (`الكل / مضاف / لا يوجد / مستبعد / غير معروف`) + the default applies `status IN (ADDED, NONE)` filter. Color-coded badges:

| Status | Arabic label | Badge color | Rationale |
|--------|--------------|-------------|-----------|
| `ADDED` | مضاف | green (`bg-green-100 text-green-700`) | term is already a keyword in your account — performance attribution to validated targeting |
| `NONE` | لا يوجد | gray (`bg-gray-100 text-gray-700`) | the "goldmine" — terms that triggered the ad but aren't in your keyword list yet. Default-prominent rendering. |
| `EXCLUDED` | مستبعد | red (`bg-red-100 text-red-700`) | term hit a negative-keyword filter — visible only in "الكل" filter |
| `ADDED_EXCLUDED` | مضاف ومستبعد | amber (`bg-amber-100 text-amber-700`) | edge case (term is both an active positive AND active negative — usually a config error) |
| `UNKNOWN` | غير معروف | yellow (`bg-yellow-100 text-yellow-700`) | enum 0 or 1 — defensive fallback for future SDK enum additions |

### 4. Modal integration — between M7 keywords section and catalog products

Insertion at [ReportsClient.tsx:1525-1528](../../src/app/dashboard/reports/ReportsClient.tsx#L1525-L1528). Same outer wrapper / KPI strip / pagination patterns as M7.5 keywords section (~120 LOC duplicated, deliberate — DRY abstraction deferred per Memory: "three similar lines is better than a premature abstraction").

Section structure (mirrors M7.5):

```jsx
{totalSearchTermsCount > 0 && (
  <div className="bg-gray-50 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 border-y border-gray-200">
    {/* Header + sharing-context badge */}
    <h3>كلمات البحث الفعلية ({totalSearchTermsCount})</h3>
    <p>لمجموعة '{adGroupName}' — مشتركة بين N إعلان</p>

    {/* KPI strip — 2 cards */}
    <div className="grid grid-cols-2 gap-2">
      <KpiCard label="إجمالي المبيعات" value={...} />
      <KpiCard label="إجمالي عمليات الشراء" value={...} />
    </div>

    {/* Filter + sort controls */}
    <div className="flex gap-2">
      <select>{/* status: الكل / ADDED / NONE / EXCLUDED / UNKNOWN */}</select>
      <select>{/* match type: الكل / EXACT / PHRASE / BROAD */}</select>
      <select>{/* sort: cost / revenue / ROAS / conversions / imp / clk */}</select>
    </div>

    {/* Table — paginated to 50, "عرض الكل" toggle when filtered set exceeds */}
    <table>...</table>
    <button>{showAll ? 'عرض الأعلى 50 فقط' : `عرض الكل (${count})`}</button>
  </div>
)}
```

KPI totals (إجمالي المبيعات + إجمالي عمليات الشراء) computed from the **currently-visible** (filtered+sorted) set per the M7.5 §Decision 2 convention. Empty states render `—` when no visible term has conversion data.

### 5. Status enum mapping — standard, no integer drift

Verified clean in recon Q1. Standard SearchTermStatusEnum: 0=UNSPECIFIED, 1=UNKNOWN, 2=ADDED, 3=EXCLUDED, 4=ADDED_EXCLUDED, 5=NONE. On imaa only 2 (10%) and 5 (90%) surface in the top-100 sample. Defensive mapping includes all 6 values in case future accounts surface EXCLUDED or UNKNOWN.

Match type enum reuses the existing `MATCH_TYPE_MAP` from [keywords.ts:43](../../src/lib/google-ads/keywords.ts#L43) (2/3/4 = EXACT/PHRASE/BROAD). No new mapping needed.

### 6. Cache bump v11 → v12

`UnifiedAd` gains a `searchTerms?: UnifiedAdSearchTerm[]` field. Cached v11 rows lack this — bump invalidates so all clients fetch fresh data including search terms.

**6th attempted bump under Memory #28 protocol.** Track record: v5→v6 caught Google `invalid_grant`, v6→v7 baseline, v7→v8 caught M5+M8 GAQL bugs, v8→v9 baseline, v9→v10 baseline, v10→v11 value-only correctness bump. v11→v12 will either surface a pre-push issue or join the baseline track.

Same 6-step verification gate per ADR-014 / ADR-015 / ADR-016 / ADR-017:
1. `npm run check` + `npm run build` clean
2. Local dev server up against production Supabase
3. Force fresh Google fetch — both endpoints `?refresh=true`, both return HTTP 200 `source: "fresh"`
4. Force fresh Meta fetch — both endpoints `?refresh=true`, both return HTTP 200 `source: "fresh"`
5. ANY HTTP 500 / non-fresh response → push BLOCKED
6. All four green → push to `phase-4.8-m9`

Plus a pre-push probe re-run of [`_search-terms-recon.mjs`](../../scripts/_search-terms-recon.mjs) to confirm the composite-key merger produces correct per-ad_group totals on the production code path.

### 7. Empty-state copy

When the ad's ad_group has zero search terms in the date range:

```
لا توجد كلمات بحث في الفترة المختارة
قد تكون بيانات Google لا تزال قيد المعالجة (تأخير ~48 ساعة عادي)
```

Honest "data lag" framing instead of generic "no results" — Search Terms have a documented ~24-48h Google processing lag (longer than other reports). Setting the expectation up front prevents a user-confusion ticket.

### 8. PMax skipped in v1

PMax campaigns route through `paid_organic_search_term_view` — different schema, different scope semantics ("paid AND organic" mixed traffic, vs Search's pure paid). M9 v1 surfaces only Search campaigns; PMax search-terms is a hypothetical M9.5 if user demand surfaces. `UnifiedAd.searchTerms` is `undefined` for the PMAX_ASSET_GROUP variant — same conditional render guard as M7 keywords.

### 9. Branch + commit structure — single `phase-4.8-m9`, 3 atomic commits

| # | Commit | Files |
|---|---|---|
| 1 | `chore(recon): M9 search-terms recon + probe preserved` | docs/recon/search-terms-recon-2026-05-28.md, scripts/_search-terms-recon.mjs, scripts/_diagnose-conversion-actions-empty.mjs |
| 2 | `docs(adr): ADR-018 Search Terms architecture` | docs/decisions/018-search-terms.md (this file) |
| 3 | `feat(google): M9 search terms + 8th ADR-011 family merger` | src/lib/google-ads/search-terms.ts (NEW), src/lib/ads/types.ts, src/lib/ads/providers/google.ts, src/lib/ads/cache.ts (v11→v12), src/app/dashboard/reports/ReportsClient.tsx |

Matches M7/M7.5/M-hardening-1 3-commit pattern. Single PR; 3-commit history preserves ADR-precedes-implementation discipline + bisect-ability.

### 10. Memory entries skipped (single instance ≠ pattern)

Two memory candidates surfaced during recon:
- **Probe table-name verification** ("grep `.from()` in production before authoring a probe" — caused the false-alarm side-quest)
- **Control-char separator for text-based composite keys** (`` for arbitrary user text vs `|` for numeric IDs)

Both deferred. Single-instance patterns don't yet justify a memory entry per the discipline of saving only repeating, surprising patterns. The control-char rationale lives in this ADR §Decision 2; the probe-bug lesson lives in the recon doc patch. If a future probe author repeats either mistake, promote to memory at that point.

### 11. Probe disposition — preserve both probes

Per disposition-B (M7/M7.5/M-hardening-1 precedent):
- `scripts/_search-terms-recon.mjs` — reusable for any future search_term_view investigation
- `scripts/_diagnose-conversion-actions-empty.mjs` — reusable for any future google_conversion_actions cache investigation

Both committed in Commit 1. The control-character escape in JS string literals is preserved (`''`) — no Windows CMD or PowerShell quoting issues.

## Alternatives considered

### Alternative A — Path A (single-query with raw `metrics.conversions`)

**Rejected.** Same correctness risk class as M5 `fetchAssetUrls` field-name bug + M7.5 single-query trap. Ships looking correct on imaa (1 PURCHASE action → Path A == Path B == 1.0× inflation factor) but silently inflates on the Saudi/Gulf 5-action typical persona by 2-5×. The 7 existing ADR-011-family mergers were established to prevent exactly this; M9 maintains architectural consistency.

### Alternative B — Pipe separator (`|`) for composite key

**Rejected.** Search terms are arbitrary user-typed text. Real-world examples on imaa already include English/Arabic/transliteration mixes; nothing prevents a future search term from containing a literal `|` (e.g., "imaa | عطور" if a user copy-pastes from a structured source). Pipe collisions would silently merge unrelated rows back into the same Map entry, defeating the composite-key fix. Control byte `` cannot be typed by users and has no semantic meaning in any reasonable text input flow.

### Alternative C — Status filter "show all" default

**Rejected.** Recon Q1 showed imaa has 90% of top-spend terms in `NONE` status (the goldmine) and 10% in `ADDED`. Showing EXCLUDED + UNKNOWN by default would surface noise (negative-matched terms have zero spend by definition, so they'd render as a long list of 0-metric rows at the bottom of the table). The "الكل" opt-in surfaces them when the user is doing negative-keyword auditing — the right time to see EXCLUDED.

### Alternative D — Include PMax search terms in v1

**Rejected.** Different GAQL resource (`paid_organic_search_term_view`), different schema, different scope (paid + organic mixed). Different cache-key dimension since PMax doesn't have ad_groups in the same sense. Folding PMax into M9 would balloon scope from ~420 LOC to ~700+ LOC and require its own recon round. Defer to M9.5 if user research validates demand.

### Alternative E — Skip cache bump (v11 stays)

**Rejected.** Memory #28 protocol is mandatory for shape changes. `UnifiedAd.searchTerms?` is a new field; cached v11 rows would surface as `searchTerms === undefined` after this PR ships, which the React component would render correctly (conditional `{totalSearchTermsCount > 0 && ...}` short-circuits to "hidden") BUT users with stale-fresh cache entries would see the section missing until their next 30-min cache refresh. Forcing fresh fetch via v12 makes the new UI immediately visible post-deploy, matching every prior cache-shape-change milestone.

### Alternative F — Fetch-time status filtering (GAQL WHERE)

**Rejected.** Cache fragmentation: each unique `status_filter` value would generate a separate cache entry (5 statuses × 4+ filter combos = 20+ cache entries per ad). JS-side filtering keeps one canonical UnifiedAd payload and lets the UI switch views instantly. Worst case: a user toggles "الكل" and we fetched 5,000 rows where they wanted to see 4,500 of them — still cheaper than refetching.

### Alternative G — Skip composite key (search_term as Map key)

**Rejected at recon stage** — Q4 empirically showed 401 of 4,539 terms (~9%) collide. Same Map-key-collision bug class as M7.5 keyword's `criterion_id` (~6% collision). The hotfix would be inevitable post-deploy; bake it in now.

### Alternative H — Single-commit atomic

**Rejected per ADR-precedes-implementation discipline.** Same rationale as ADR-015/016/017: 3-commit preserves the architectural decision trail (recon evidence → architectural decision → implementation), making `git log` self-documenting and `git bisect` precise.

## Consequences

### Positive

- **8th ADR-011-family merger** — pattern continues maturing. Every conversion surface in the app now uses the same two-query pattern: campaign / ad / asset_group / time-series / keyword / **search_term**. Architectural consistency.
- **Composite-key lesson reinforced** — M7.5 hotfix → M9 native — pattern memory is paying compound returns. Probe Q4 surfaced the collision before implementation, not after a production complaint.
- **Rich verification target on imaa** — 10,351 terms / 74 with conversions / 9,844 SAR / 187 conversions over 30d. Top search terms are brand-name queries with attributable revenue ("ايما" 10,245 SAR / 35 conversions; "عطر ايما" 3,632 SAR / 16 conversions). Visual verification will be unambiguous.
- **"Goldmine" status discoverable in UI** — the 90% of top-spend terms in `NONE` status (matched via broad expansion of existing keywords but not formalized as keywords themselves) is exactly the optimization opportunity advertisers want surfaced.
- **Empty-state honesty** — the "~48 hour data lag" copy sets expectations honestly; reduces user-confusion ticket volume.
- **Memory #28 protocol — 6th cache bump iteration** — pattern continues being exercised. v11→v12 will either catch a pre-push issue or extend the baseline track.

### Negative

- **+420 LOC vs M7.5's ~340 LOC** — slightly larger feature for similar architectural slot, mostly due to the new UI columns (search term text + match type + status badges) and the 8th merger sibling. Acceptable.
- **Cache v11 → v12 invalidation cascade** — same 30-min transition window as v10→v11. Every account's next dashboard load triggers fresh fetches. Mitigated by Memory #28 protocol gate.
- **5 status-enum integers to maintain** — every future SDK enum addition (e.g., a hypothetical v24 introduces value 6) requires defensive map update. Mitigated by the `?? "UNKNOWN"` fallback in the integer-drift reader pattern.
- **Modal vertical real estate growing** — AdDetailModal now has: image carousel + headlines + descriptions + extensions + keywords + KPI strip + search terms + KPI strip + catalog products + perf grid. Search modal is `max-w-4xl` (widened in M7.5) which absorbs the new section comfortably, but at some point a tab-based modal layout may be warranted. Defer until vertical scroll becomes a real pain point.

### Risk

- **Composite-key correctness under future search term contents** — if a future search term contains literal ``, the key collides. Threat model: search terms are user input; `` is Start-of-Heading and cannot be typed via keyboard. Possible only if a copy-pasted source contains it. Mitigation: if a Map collision surfaces in production, the fix is identical to M7.5 — bump to `` or use a JSON-encoded `{ag, term}` tuple. Low probability, easy hotfix path.
- **Status enum drift on a future Google SDK version** — if SDK v24+ introduces a new SearchTermStatus enum value (e.g., 6 = "SOME_NEW_STATE"), the integer-drift reader returns `"UNKNOWN"` for it (defensive default), which the UI renders with the yellow badge. Not catastrophic; just non-informative. Surfaced via Vercel logs if it happens.
- **48h data lag on truly fresh accounts** — a user who just connected might see "لا توجد كلمات بحث" for up to 2 days even when their campaigns ARE running. Empty-state copy explicitly says this. Acceptable trade-off; alternative would be hiding the section entirely, which loses discoverability.

## Implementation plan (3 commits on `phase-4.8-m9`, ~420 LOC total)

| Commit | File | Change | Est. LOC |
|---|---|---|---|
| 1 | `docs/recon/search-terms-recon-2026-05-28.md` | NEW (already written, untracked from previous turn) | — |
| 1 | `scripts/_search-terms-recon.mjs` | NEW (already written, untracked) | — |
| 1 | `scripts/_diagnose-conversion-actions-empty.mjs` | NEW (already written, untracked — bonus from side-quest resolution) | — |
| 2 | `docs/decisions/018-search-terms.md` | NEW — this ADR | — |
| 3 | `src/lib/google-ads/search-terms.ts` | NEW — `fetchSearchTerms` (Q1) + `fetchPurchaseSearchTermTotals` (Q2 inline) + helpers. Two-query parallel pattern mirrors `keywords.ts`. Composite-key `${adGroupId}${searchTerm}`. | +300 |
| 3 | `src/lib/ads/types.ts` | Add `UnifiedAdSearchTerm` interface + `SearchTermStatus` type + `searchTerms?: UnifiedAdSearchTerm[]` field on UnifiedAdCommon. | +30 |
| 3 | `src/lib/ads/providers/google.ts` | One-block addition to `getAds()` Promise.all: fetch search terms in parallel with keywords + extensions + images. Merge into normalized ads via the per-ad_group lookup pattern (mirrors keywords merge step). | +20 |
| 3 | `src/lib/ads/cache.ts` | Bump v11 → v12 + history entry referencing this ADR. | +12 |
| 3 | `src/app/dashboard/reports/ReportsClient.tsx` | New "كلمات البحث الفعلية" section between line 1525 (M7 keywords closing) and line 1528 (catalog products opening). Header + KPI strip + filter dropdowns + sort dropdown + table + pagination toggle. Reuses formatters from M7.5 (`formatAndConvert`, `formatCount`). | +150 |
| **Total commit 3** | | | **~512** |

LOC estimate refined upward from recon's ~420 (the `search-terms.ts` ended up bigger than initially scoped — combined Q1+Q2 in one file mirrors `keywords.ts` so a single helper module hosts both fetchers).

## Verification plan

### Pre-push (Memory #28 protocol — BLOCKING)

1. `npx tsc --noEmit` clean
2. `npm run build` clean — no module-resolution errors with new file
3. **Re-run `_search-terms-recon.mjs`** against imaa: confirm Q1 still returns 100 rows, Q4 still shows ~9% composite-key collision rate, Q5 still shows 10K+ rows. Establishes the production code path will produce the same shape the recon validated.
4. Local dev server up against production Supabase
5. Force fresh Google fetch — `/api/ads/{insights,creatives}?provider=google&account_id=5473228670&refresh=true` both return HTTP 200 `source: "fresh"`
6. Force fresh Meta fetch — same with `provider=meta&account_id=...`, both return HTTP 200 `source: "fresh"`
7. ANY HTTP 500 / non-fresh / cache-shape mismatch → push BLOCKED
8. All checks green + probe re-run clean → push to `phase-4.8-m9`

### Vercel preview (visual verification by user)

Open preview, navigate to `/dashboard/reports` → Google tab → click any RSA card on imaa Brand campaigns. Expect in modal:

- New "كلمات البحث الفعلية ({N})" section between keywords section and catalog products section
- Header includes ad_group + ads-count context badge ("لمجموعة 'X' — مشتركة بين N إعلان")
- 2-card KPI strip (إجمالي المبيعات + إجمالي عمليات الشراء) populated with real SAR/count values
- 3 filter dropdowns: status (الكل / مضاف / لا يوجد / مستبعد / غير معروف — default = "مضاف ولا يوجد"), match type (الكل / EXACT / PHRASE / BROAD), sort (cost / revenue / ROAS / conversions / impressions / clicks)
- Table renders top 50 by default + "عرض الكل (N)" toggle when filtered set > 50
- Sample top rows on Brand-KSA modal: "ايما" with green ADDED badge + 9,947 SAR; "imaa" with gray NONE badge + 1,848 SAR; etc.
- Color-coded status badges: ADDED=green, NONE=gray-prominent, EXCLUDED=red, UNKNOWN=yellow
- Match-type indicators next to search term text
- Empty state with "48-hour data lag" copy when an ad has no recent search terms
- No regression on M7 keywords / M8 image grid / M-PMax modal / Meta cards
- KPI totals match the cross-ad_group sum (mental-math against a sample ad_group)

### Post-deploy (production)

Hard-refresh `arabiadash.com/dashboard/reports`. Same checks as preview. Cache v11 → v12 transition window ~30 min from merge.

## Open items deferred (NOT in M9 scope)

1. **M9.5 — Write-back actions** ("add as keyword" / "add as negative" buttons). Requires user-OAuth-confirmation flow + Google review for mutation scopes. Significant scope; warrants own ADR.
2. **M9.6 — Search-terms recommendations engine** (auto-flag high-ROAS NONE terms as candidate keywords). AI/heuristic feature; out of phase 4.8 scope.
3. **PMax search terms** via `paid_organic_search_term_view`. Different schema. Hypothetical M9.7 if user demand surfaces.
4. **Cross-ad_group de-duplication** of the same term across multiple ad_groups in the rendered table. Currently shows the same term N times (once per ad_group it appears in). Some users may prefer a roll-up view; defer to user feedback.
5. **Search-term ROAS color coding** (red < 1x, amber 1-2x, green > 2x per existing M7 pattern). Easy add; deferred to keep v1 lean.
6. **Per-search-term costPerPurchase metric**. Derivable from existing cost + purchases columns; defer until requested.

## Commits

- *(next on this branch)* — `chore(recon): M9 search-terms recon + probe preserved`
- *(next on this branch)* — `docs(adr): ADR-018 Search Terms architecture` (this file)
- *(next on this branch)* — `feat(google): M9 search terms + 8th ADR-011 family merger`
