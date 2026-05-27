# ADR-019: Lazy-load ad-group-scoped data (M9.1 perf fix)

**Status**: Draft — awaiting approval
**Date**: 2026-05-27
**Phase**: 4.8 M9.1 (performance hotfix on top of M9)
**Related**: ADR-015 (M7 Keywords — first time per-ad_group data was attached to ads), ADR-016 (M7.5 — added conversion attribution to keywords), ADR-018 (M9 Search Terms — surfaced the inflation issue at scale), Memory #27 (long-term-fit over short-term), Memory #28 (cache bump pre-push protocol), Memory #29 (Saudi/Gulf accounts run at 1,000s-10,000s scale, not 10s-100s)
**Recon**: [docs/recon/m9-perf-recon-2026-05-27.md](../recon/m9-perf-recon-2026-05-27.md) (5-tier instrumentation against imaa preview; 40.9s wall time measured, 78% in cache write)
**Closes**: M9 post-ship performance regression (40s page loads on imaa)

## Context

M9 (ADR-018, shipped 2026-05-27 in `428931f`) added per-ad_group search terms to the creatives payload. Within hours, user reported `/api/ads/creatives` taking ~2 minutes on production. Recon instrumentation (`phase-4.8-m9-perf-recon` branch) measured 40.9s wall time on imaa preview with full `[perf-recon]` log tier coverage.

**Three findings from the recon:**

1. **Cache write dominates (78% of wall time).** `setCachedCreatives` upserting a 17.5 MB JSONB blob from Vercel US-East to Supabase Seoul took 31.9s. The Google API fetches themselves run cleanly in parallel and complete in ~6.3s.

2. **Payload inflated 5.7× by JSON serialization.** Per-ad_group data (search terms, keywords) is attached to `UnifiedAd` rows via in-memory shared array references. `JSON.stringify` doesn't dedupe object references — each ad's `searchTerms` field is serialized in full. On imaa: 6 ads × ~14,000 unique terms per ad_group = 80,951 search terms in the payload, inflating the actual ~14,000 unique by 5.7×. Same mechanic applies to keywords (211 × 6 = 1,266 in payload vs 211 unique = 6× inflation, currently small in absolute terms).

3. **The problem is structural, not size-thresholded.** M7.5 keywords already had the same inflation pattern but stayed under the cache-write inflection point. M9 search terms crossed it. Any future per-ad_group data type with thousands-of-units-per-group scale will hit the same wall. The Saudi/Gulf account profile from Memory #29 (large catalogs, broad-match keyword expansion) implies this scale is the norm, not the outlier.

**Three architectural commitments lock in before implementation:**

1. **Lazy-fetch on modal open.** Search terms and keywords are only viewed when a user opens an `AdDetailModal`. The current eager bundling forces every page load to pay the full search-terms cost regardless of whether any modal is opened. Lazy fetching matches the user mental model AND the industry convention (Google Ads UI itself lazy-loads both surfaces on drill-in).

2. **Fix both data types in one milestone.** Per Memory #27, fixing only search terms today leaves keywords as a known-future-failure for any account with 5,000+ keywords. The architecture change is identical for both; doing them together is +1-2 hours over single-fix and removes a latent bug class.

3. **Per-ad_group endpoints, not per-ad.** Both new endpoints (`/api/ads/search-terms`, `/api/ads/keywords`) take `ad_group_id` not `ad_id`. The data is per-ad_group by Google's data model; per-ad would be a UX-driven leaky abstraction.

The recon also surfaced **two memory candidates worth saving** (Decision §8 below) — both reusable for any future per-ad_group data type (audiences, products, demographics, locations).

## Decision

### 1. Lazy-fetch architecture — drop per-ad_group data from creatives payload

`UnifiedAd.searchTerms` and `UnifiedAd.keywords` fields removed from the `UnifiedAdCommon` shape. The creatives endpoint (`/api/ads/creatives`) returns ONLY:

- Per-ad identity (id, name, campaign, ad_group, creative metadata)
- Per-ad metrics (spend, impressions, clicks, CTR, ROAS, purchases, revenue)
- Per-ad extensions (sitelinks, callouts, image extensions — small payload, ~700 bytes per ad, no inflation issue)
- PMax asset_group data (already per-asset-group structured, no shared-reference inflation)

Search terms and keywords are fetched on-demand via two new endpoints. The modal renders a spinner during fetch; data appears when ready.

### 2. Two new endpoints

**`GET /api/ads/search-terms?account_id=X&ad_group_id=Y&since=Z&until=W`**

Returns `{ data: UnifiedAdSearchTerm[], source: "fresh"|"cache-fresh"|"cache-stale", fetchedAt: ISO }`.

Same SWR cache semantics as `/api/ads/creatives`. Cache key: `${user_id}:${account_id}:${ad_group_id}:${date_range}`. New cache table or composite key in existing `creatives_cache` (see Decision §6 — TBD during impl, leans toward composite key in existing table to avoid migration overhead).

**`GET /api/ads/keywords?account_id=X&ad_group_id=Y&since=Z&until=W`**

Same shape as search-terms endpoint. Returns `UnifiedAdKeyword[]`.

Both endpoints require `ad_group_id` — no fallback to "all ad_groups" because the user only ever asks for a specific group's data via modal open.

### 3. Adapter changes — expose `getSearchTerms` / `getKeywords` as standalone methods

`GoogleAdsAdapter.getAds()` no longer calls `fetchSearchTerms` or `fetchKeywords` — those branches drop from the Promise.all in pass 2.

Two new public methods on the adapter:

```typescript
class GoogleAdsAdapter {
  async getSearchTermsForAdGroup(
    adGroupId: string,
    range: DateRangeInput
  ): Promise<UnifiedAdSearchTerm[]> {
    return this.withReauthMapping(async () => {
      const { dateFrom, dateTo } = this.resolveDateRange(range);
      const byAdGroup = await fetchSearchTerms({
        customerId: this.customerId,
        refreshToken: this.refreshToken,
        loginCustomerId: this.loginCustomerId,
        dateFrom,
        dateTo,
        adGroupIds: new Set([adGroupId]),
        purchaseActionIds: this.purchaseActionIds,
      });
      return byAdGroup.get(adGroupId) ?? [];
    });
  }

  async getKeywordsForAdGroup(
    adGroupId: string,
    range: DateRangeInput
  ): Promise<UnifiedAdKeyword[]> {
    return this.withReauthMapping(async () => {
      const { dateFrom, dateTo } = this.resolveDateRange(range);
      const byAdGroup = await fetchKeywords({
        customerId: this.customerId,
        refreshToken: this.refreshToken,
        loginCustomerId: this.loginCustomerId,
        dateFrom,
        dateTo,
        adGroupIds: new Set([adGroupId]),
        statusFilter: "enabled",
        purchaseActionIds: this.purchaseActionIds,
      });
      return byAdGroup.get(adGroupId) ?? [];
    });
  }
}
```

`AdProviderAdapter` interface gains these two optional methods (`Meta` adapter implements no-op or throws "not supported" — Meta doesn't have ad_group-scoped search terms or keywords in the same sense).

### 4. SWR hooks for modal-open fetching

Two new client hooks mirror the existing `useProviderAds` / `useProviderInsights` pattern:

`src/lib/hooks/use-search-terms.ts`:
```typescript
export function useSearchTerms(options: {
  accountId: string;
  adGroupId: string;
  range?: DateRange;
  customRange?: CustomDateRange;
  enabled?: boolean; // false until modal opens
}): {
  searchTerms: UnifiedAdSearchTerm[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
```

`src/lib/hooks/use-keywords.ts`: same shape returning `UnifiedAdKeyword[]`.

The `enabled` flag defaults to `false`. The modal sets it to `true` when it mounts. Hook returns `loading=true` while the fetch is in flight; `searchTerms`/`keywords` are an empty array until the fetch resolves.

### 5. UI changes — modal renders spinner during lazy fetch

In `ReportsClient.tsx`'s `AdDetailModal`, replace `const keywordsRaw = ad.keywords ?? []` with a hook call:

```typescript
const { searchTerms: searchTermsRaw, loading: searchTermsLoading, error: searchTermsError } =
  useSearchTerms({
    accountId: ad.accountId!,
    adGroupId: ad.ad_group_id!,
    range,
    enabled: true, // modal is open ⇒ fetch
  });

const { keywords: keywordsRaw, loading: keywordsLoading, error: keywordsError } =
  useKeywords({ accountId: ad.accountId!, adGroupId: ad.ad_group_id!, range, enabled: true });
```

Loading state in the section header:

```jsx
{searchTermsLoading ? (
  <div className="flex items-center justify-center py-8 text-gray-500">
    <Loader2 className="w-4 h-4 animate-spin ml-2" />
    <span className="text-sm">جاري تحميل كلمات البحث...</span>
  </div>
) : searchTermsError ? (
  <div className="text-center py-8">
    <p className="text-sm text-red-600 mb-2">تعذّر تحميل كلمات البحث</p>
    <button onClick={() => refresh()} className="text-sm text-indigo-600 hover:underline">
      إعادة المحاولة
    </button>
  </div>
) : (
  /* existing table render */
)}
```

Same pattern for keywords section. Modal opens fast; sections fill in as data arrives.

### 6. Cache strategy — composite cache key in existing `creatives_cache` table

The simplest path: reuse the `creatives_cache` table with a composite cache key. Today's cache key is `${user_id}:${provider}:${account_id}:${date_range}`. New keys:

- `${user_id}:google:${account_id}:${date_range}:search-terms:${ad_group_id}`
- `${user_id}:google:${account_id}:${date_range}:keywords:${ad_group_id}`

Stored as separate rows in `creatives_cache`. Same `data` JSONB column. Same SWR fresh/stale semantics (30m fresh / 24h stale per existing config).

**Why not a new table?** Migration overhead, RLS policy duplication, schema complexity. The composite-key approach is one line of code change in the cache helper (`getCachedCreatives` / `setCachedCreatives` already accept the `dateRange` field; we extend it with the suffix).

**Why per-ad_group, not per-ad?** Search terms and keywords are per-ad_group by Google's data model. All ads in the same ad_group share the same arrays. Per-ad_group caching means a user clicking through 6 ads in the same ad_group hits the cache 5 times after the first fetch.

### 7. Cache bump v12 → v13 (Memory #28 — 7th iteration)

`UnifiedAd` loses `keywords?` and `searchTerms?` fields. Cached v12 entries carry those fields; v13 entries don't. Reading a v12 entry on v13 code would still render correctly (the lazy hooks fire regardless), but it wastes ~17 MB on the client per cache-fresh hit until the entry expires.

**v12 → v13 bump invalidates immediately**, forcing all clients to fetch the leaner v13 payload on first request. Per the established Memory #28 6-step pre-push protocol:

1. `npm run check` + `npm run build` clean
2. Local dev server up against production Supabase
3. Force fresh Google fetch — both `/api/ads/{insights,creatives}?refresh=true` return HTTP 200 `source: "fresh"`
4. Force fresh Meta fetch — same with `provider=meta&refresh=true`
5. ANY HTTP 500 / non-fresh → push BLOCKED
6. All four green → push

Plus a per-milestone-specific extra: **timing re-run on preview** to confirm the predicted 5-8s wall time (vs 40s baseline). Memory #28 protocol caught GAQL field-name bugs pre-push on prior milestones; this iteration adds explicit perf regression coverage.

### 8. Memory entries — TWO new

Two distinct lessons surfaced. Both worth saving per the "save what is applicable to future conversations" criterion:

**Memory #1 (this ADR): JSON serialization duplicates shared object references.** Per-ad_group data attached via shared array references in memory looks correct in dev tools but inflates N× during `JSON.stringify`. Manifests as cache-write slowness or transfer-size bloat when scale crosses an inflection point (search terms hit it; keywords latent). Mitigation: either normalize the shape before serialize (top-level keyed map + per-ad references) OR lazy-load by ad_group_scope. The lazy-load route also matches UX intent.

**Memory #2 (this ADR): Lazy-load by ad_group scope is the right default for per-ad_group data.** Per-ad_group surfaces (search terms, keywords, future audiences/products/demographics) belong on modal-open, not in the creatives endpoint. Three reasons: (1) JSON inflation as above, (2) UX intent — only viewed on drill-in, (3) industry convention — Google Ads UI and equivalents lazy-load. Default to lazy unless there's a load-time hard requirement.

Both reusable for the next per-ad_group data type. Save both per the discipline.

### 9. Out of scope (explicit non-goals)

- **PMax asset_group lazy-load.** Asset groups are already structured per-asset-group in the payload (no shared-reference inflation). Today's payload size for PMax is ~10-30 KB per asset group. Eager is fine.
- **Catalog products lazy-load.** Meta-only, separate concern, smaller payload, different ADR if needed.
- **Extension lazy-load.** Per-ad extensions are ~700 bytes per ad, no inflation, no scale issue. Eager remains optimal.
- **Server-side payload dedup (alternative considered + rejected below).** Lazy-load is architecturally cleaner and matches UX intent.
- **Move Supabase to US region.** Latency to Saudi end-users matters more than Vercel-to-Supabase latency. Off the table.

### 10. 3-commit atomic structure on `phase-4.8-m9.1-perf-fix` branch

| # | Commit | Files |
|---|---|---|
| 1 | `chore(recon): M9.1 perf recon findings preserved` | docs/recon/m9-perf-recon-2026-05-27.md (the perf-recon DATA, not the instrumentation code — that stays on the unmerged perf-recon branch as reference) |
| 2 | `docs(adr): ADR-019 lazy-load ad-group data` | docs/decisions/019-lazy-load-ad-group-data.md (this file) |
| 3 | `feat(api): lazy-load search terms + keywords on modal open` | All implementation files. See §Implementation plan. |

Matches the M7/M7.5/M-hardening-1/M9 3-commit pattern.

## Alternatives considered

### Alternative A — Compress the cache payload (gzip / brotli)

**Rejected.** Treats symptom not cause. The 17.5 MB payload represents only ~14,000 unique search terms; 5.7× of it is duplicate data being created by JSON serialization and then compressed away. Better to never create the duplication in the first place. Plus: Supabase's PostgreSQL JSONB column doesn't transparently compress; we'd need to handle compress/decompress ourselves at app level, adding CPU on both ends and complicating debugging. Lazy-load eliminates the bytes outright.

### Alternative B — Move Supabase to US region

**Rejected.** Reduces Vercel→Supabase RTT by ~250ms but adds the same RTT to every Saudi end-user→Supabase request (the dashboard reads from Supabase for workspaces, user settings, etc on every page load). Latency to end users matters more than latency between two backend services. The bottleneck is bytes, not RTT.

### Alternative C — Server-side dedup before serialize

**Rejected.** Concretely: keep `UnifiedAd.searchTerms`/`keywords` as optional fields, but transform the response so each ad carries an `adGroupKey` and the response includes a top-level `searchTermsByAdGroup` map keyed by that. JSON serializes the map once; ads reference by key. Would eliminate the 5.7× inflation.

**Why rejected:** fixes serialization-only — bytes still travel over the wire on every page load even when no modal opens. The recon's deeper finding is that this data shouldn't be in the every-page-load critical path at all. Server-side dedup is a 60% fix (bytes reduce but still ~3 MB on imaa, still ~5s cache write); lazy-load is the 95% fix (~700 KB payload, ~1-2s cache write). Plus lazy-load matches the UX intent. Plus lazy-load adds zero new shape complexity in the cache (no top-level maps to maintain). Plus the M7.5 keywords + future audiences/products/demographics will all hit this same wall — solving it architecturally now compounds.

### Alternative D — Search terms lazy only (keep keywords eager)

**Rejected.** Search terms is the immediate fire (~17 MB blow-up). Keywords today is ~50 KB (small but inflated 6×). Per Memory #27 (long-term-fit) + Memory #29 (Saudi/Gulf accounts run at thousands-scale), keywords will hit the same wall on any account with 5,000+ keywords. Same architectural change for both; doing them together is +1-2 hours and removes the latent failure mode. Skipping keywords would create a "fix the second one later" trap.

### Alternative E — Async cache write via `after()`

**Rejected.** Already in use for stale-revalidation. Doesn't help cache-miss (which IS the slow path measured). Doesn't reduce bytes — just defers them. User still sees a 40s wait on first load. Lazy-load reduces actual work, not just when it happens.

### Alternative F — Pre-warm the cache via background job

**Rejected.** Adds infrastructure (cron / queue / worker). Cache pre-warming doesn't help the first-ever fetch. And it would still write 17.5 MB blobs on every refresh interval. Lazy-load eliminates the work, not defers it.

### Alternative G — Stream the response (chunked transfer)

**Rejected.** Streaming reduces time-to-first-byte but not total wall time. The cache write is server-side blocking; can't stream a write to Supabase the same way you stream a response to the client. Plus: the React client expects an array, not a stream — UI redesign cost would dominate.

### Alternative H — Single-commit atomic

**Rejected per ADR-precedes-implementation discipline.** Same rationale as ADR-015/016/017/018: 3-commit preserves the architectural decision trail.

## Consequences

### Positive

- **~5× speedup on cache-miss page load** (~40s → ~7-8s). Cache-fresh hits become instant. Cache-stale serves the (now small) cached payload while revalidating in background.
- **Architecturally clean.** Per-ad_group data lives behind per-ad_group endpoints. The data shape matches the data model (Google's per-ad_group reality).
- **Scales to large accounts.** A 100k-search-term account no longer blows up the dashboard; modal-open fetches per ad_group stay bounded.
- **Removes latent bug class.** Future per-ad_group data types (audiences, products, demographics, locations) inherit the lazy-load pattern as the established convention.
- **Industry-convention UX.** Modal-open lazy-load matches Google Ads UI itself. User mental model unchanged.
- **Memory #28 protocol 7th iteration.** Pattern continues maturing. This bump adds an explicit perf-regression gate beyond the standard 6-step.

### Negative

- **+2 new API endpoints to maintain.** `/api/ads/search-terms` + `/api/ads/keywords`. SWR caching means they're mostly invisible operationally, but they're still surface area.
- **+2 new client hooks** (`useSearchTerms`, `useKeywords`). Conventional SWR pattern, low cost.
- **Modal opens with 5-6s spinner on first click per ad_group** before search terms render. Acceptable per industry convention — user explicitly opted in by opening the modal. Subsequent ads in the same ad_group hit cache instantly.
- **Cache v12 → v13 invalidation cascade.** Same 30-min transition window blast radius as v10→v11/v11→v12. Mitigated by Memory #28 protocol gate + the perf-regression gate.
- **Search-terms-section UI now has a "loading" state.** One more state to design + maintain. Arabic copy: "جاري تحميل كلمات البحث..." with spinner.

### Risk

- **Modal-open UX with slow Google API + slow network.** If the search-terms fetch takes 8s, the user sees an 8s spinner. Mitigation: SWR cache makes the second-ad-in-same-ad_group hit instant. First-fetch UX is the unavoidable trade-off; the spinner copy explicitly says "loading" so users understand.
- **Error-state correctness.** If the lazy fetch fails (network, reauth, rate limit), the modal needs to surface a retry button. Implementation must handle 401 (reauth via ADR-017 banner), 429 (rate-limited), 500 (generic retry). Mitigation: SWR retry semantics + error component using existing `ReauthRequiredError` flow.
- **Cache key length explosion.** Each ad_group now has its own cache row. imaa has 4 campaigns × 1-2 ad_groups × 2 data types = 8-16 cache rows per user instead of 1. Still well within Supabase's row limits. Mitigation: none needed; just noted.
- **The lazy hook's `enabled` flag plus modal mount/unmount races.** If the user opens and closes a modal rapidly, in-flight requests need cancellation. Mitigation: SWR has built-in request deduplication + abort-on-unmount. Same pattern as `useProviderAds`.

## Implementation plan (3 commits on `phase-4.8-m9.1-perf-fix`, ~400 LOC total)

| Commit | File | Change | Est. LOC |
|---|---|---|---|
| 1 | `docs/recon/m9-perf-recon-2026-05-27.md` | NEW (already written, untracked) | — |
| 2 | `docs/decisions/019-lazy-load-ad-group-data.md` | NEW — this ADR | — |
| 3 | `src/app/api/ads/search-terms/route.ts` | NEW endpoint: auth check, accountId+adGroupId+date validation, adapter.getSearchTermsForAdGroup, SWR cache hit/miss/stale. Mirrors `/api/ads/creatives/route.ts` shape. | +110 |
| 3 | `src/app/api/ads/keywords/route.ts` | NEW endpoint: same shape, calls adapter.getKeywordsForAdGroup. | +110 |
| 3 | `src/lib/ads/providers/google.ts` | Drop `fetchSearchTerms` + `fetchKeywords` calls from `getAds` pass 2. Drop `searchTermsByAdGroup` + `keywordsByAdGroup` params from `normalizeAd`. Add new public methods `getSearchTermsForAdGroup` + `getKeywordsForAdGroup` (each ~15 LOC). | -25 + 35 = +10 |
| 3 | `src/lib/ads/factory.ts` | No change needed — adapter interface unchanged; new methods are Google-specific and called via the route directly. | 0 |
| 3 | `src/lib/ads/types.ts` | Remove `keywords?` + `searchTerms?` fields from `UnifiedAdCommon`. `UnifiedAdKeyword` + `UnifiedAdSearchTerm` types stay (used by new endpoints). Add `AdProviderAdapter` interface annotations marking the new optional methods. | +5 / -10 |
| 3 | `src/lib/ads/cache.ts` | Bump v12 → v13 + history entry. | +12 |
| 3 | `src/lib/hooks/use-search-terms.ts` | NEW SWR hook. Patterned on `use-provider-ads`. Accepts `enabled` flag for modal-open gating. Single-ad_group scoped fetch. | +85 |
| 3 | `src/lib/hooks/use-keywords.ts` | NEW SWR hook. Same shape as `use-search-terms`. | +85 |
| 3 | `src/app/dashboard/reports/ReportsClient.tsx` | Replace `const keywordsRaw = ad.keywords ?? []` + `const searchTermsRaw = ad.searchTerms ?? []` with `useKeywords` + `useSearchTerms` hook calls. Add loading/error/empty states for both sections. Modal opens fast; sections render spinners → data. | +80 / -10 |
| **Total commit 3** | | | **~412** |

## Verification plan (Memory #28 7th iteration + perf gate)

### Pre-push (BLOCKING)

1. `npx tsc --noEmit` clean
2. `npm run build` clean
3. Local dev server up against production Supabase
4. **Standard Memory #28 gates** (unchanged from prior 6 iterations):
   - Force fresh Google fetch — `/api/ads/{insights,creatives}?refresh=true` return HTTP 200 `source: "fresh"`
   - Force fresh Meta fetch — same with `provider=meta`
   - New endpoint smoke test: `/api/ads/search-terms?account_id=5473228670&ad_group_id=<imaa_ag_id>&range=30d` returns HTTP 200 with `data: UnifiedAdSearchTerm[]`
   - Same for `/api/ads/keywords` against the same ad_group
5. **New perf gate (this milestone only):** add temporary `[perf-recon]` timing logs to the new `/api/ads/creatives` path (without the eager search-terms + keywords fetches). Verify creatives wall time drops to 5-8s on imaa. Remove temp logs before push.
6. **Unmount-race gate (BLOCKING per user requirement):**
   - Open the modal on an imaa card known to have 13k+ search terms (any Brand campaign RSA)
   - Within 2 seconds — BEFORE the search-terms fetch resolves — close the modal
   - **Required outcome 1:** DevTools console shows NO `Warning: Can't perform a React state update on an unmounted component` errors
   - **Required outcome 2:** DevTools Network tab shows the in-flight `/api/ads/search-terms` and `/api/ads/keywords` requests get `(canceled)` status — no zombie requests continuing post-close
   - **Implementation requirement:** the SWR hooks (`useSearchTerms`, `useKeywords`) MUST plumb an `AbortController` through the fetcher's signal parameter. Relying on SWR's built-in revalidation deduplication is insufficient — it dedupes concurrent calls but does not abort in-flight requests on unmount. Standard pattern but easy to miss.
   - **STOP CONDITION:** if zombie requests or unmount warnings surface, the hooks need AbortController plumbing before push. BLOCKING.
7. ANY check failing → push BLOCKED. Diagnose + fix before retry.

### Vercel preview (visual verification by user)

1. Open preview → login → `/dashboard/reports` → Google tab
2. Expect: page loads ~5-8s on cache-miss (not 40s). Cache-fresh on second load → instant.
3. Click any RSA card on imaa Brand campaigns
4. Modal opens immediately (no waiting for search terms)
5. Keywords section shows spinner → loads (~1-2s)
6. Search terms section shows spinner → loads (~5-6s)
7. KPI strip totals match the per-ad cards' aggregate (correctness preservation)
8. Open a second ad from the same ad_group → modal sections render instantly (cache hit on the new per-ad_group cache rows)
9. Switch to Meta tab — no regression (Meta ads don't have keywords/searchTerms)
10. Switch back to Google, open a PMax card — no regression (PMax modal unchanged)

### Post-merge (production)

Hard-refresh `arabiadash.com/dashboard/reports`. Cache v12 → v13 transition window ~30 min from merge. After transition: cache-fresh hits should be sub-second; cache-miss should be 5-8s.

## Open items deferred (NOT in M9.1 scope)

1. **Per-ad_group cache warming via background job** — fire-and-forget lazy fetch on creatives-endpoint response, so the first modal-open hits cache. Adds infrastructure complexity. Defer until user reports the modal-open spinner is intrusive.
2. **Same lazy pattern to PMax asset_group assets** — currently eager, but they're already per-asset-group structured. Low priority.
3. **Same lazy pattern to catalog products** — Meta-only, separate ADR if needed.
4. **`UnifiedAdSearchTerm` / `UnifiedAdKeyword` type co-located with the new endpoint route files** — currently in `types.ts`. Defer until a second consumer surfaces.
5. **Streaming the search-terms response** — chunked transfer over a large result set. Not blocking; lazy-load already keeps the bytes manageable.
6. **Compression at HTTP layer** — Vercel does this automatically for gzip-eligible responses. Not in this ADR's scope.

## Commits

- *(next on this branch)* — `chore(recon): M9.1 perf recon findings preserved`
- *(next on this branch)* — `docs(adr): ADR-019 lazy-load ad-group data` (this file)
- *(next on this branch)* — `feat(api): lazy-load search terms + keywords on modal open`
