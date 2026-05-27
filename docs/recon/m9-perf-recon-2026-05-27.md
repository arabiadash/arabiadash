# M9.1 Performance recon — diagnosing 2-min /api/ads/creatives load

**Date:** 2026-05-27
**Mode:** READ-ONLY instrumentation + production-equivalent preview measurement
**Branch:** `phase-4.8-m9-perf-recon` (instrumentation never merged to main; preserved as reference)
**Trigger:** User reports `/api/ads/creatives` takes ~2 min on `arabiadash.com` after M9 ship. Pre-M9 baseline was ~3-6s (recon Q5 expectation). 20-40× slower — M9 ship suspected.

---

## TL;DR

- **Cache write is the bottleneck.** `setCachedCreatives` upserting a 17.5 MB JSONB blob to Supabase Seoul from Vercel US-East takes **31.9 seconds = 78% of total wall time** (40.9s observed for imaa cache-miss).
- **The 17.5 MB payload is artificially inflated by 5.7×.** JSON serialization does not deduplicate shared object references — search terms attached per-ad via the in-memory shared array reference get serialized N times where N = ads sharing an ad_group. Payload reports 80,951 search terms; the actual unique set is ~14,000.
- **Same pattern affects keywords** (6× inflation: 211 keywords × 6 ads = 1,266 in payload, only 211 unique). Smaller impact today (~50 KB) but a latent bug class for any account with 5k+ keywords.
- **All Google API fetches run correctly in parallel.** Pass1/Pass2/Pass3 wall times match the longest leaf in each — Promise.all is not the issue.
- **`searchTerms.Q1` is the slowest single fetch** (4.6s for 90,347 raw GAQL rows over 30 days), but only 12% of total wall time. Not the headline cause.

## Instrumentation

5-tier `[perf-recon]` logging added (no functional changes):

| Tier | What it measures | Locations |
|------|------------------|-----------|
| Route handler | `adapter_init` / `adapter_getAds` / `cache_write` / `payload_size` / `ads_count` / `total_keywords` / `total_search_terms` / `TOTAL` | `src/app/api/ads/creatives/route.ts` |
| Adapter | `pass1` / `pass2` / `pass3` parallel-block totals + `getAds TOTAL` + `normalizeAds` | `src/lib/ads/providers/google.ts` |
| Pass 1 leaves | `google.fetchAds` / `google.fetchPurchaseAdTotals` | same |
| Pass 2 leaves | `google.fetchAssetUrls` / `google.fetchAdExtensions` / `google.fetchKeywords` / `google.fetchSearchTerms` | same + `keywords.ts`, `search-terms.ts` |
| Q1/Q2 split | `keywords.Q1` / `keywords.Q2_fetchPurchaseKeywordTotals` / `searchTerms.Q1` / `searchTerms.Q2_fetchPurchaseSearchTermTotals` | `keywords.ts`, `search-terms.ts` |

Per-request `reqId` tag for log correlation. All logs grep-tagged `[perf-recon]`.

## Measurement — imaa cache-miss, force-fresh path (reqId `ijly9r`)

Preview build `arabiadash-43hu59q55`, observed via `vercel logs --expand`.

```
[perf-recon][ijly9r] adapter_init 1877ms provider=google

PASS 1 (parallel — actual wall time = max of leaves):
  google.fetchPurchaseAdTotals  602ms
  google.fetchAds               835ms
  google.pass1 TOTAL            836ms        (= max ✓ parallel)

PASS 2 (parallel — 4 fetches):
  google.fetchAssetUrls          0ms        (no-op, 0 resources)
  google.fetchAdExtensions     710ms
  google.fetchKeywords         950ms
    ├ keywords.Q1              579ms
    └ keywords.Q2 (merger)     949ms
  google.fetchSearchTerms     4900ms        ← LONGEST LEAF
    ├ searchTerms.Q1          4612ms        ← 90,347 raw GAQL rows
    └ searchTerms.Q2 (merger)  668ms
  google.pass2 TOTAL          4900ms        (= max ✓ parallel)

PASS 3 (parallel — PMax asset groups):
  google.fetchAssetGroupRows           519ms
  google.fetchAssetGroupAssets         543ms
  google.fetchPurchaseAssetGroupTotals 548ms
  google.pass3 TOTAL                   548ms (= max ✓ parallel)

normalizeAds (composite-key materialization) 1ms ads=6
google.getAds TOTAL 6285ms returnedAds=7 (RSA/RDA=6 PMax=1)

[perf-recon][ijly9r] adapter_getAds 6285ms  path=cache-miss ads_count=7
[perf-recon][ijly9r] cache_write    31921ms          ← 🚨 31.9 SECONDS
[perf-recon][ijly9r] payload_size=17955179B (17534KB) ads_count=7 total_keywords=211 total_search_terms=80951
[perf-recon][ijly9r] TOTAL 40917ms path=cache-miss
```

Second cache-miss reproduction (reqId `ng5iov`) measured 35,071ms — same shape, same payload, same 17.5 MB. The 30-40s range is consistent.

## Timing breakdown

| Stage | Duration (ms) | % of 41s |
|-------|--------------:|---------:|
| adapter_init | 1,877 | 4.6% |
| pass1 (fetchAds + fetchPurchaseAdTotals) | 836 | 2.0% |
| pass2 (urls + extensions + keywords + searchTerms) | 4,900 | 12.0% |
| pass3 (PMax asset groups) | 548 | 1.3% |
| normalizeAds (composite-key merge) | 1 | <0.1% |
| **adapter.getAds TOTAL** | **6,285** | **15.4%** |
| **🚨 cache_write (Supabase upsert)** | **31,921** | **78.0%** |
| route framework / network / serialization | ~711 | 1.7% |
| **route handler TOTAL** | **40,917** | **100%** |

## Hypothesis verdict

| | Hypothesis | Verdict | Notes |
|---|---|---|---|
| H1 | fetchSearchTerms is the longest fetch | ✅ Confirmed (4.9s) | But only 12% of wall time — not the headline |
| H2 | fetchPurchaseSearchTermTotals adds another long fetch | ❌ Refuted (668ms, parallel) | Negligible vs Q1 |
| H3 | Payload exceeds 5 MB causing serialize/transfer slowness | ⚠️ Half-true | 17.5 MB confirmed; serialization itself is fast; cascades into cache write |
| **H4** | **Cache write is slow due to large payload** | ✅ **CONFIRMED — primary cause** | **31.9s of 40.9s = 78%** |
| H5 | All of the above combined | Mostly H4 | Removing H4 drops total to ~9s; everything else acceptable |

## Root cause

Two contributing factors compound:

1. **Payload inflation via shared-reference serialization.** Per-ad_group data (search terms, keywords) is attached to each `UnifiedAd` via the SAME in-memory array reference. `JSON.stringify` does not deduplicate object references — each ad's `searchTerms` field is serialized in full. With 6 RSA ads in maybe 3-4 distinct ad_groups, ~14,000 unique terms inflate to 80,951 in the payload. Same mechanic for keywords (211 × 6 = 1,266 in payload vs 211 unique). The keyword case is small enough today that it didn't surface in M7.5 verification but the same bug class scales linearly with `ads × terms_per_ad_group`.

2. **Cross-region cache write.** Vercel US-East → Supabase Seoul → JSONB upsert of a 17.5 MB blob. Effective throughput ~550 KB/s. Network RTT plus PostgreSQL JSONB serialization plus the actual write all run serially. Even with a smaller payload the write isn't free, but 17.5 MB is well past the inflection point.

The two factors multiply: a 3 MB payload (post-dedup) at the same effective throughput would write in ~5-6s. A 17.5 MB payload at the same throughput is 32s. Removing the inflation alone removes most of the bottleneck even without changing the write infrastructure.

## Why this didn't surface in M7.5

M7.5 ship had a similar inflation pattern (keywords × ads). But the per-ad keyword count is ~50-200 keywords. 211 keywords × 6 ads × ~250 bytes per keyword JSON = ~315 KB. The cache write was ~1-2s on M7.5 ship — within noise floor.

M9 search terms changed the scale: imaa has ~14,000 search terms per ad_group (vs ~50-200 keywords). 14,000 × 6 ads × ~220 bytes = ~18 MB. Crossed the cache-write inflection point.

Memory #29 hindsight: "Saudi/Gulf ecommerce accounts typically run 5+ conversion actions" — the same persona profile implies thousands-to-tens-of-thousands of search terms per ad_group, not hundreds. M7.5's "looks fine on imaa" extrapolated to M9's per-ad_group scale produced the explosion.

## Recommended fix architecture

**Lazy-fetch both search terms and keywords on modal open.** Drop both from `/api/ads/creatives` payload entirely.

Why both, not just search terms:
- Search terms is the immediate fire (~17 MB blow-up today)
- Keywords is the latent bug class — fires on any future account with 5,000+ keywords (e.g. a large e-commerce catalog)
- Same architectural pattern; fixing only one leaves the other as a known-future-failure
- Industry convention: Google Ads UI itself lazy-loads both surfaces on click-in

Predicted post-fix timing:

| Stage | Pre-fix | Post-fix |
|-------|--------:|---------:|
| adapter_init | 1,877 | 1,877 |
| pass1 | 836 | 836 |
| pass2 | 4,900 | ~1,000 (drop searchTerms + keywords from parallel) |
| pass3 | 548 | 548 |
| getAds TOTAL | 6,285 | ~4,300 |
| cache_write (without 17 MB searchTerms) | 31,921 | ~1,000-2,000 |
| **route TOTAL** | **40,917** | **~7,000-8,000** |

~5× speedup on cache-miss. Cache-fresh becomes instant (no fetch at all).

Modal-open UX: one-time 4-5s spinner when user opens a modal (search terms fetch) + ~1s for keywords. Industry-standard pattern.

## Probe disposition

The `phase-4.8-m9-perf-recon` branch contains the instrumentation commit `b29e9f1`. Preserved as reference — instrumentation can be re-cherry-picked or re-applied if a future cache-write regression surfaces. Not merged to main; production code is clean.

## Decisions awaited

ADR-019 will codify:
1. Lazy-fetch pattern for both search terms and keywords
2. Two new endpoints (`/api/ads/search-terms`, `/api/ads/keywords`)
3. Cache v12 → v13 (UnifiedAd shape changes — remove eager fields)
4. SWR hooks for modal-open fetching
5. Memory entries for the JSON-shared-reference inflation pattern + the lazy-load-by-ad_group-scope pattern

See [`docs/decisions/019-lazy-load-ad-group-data.md`](../decisions/019-lazy-load-ad-group-data.md).
