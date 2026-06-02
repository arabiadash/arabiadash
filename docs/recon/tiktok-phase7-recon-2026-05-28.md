# Phase 7 TikTok Adapter — Initial Recon

**Date:** 2026-05-28
**Mode:** READ-ONLY — no code changes, no installs, no ADR draft
**Scope:** Inform ADR-020 design choices for a TikTok Marketing API adapter (Level 1 Basic + pixel conversions, Option B)
**Reference precedents:** Google adapter (ADR-005, M1-M9.1), Meta adapter (Phases 1-4)

---

## TL;DR

- **SDK recommendation: direct HTTP fetch (Option B), not the official SDK.** Mirrors the Meta adapter precedent (also no SDK). The official TikTok SDK is v1.0.1, 197 stars, "no releases published" on GitHub, JavaScript-only (no TypeScript types in package), 34 commits on main, MIT licensed but signals only moderate maintenance. Adding a thin in-house HTTP layer matches the existing Meta pattern and isolates the TikTok-specific surface to one file.
- **Schema-ready out of the box.** `AdProvider` type already includes `"tiktok"` literal ([cache.ts:113](../../src/lib/ads/cache.ts#L113)). `platform_credentials` + `connections` + `insights_cache` + `creatives_cache` are all `text` columns with no CHECK constraint and `tiktok` explicitly listed in column comments. **Zero DB migration needed.**
- **Conversion pattern matches Meta, NOT Google.** TikTok's pixel-based `complete_payment` metric is platform-native and returns directly from the Reporting endpoint — same shape as Meta's `omni_purchase` action_type. **No ADR-011 family merger needed.** No `conversion_actions` table for TikTok. Closer to MetaAdapter than GoogleAdsAdapter in this dimension.
- **Defensive architecture: pin v1.3 in config, wrap all calls in typed error helpers (ReauthRequiredError reuse from ADR-017), thin SDK-vs-Unified boundary layer (one file), graceful degradation if TikTok adapter fails entirely (Meta+Google unaffected).**
- **Saudi/Gulf TikTok market is huge.** 138% ad-reach penetration of 18+ adults at start of 2025; 95 min/day average use (highest in MENA, 30% above global average); 68% of Saudi consumers report purchasing after influencer exposure. TikTok ads are NOT optional for the Saudi e-commerce target persona — they're table-stakes.
- **Estimated scope: ~3 sessions to v1 ship.** ~600-800 LOC for OAuth + adapter + Reports tab + per-ad creative view + pixel conversions. Faster than Google (pattern known) but per-session harder (API instability).

---

## 1. SDK + API analysis

### 1.1 Official TikTok Business API SDK

| Signal | Value | Interpretation |
|--------|-------|----------------|
| Package | [`tiktok-business-api-sdk-official`](https://www.npmjs.com/package/tiktok-business-api-sdk-official) on npm | Available, official |
| Version | 1.0.1 | Brand new — single point release |
| GitHub | [tiktok/tiktok-business-api-sdk](https://github.com/tiktok/tiktok-business-api-sdk) | Public repo |
| Stars | 197 | Low |
| Releases published | None | ⚠️ No tagged releases — versioning unclear |
| Commits on main | 34 | Low activity |
| Open issues | 12 | Low but signals limited engagement |
| Language coverage | Java + Python + JavaScript | JS available, but TypeScript types NOT documented |
| TypeScript | "Not explicitly mentioned" | ⚠️ Likely no built-in `.d.ts` |
| License | MIT | OK |
| API versioning strategy | "Phased rollout, no explicit semver / deprecation policy" | ⚠️ Confirms the user's "aggressive versioning" concern |

**Verdict:** moderately maintained at best. No TypeScript types ships in the box. Locking onto SDK-internal types creates a tight coupling to a low-stability layer.

### 1.2 Integration approach scoring

| Approach | Stability vs API instability | TypeScript ergonomics | Bundle size | Maintenance burden when API changes |
|----------|-----------------------------:|----------------------:|------------:|-------------------------------------|
| **A. Official SDK** | 2/5 — SDK lags behind v1.3 changes per anecdotal reports; no TS types means we can't pin shapes | 1/5 — no types, all `any` at the boundary | Unknown (estimated 500KB-1MB) | 3/5 — SDK update path, but SDK might not have caught up |
| **B. Direct HTTP** *(recommended)* | 4/5 — we control every endpoint; no SDK middleman = no version lag risk | 4/5 — we own the response interfaces; same pattern as Meta adapter at [src/lib/meta/api.ts](../../src/lib/meta/api.ts) | ~0 KB | 3/5 — when fields/endpoints change, we edit one file; affected functions surface as TS errors |
| **C. Community SDK (`@quantum-forge/tik-tok-business-sdk`)** | 3/5 — has TS types per its npm listing, but smaller maintainer base than official | 3/5 — types present but coverage unclear | Unknown | 2/5 — relying on a single non-Tiktok-employee maintainer |

**Decision recommended: Option B (direct HTTP).** Three reasons:

1. **Pattern consistency** — Meta uses direct HTTP ([src/lib/meta/api.ts:38-58](../../src/lib/meta/api.ts#L38-L58) calls `fetch()` against Graph API directly). One file owns the boundary. Same pattern applies cleanly to TikTok.
2. **TypeScript ergonomics** — we define our own request/response interfaces with the exact shape we use, narrow to `UnifiedAd` at the boundary. No `any`.
3. **API instability isolation** — direct HTTP means breaking changes manifest as TypeScript errors in one file (`src/lib/tiktok/api.ts`) rather than dependency hell in `node_modules`.

Trade-off: the SDK provides some convenience (OAuth flow helpers, automatic retries). The OAuth code can be ~60 LOC by hand (we did this for Google already in [src/lib/google-ads/oauth.ts](../../src/lib/google-ads/oauth.ts)).

### 1.3 Core API endpoints needed for v1

Documented from public TikTok Marketing API docs:

```
Base URL:  https://business-api.tiktok.com/open_api/v1.3/

OAuth (one-time + refresh):
  GET  /portal/auth  (redirect to TikTok)
  POST /oauth2/access_token/  (auth_code → access_token + refresh_token)
  POST /oauth2/refresh_token/  (refresh access_token, valid 1 year of refresh_token lifetime)

Account discovery:
  GET  /oauth2/advertiser/get/  (list authorized advertiser_ids)

Hierarchy fetch:
  GET  /campaign/get/  (campaigns for advertiser_id)
  GET  /adgroup/get/   (adgroups for advertiser_id + campaign_ids filter)
  GET  /ad/get/        (ads for advertiser_id + adgroup_ids filter)

Performance reporting (the main spend/impressions/clicks/conversions endpoint):
  POST /report/integrated/get/
    body: { advertiser_id, report_type: "BASIC", data_level: "AUC_AD", dimensions: ["ad_id","stat_time_day"], metrics: [...], start_date, end_date }
    metrics we need: spend, impressions, clicks, ctr, cpc, cpm, reach, frequency, complete_payment, complete_payment_roas, total_purchase_value, value_per_complete_payment, cost_per_complete_payment

Creative metadata:
  Same /ad/get/ response includes creative_material (video_id, image_ids) + ad_name + status + objective_type
  Video thumbnail resolution (separate query):
  POST /file/video/ad/info/  with video_ids — returns poster_url for each
```

Reports endpoint accepts up to 30-day windows per call; pagination via `page` + `page_size` (max 1000). Rate limit: 600 requests/min/advertiser (gentle vs Google's stricter quotas).

---

## 2. Architectural fit

### 2.1 Existing adapter pattern

Read: [src/lib/ads/providers/meta.ts](../../src/lib/ads/providers/meta.ts), [src/lib/ads/factory.ts](../../src/lib/ads/factory.ts), [src/lib/ads/types.ts](../../src/lib/ads/types.ts).

The `AdProviderAdapter` interface ([types.ts:838-878](../../src/lib/ads/types.ts#L838-L878)) is the contract:

```typescript
interface AdProviderAdapter {
  readonly provider: AdProvider;
  getCampaigns(): Promise<UnifiedCampaign[]>;
  getAccountInsights(range, timeIncrement?): Promise<UnifiedInsight[]>;
  getCampaignInsights(range, timeIncrement?): Promise<UnifiedInsight[]>;
  getAccount(): Promise<UnifiedAccount>;
  getAds(range): Promise<UnifiedAd[]>;
  // Optional (ADR-019 / Google-only currently):
  getSearchTermsForAdGroup?(adGroupId, range): Promise<UnifiedAdSearchTerm[]>;
  getKeywordsForAdGroup?(adGroupId, range): Promise<UnifiedAdKeyword[]>;
}
```

`AdProvider = "meta" | "google" | "tiktok" | "snapchat"` already declares `tiktok` ([cache.ts:113](../../src/lib/ads/cache.ts#L113)).

`factory.ts` resolves the provider → adapter via a `switch` over `provider`. Adding a new case is ~10 LOC pattern-identical to the Meta case (lines 82-95). TikTok will fit the same shape.

### 2.2 UnifiedAd shape applicability to TikTok

| Field | TikTok mapping | Notes |
|-------|----------------|-------|
| `id` | `ad_id` from /ad/get/ | direct |
| `name` | `ad_name` | direct |
| `ad_type` | New literal `TIKTOK_AD` | Add to `AdType` discriminated union |
| `accountId` | `advertiser_id` | direct (stamped by hook) |
| `currency` | from advertiser endpoint | direct |
| `status` | `secondary_status` collapsed to ACTIVE/PAUSED/DELETED | Per existing precedent in google.ts:`computeEffectiveAdStatus` |
| `campaignId` / `campaignName` | from /campaign/get/ | direct |
| `adsetId` / `adsetName` | TikTok's "adgroup" maps to the unified `adset` concept | direct, terminology divergence handled at boundary |
| `spend` / `impressions` / `clicks` / `ctr` / `cpc` | direct from /report/integrated/get/ | direct |
| `purchases` | `complete_payment` metric | platform-native — NO merger needed |
| `revenue` | `total_purchase_value` metric | platform-native |
| `roas` | `complete_payment_roas` OR derived `revenue / spend` | direct |
| `hasConversionData` | `true` if pixel configured AND `complete_payment_setup_status` != null, else `false` | Mirror Meta's "always true if pixel set" semantic with one TikTok-specific check |
| `extensions` | N/A | TikTok doesn't have asset extensions in the Google sense; leave undefined |
| **Variant `type_data`** | New variant `TIKTOK_AD: { videoUrl, posterUrl, objective_type, callToAction }` | Discriminated union extension |

**Per-platform divergences already handled cleanly:** the discriminated-union variant pattern (`META_AD` / `RSA` / `RDA` / `PMAX_ASSET_GROUP` / `IMAGE_AD`) extends with `TIKTOK_AD` without disrupting existing variants. Pattern proven across Google + Meta.

The optional lazy fetch methods (`getSearchTermsForAdGroup` / `getKeywordsForAdGroup`) added in ADR-019 stay Google-only — TikTok doesn't have the equivalent surfaces (no keyword targeting in TikTok's pixel-based attribution model).

### 2.3 Specific questions answered

**Q: How does Meta handle pixel conversions today? Same pattern works for TikTok?**

A: YES. Meta's [metrics.ts](../../src/lib/meta/metrics.ts) reads `omni_purchase` directly from the `actions` array on each ad. The platform pre-aggregates per-pixel. No client-side cache table needed. TikTok's `complete_payment` metric works identically — returned by /report/integrated/get/ in the same response as spend. Both are platform-native attribution.

**Q: Does TikTok have an equivalent to Google's "conversion actions" (ADR-011 family) or Meta's "action types"?**

A: Closer to Meta. TikTok exposes a `complete_payment` metric directly (no action-type discrimination needed — pixel events configured at advertiser level are aggregated server-side). No `tiktok_conversion_actions` cache table needed. ADR-011 family DOES NOT extend to TikTok.

**Q: TikTok ad hierarchy: Advertiser → Campaign → AdGroup → Ad. How does this map to UnifiedAd?**

A: Cleanly. TikTok "adgroup" = `adsetId`/`adsetName` in UnifiedAdCommon. TikTok "advertiser" = `accountId` (stamped by `useProviderAds` hook). Identical 4-tier hierarchy to Meta (Ad Account → Campaign → AdSet → Ad).

**Q: Multi-account: Same /select pattern from Google/Meta?**

A: YES. TikTok's `/oauth2/advertiser/get/` returns all authorized advertiser_ids in one call (similar to Meta's `/me/adaccounts`). User runs through the same selector flow at `/dashboard/connections/tiktok/select`. No new pattern needed.

---

## 3. Defensive architecture (for known API instability)

### 3.1 Defensive patterns to apply from day 1

| Pattern | Implementation |
|---------|----------------|
| **API version pinned in config** | `const TIKTOK_API_VERSION = "v1.3"` in single source-of-truth file. Mirrors Meta's `META_API_VERSION` at [src/lib/meta/oauth.ts](../../src/lib/meta/oauth.ts) |
| **All SDK/HTTP calls wrapped in typed error helper** | Centralized `tiktokFetch()` helper handles auth, retries, error classification — one place to add v1.4 logic later |
| **Graceful degradation** | If TikTok adapter throws unhandled, factory.ts returns `null` for that provider; Meta+Google continue working. Already the existing pattern. |
| **Logging per perf-recon precedent** | Every TikTok HTTP call logged with timing under `[tiktok-api]` tag. Reusable for Phase 7+ debugging. |
| **Error classification** | Same 3-class taxonomy used everywhere: REAUTH_REQUIRED (ADR-017 reuse), RATE_LIMITED (Meta precedent), TRANSIENT (retry up to 2x) |

### 3.2 ReauthRequiredError reuse

Already designed in ADR-017 to be provider-agnostic:

```typescript
export class ReauthRequiredError extends Error {
  readonly provider: "google";  // ← extend to "google" | "meta" | "tiktok"
  readonly reason: ReauthReason;
  readonly reauthUrl: string;
}
```

One-line widening of the `provider` discriminator. `classifyTiktokError(err)` mirrors `classifyGoogleAdsError(err)` from [src/lib/google-ads/errors.ts](../../src/lib/google-ads/errors.ts). Same `[reauth-classification]` log surface. Existing `isReauthError` type guard works unchanged.

### 3.3 Plan for API breakage

**The thin-boundary architecture:**

```
TikTok API (v1.3)
       ↓
src/lib/tiktok/api.ts  ← thin HTTP layer. Returns TikTok-shape responses.
                          ONE FILE owns all v1.3 endpoint details.
                          When v1.4 ships: this file changes; everything else stable.
       ↓
src/lib/tiktok/normalize.ts  ← TikTok-shape → UnifiedAd / UnifiedInsight.
                                Maps `complete_payment` → `purchases`,
                                `total_purchase_value` → `revenue`, etc.
                                Insulates the rest of app from breaking shape changes.
       ↓
src/lib/ads/providers/tiktok.ts  ← TikTokAdapter implements AdProviderAdapter.
                                    Calls normalize.ts to populate Unified shapes.
       ↓
factory.ts switch case → adapter consumers (routes, hooks, UI)
                          all use UnifiedAd — no TikTok knowledge.
```

**When v1.3 deprecates → v1.4 ships:**
1. Read the changelog.
2. Bump `TIKTOK_API_VERSION` in config.
3. Patch `src/lib/tiktok/api.ts` field paths.
4. Run integration probes against a real advertiser account.
5. Done. No other file changes.

**Upgrade-path cost estimate:** 1-2 sessions per major version bump if breaking changes are moderate.

---

## 4. Phase 7 scope lock (v1 = Level 1 Basic + pixel conversions)

### MUST HAVE (v1 ship)

| Feature | Source | Est. LOC |
|---------|--------|---------:|
| OAuth flow (init → callback → token exchange) | `/api/auth/tiktok/init/route.ts` + `/callback/route.ts` | 100 |
| Account selection page (`/dashboard/connections/tiktok/select`) | New page + selector component | 120 |
| Account discovery endpoint | `/api/auth/tiktok/discover/route.ts` (lists accessible advertiser_ids) | 60 |
| TikTokAdapter implementing AdProviderAdapter | `src/lib/ads/providers/tiktok.ts` | 200 |
| TikTok HTTP layer + types | `src/lib/tiktok/api.ts` | 250 |
| TikTok normalize layer | `src/lib/tiktok/normalize.ts` | 100 |
| TikTok OAuth helpers | `src/lib/tiktok/oauth.ts` | 80 |
| Type extensions (UnifiedAd `TIKTOK_AD` variant + AdType literal) | `src/lib/ads/types.ts` | 30 |
| Factory case | `src/lib/ads/factory.ts` | 20 |
| Reports tab integration ("TikTok" tab in ReportsClient.tsx) | `src/app/dashboard/reports/ReportsClient.tsx` | 80 |
| Per-ad video creative card (video thumbnail + name + metrics) | New `TikTokCreativeCard` component | 80 |
| Cross-platform Top KPI cards include TikTok | Dashboard mirror logic | 30 |
| **Total v1** | | **~1,150 LOC** |

### NICE TO HAVE (deferred to v2+)

| Feature | Deferral reason |
|---------|-----------------|
| Per-video hashtag analytics | Requires separate `/hashtag/` endpoint family; nice-to-have for Saudi audience analysis but not v1 |
| Audience demographics | Same advertiser API surface; defer to dedicated audience-insights feature |
| Spark Ads (boosted organic) | Different post-graph integration; separate scope |
| TikTok Shop | Completely different API (Shop Partner API, not Marketing API); Phase 9.5 candidate |
| Saved audiences management | Write-back surface — requires new OAuth scope + Google-Verification-style review |

### Estimated LOC: ~1,150 (v1)

Compare to:
- Google M1 baseline (initial adapter): ~800 LOC
- M5-M9 cumulative additions: ~3,000 LOC
- TikTok v1 estimate is between Google M1 and M5 in absolute size — heavier than Google M1 because of the video creative + pixel conversion surface, lighter than mature Google because no Search Terms / Keywords / PMax / Conversion Actions complexity.

---

## 5. Database schema readiness

**All four critical tables are ALREADY platform-agnostic.** No migration needed.

| Table | Column | Constraint | TikTok-ready? |
|-------|--------|------------|:-:|
| `platform_credentials` | `platform text NOT NULL` | No CHECK | ✅ |
| `connections` | `platform text NOT NULL` | No CHECK | ✅ |
| `insights_cache` | `provider text NOT NULL DEFAULT 'meta'` | No CHECK; comment lists tiktok | ✅ |
| `creatives_cache` | `provider text` | No CHECK | ✅ |

Migration [20260509150000_refactor_to_multi_platform.sql:75-76](../../supabase/migrations/20260509150000_refactor_to_multi_platform.sql#L75-L76) explicitly documents:

> `COMMENT ON TABLE insights_cache IS 'Generic cache for ad platform API responses (Meta, Google, TikTok, etc.)';`
> `COMMENT ON COLUMN insights_cache.provider IS 'Ad platform name: meta, google, tiktok, snapchat, etc.';`

`google_conversion_actions` is Google-specific (ADR-011 family) — TikTok does NOT need an equivalent. Pixel conversions arrive pre-aggregated via the `complete_payment` metric (no client-side action-mapping table).

**Verdict:** zero DB work. Drop in new TikTok adapter + write rows like any other provider.

---

## 6. Saudi/Gulf market context

### 6.1 Market size + behavior

| Signal | Value | Implication |
|--------|------:|-------------|
| TikTok ad-reach penetration of Saudi 18+ adults (early 2025) | 138.2% | Higher than the adult population due to multi-account / measurement methodology — effectively saturated |
| Saudi TikTok daily usage | 95 min/day | Highest in MENA, +30% vs global avg |
| Consumers reporting purchase after influencer exposure | 68% | TikTok is a primary conversion driver, not just brand awareness |
| Middle East advertising market size (2025) | USD 8.44 B | Large absolute market |
| Saudi Online Advertising + Marketing SaaS market | USD 1.2 B | Specific addressable market |
| High-ROI categories on Saudi TikTok | E-commerce (fashion/beauty/electronics), F&B, automotive, real estate | All match imaa + likely-future customer profile |

**Verdict for product:** TikTok ads are NOT optional in Saudi e-commerce. Adding TikTok support shifts the product from "Meta+Google ads dashboard" to "complete Saudi e-commerce ads dashboard." This is a customer-acquisition fundamental, not a feature.

### 6.2 Currency support

TikTok ad accounts in Saudi market most commonly operate in **USD** (default for international advertisers) or **SAR** (local accounts). The `complete_payment_roas` metric is computed in the advertiser's reporting currency.

Existing app-level FX conversion ([formatAndConvert](../../src/lib/currency.ts)) already handles USD↔SAR with the SAR=3.75 USD peg. TikTok's currency reads from the advertiser endpoint and stamps `UnifiedAdCommon.currency` (existing pattern from M5 Commit 1B). **No new currency handling needed.**

### 6.3 Localization

- **Arabic content support:** TikTok ad creative metadata (ad_name, video captions) supports Arabic UTF-8 — empirically widespread in Saudi TikTok ads. Existing RTL handling in [src/app/layout.tsx](../../src/app/layout.tsx) (`dir="rtl"`) covers display.
- **Saudi-specific ad regulations:** GCMC (General Commission for Audiovisual Media) regulates content but does not impose ad-format restrictions on TikTok specifically — the existing creative-rendering surface needs no Saudi-specific code path.

---

## 7. Phase 7 scope + risk estimate

### Sessions to ship

| Phase | Estimate | Comparable to |
|-------|---------:|---------------|
| v1 ship (OAuth + adapter + Reports tab + per-ad creative + pixel conversions) | **~3 sessions** | Google M1-M2 (~5 sessions, but TikTok faster — pattern known) |
| v2 (per-video analytics, audience demographics, deeper conversion attribution) | ~2-3 more sessions | M3-M5 size |
| v3+ (Spark Ads, TikTok Shop, saved audiences write-back) | ~5+ sessions, spread across milestones | Phase 9 territory |

### Top 3 risks + mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | **TikTok API breaking change mid-development** (v1.3 → v1.4 announce-then-deprecate cycle, ~3 months typical) | Thin-boundary architecture (§3.3). Single `tiktok/api.ts` file owns all endpoint details. v1.4 = patch one file. |
| 2 | **Pixel conversion attribution differs from Saudi customer expectations** (e.g., user expects in-app TikTok Shop purchases, gets only pixel events) | Stay in scope: v1 = pixel only. Document the "pixel-tracked purchases only" scope in UI tooltip. Shop API is a separate Phase 9.5. |
| 3 | **OAuth scope drift / app review** (TikTok may require app-review for production scopes, similar to Google Verification) | Apply for app review BEFORE the Saudi launch. Pre-launch with `Sandbox` scope. Document this gate clearly in the ADR. Mirror Google Verification timeline expectations (Phase B, deferred to public launch). |

### Maintenance burden

- **Predicted:** 4-8 hours/month average, spiking to 15-20 hours/month during a v1.X→v1.Y migration (every ~6-9 months estimated).
- **Below the "10-15 hours/month" anecdotal range** because we don't use the SDK (no SDK update path) and we keep the boundary thin.
- **Below Google's current burden** (Google's complexity comes from the discriminated-union variants + ADR-011 family + asset_group / asset_extension / keyword / search_term surfaces).

---

## 8. Open questions blocking ADR-020 draft

| # | Question | Recommended answer |
|---|----------|--------------------|
| 1 | **SDK vs direct HTTP?** | **Direct HTTP (Option B)** — matches Meta precedent; isolates breakage; better TypeScript |
| 2 | **API version pinning** | Pin to `v1.3` in config; ADR codifies the upgrade-path protocol |
| 3 | **Conversion handling — extend ADR-011 family OR mirror Meta `omni_purchase` pattern?** | **Mirror Meta.** No `tiktok_conversion_actions` table. `complete_payment` metric is platform-native and pre-aggregated. |
| 4 | **`UnifiedAd` `TIKTOK_AD` variant `type_data` shape** | `{ videoUrl, posterUrl, objective_type, callToAction }` — minimum surface for the per-ad video card |
| 5 | **Multi-account flow** | Mirror Google: OAuth → `/select` page → user picks advertiser_ids → upsert to `connections` |
| 6 | **DB schema bumps required?** | **NO.** All four tables are platform-agnostic (§5). Zero migrations needed. |
| 7 | **Cache version bump?** | **YES — v13 → v14** when `UnifiedAd.ad_type` literal expands. Memory #28 protocol applies (8th iteration). |
| 8 | **Reports tab integration scope** | Add "TikTok" tab with its own per-account selector + KPI cards + creative grid. Same shell as Google tab. |
| 9 | **Sessions commitment** | 3 sessions for v1 (OAuth + adapter + Reports + creative + pixel). Lock the scope at Level 1 Basic. |
| 10 | **Currency / FX handling** | Existing `formatAndConvert` handles USD↔SAR. TikTok advertiser endpoint stamps `currency` field — no new code path. |
| 11 | **Defensive architecture commitments** | (a) Thin api.ts boundary (b) Pinned version (c) Typed error classification (d) ReauthRequiredError reuse with widened `provider` discriminator (e) Graceful degradation in factory.ts |
| 12 | **App review / sandbox** | Start in TikTok Sandbox for development; apply for production scope before Saudi launch. Document in ADR §Open Items as a launch-prep gate. |
| 13 | **Probe disposition** | New `scripts/_tiktok-oauth-probe.mjs` for OAuth flow validation; new `scripts/_tiktok-report-shape.mjs` for /report/integrated/get/ shape verification. Disposition-B preserve both per M-* precedent. |

**Note on ADR-020 timing:** the user instructed "DO NOT draft ADR-020 yet." Stand by for resolutions on the 13 questions above before drafting.

---

## Sources

- [TikTok Business API SDK GitHub](https://github.com/tiktok/tiktok-business-api-sdk) — official SDK signals
- [tiktok-business-api-sdk-official npm](https://www.npmjs.com/package/tiktok-business-api-sdk-official) — package details
- [@quantum-forge/tik-tok-business-sdk npm](https://www.npmjs.com/package/@quantum-forge/tik-tok-business-sdk) — community TS SDK alternative
- [TikTok API v1.3 Change Log](https://business-api.tiktok.com/portal/docs/change-log/v1.3) — versioning evidence
- [TikTok for Developers Changelog](https://developers.tiktok.com/doc/changelog) — release cadence
- [TikTok Marketing in Saudi Arabia 2026 — Hovi Digital Lab](https://thehovi.com/blog/industry-guides/tiktok-marketing-saudi-arabia-business-guide-2026) — Saudi penetration data
- [DataReportal: Digital 2025 Saudi Arabia](https://datareportal.com/reports/digital-2025-saudi-arabia) — 138% ad-reach figure, 95min daily usage
- [Middle East Advertising Market Report 2034](https://www.marketdataforecast.com/market-reports/middle-east-advertising-market) — market size
- Production-code precedents: [meta.ts adapter](../../src/lib/ads/providers/meta.ts), [google.ts adapter](../../src/lib/ads/providers/google.ts), [factory.ts](../../src/lib/ads/factory.ts), [types.ts](../../src/lib/ads/types.ts)
