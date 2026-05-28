# Phase 7 TikTok — Session 2 implementation plan

**Date:** 2026-05-29 (drafted same-day as Session 1 push)
**Status:** Plan — implementation BLOCKED on TikTok app approval (Issue #43)
**Scope:** Reports tab integration + creatives view + KPI strip + pixel conversions
**Related:** ADR-020 §Implementation Plan Session 2 + §Decision 16-17 (perf/error patterns)

---

## TL;DR

- Session 2 implements `/report/integrated/get/`, `/campaign/get/`, `/adgroup/get/`, `/ad/get/`, `/file/video/ad/info/` against TikTok Marketing API v1.3.
- Creates `src/lib/tiktok/normalize.ts` — the TikTok-shape → UnifiedAd transform layer.
- Wires the adapter scaffold (`providers/tiktok.ts`) from "returns []" into actual fetchers.
- Adds TikTok branch to `/api/ads/{insights,creatives}` route handlers.
- Adds TikTok tab + `TikTokCreativeCard` to `ReportsClient.tsx`.
- **Hard dependency gate** (recon §7 below): probes MUST run + verify the real API shapes before any fetcher code is written. Blind implementation from public docs is rejected per M8/M9 integer-drift + composite-key lessons.

**LOC estimate (revised honestly from Session 1's +98% overrun):** ~1,500-1,800 LOC. Session 1's selector matched Google's full UX richness; Session 2's TikTok tab + creative card will likewise match the existing CreativeCard's full feature set (date range / sort / filter / pagination).

---

## 1. The exact TikTok API calls needed

### 1.1 `/report/integrated/get/` — performance reporting endpoint

Per public TikTok docs (verify via probe before implementing):

```
Method: GET (yes, GET — TikTok's reporting endpoint uses query params)
Path:   /report/integrated/get/
Auth:   Access-Token header
```

**Required query params:**

| Param | Value | Notes |
|-------|-------|-------|
| `advertiser_id` | The bare numeric advertiser_id | From `connections.account_id` |
| `report_type` | `"BASIC"` | "AUDIENCE" exists but not in v1 scope |
| `data_level` | `"AUC_AD"` for per-ad data; `"AUC_ADVERTISER"` for account-level; `"AUC_CAMPAIGN"` for per-campaign | Three calls for the three adapter methods |
| `dimensions` | JSON-encoded array: `["ad_id"]` for AUC_AD, `["advertiser_id"]` for AUC_ADVERTISER, `["campaign_id"]` for AUC_CAMPAIGN. Add `["stat_time_day"]` to a dimensions array if doing per-day breakdown (e.g. `["ad_id", "stat_time_day"]`) | TikTok requires JSON-string encoding |
| `metrics` | JSON-encoded array of metric names (see §1.2) | TikTok requires JSON-string encoding |
| `start_date` | `"YYYY-MM-DD"` | Verify format via probe — TikTok docs are inconsistent across versions |
| `end_date` | `"YYYY-MM-DD"` | Same |
| `page` | 1-indexed integer | TikTok uses page+page_size, NOT cursor |
| `page_size` | Up to 1000 | Default 10 — must override |

**Response shape (per docs, MUST verify via probe):**

```json
{
  "code": 0,
  "message": "OK",
  "data": {
    "list": [
      {
        "metrics": {
          "spend": "123.45",
          "impressions": "10000",
          "clicks": "150",
          "ctr": "1.5",
          "cpc": "0.82",
          "cpm": "12.35",
          "complete_payment": "5",
          "total_purchase_value": "850.00",
          "complete_payment_roas": "6.88",
          "video_views": "8500"
        },
        "dimensions": {
          "ad_id": "1801234567890",
          "stat_time_day": "2026-05-29 00:00:00"
        }
      }
    ],
    "page_info": {
      "page": 1,
      "page_size": 100,
      "total_number": 234,
      "total_page": 3
    }
  }
}
```

### 1.2 Metric → UnifiedInsight / UnifiedAd field mapping

| TikTok metric (string!) | Unified field | Conversion notes |
|--------------------------|---------------|-------------------|
| `spend` | `UnifiedAd.spend` / `UnifiedInsight.spend` | `parseFloat()` — TikTok returns all metrics as strings (matches Meta pattern) |
| `impressions` | `.impressions` | `parseInt()` |
| `clicks` | `.clicks` | `parseInt()` |
| `ctr` | `.ctr` | `parseFloat()` — already a percentage (1.5 = 1.5%, not 0.015). VERIFY with probe — Google returns 0-1 ratio, Meta returns 0-100 percentage |
| `cpc` | `.cpc` | `parseFloat()` — in advertiser currency |
| `cpm` | (TBD — not in UnifiedAd today, drop or add) | Defer to v2 if not present |
| `complete_payment` | `.purchases` | `parseFloat()` — pixel-attributed purchases per ADR-020 §Decision 2 |
| `total_purchase_value` | `.revenue` | `parseFloat()` — in advertiser currency |
| `complete_payment_roas` | `.roas` (or compute as revenue/spend) | If TikTok returns `null` / `0` when no purchases, compute client-side |
| `video_views` | `UnifiedAdTiktok.type_data.videoViews` | `parseInt()` — TikTok-native view count, differs from impressions |

**`hasConversionData` derivation** per ADR-020 §Decision 2:
- If advertiser has pixel configured (need to verify per /pixel/list/ probe in Session 3) → `hasConversionData = true`
- If `complete_payment_setup_status` field exists on report rows → use that
- Fallback: if `complete_payment` is non-null in response → `true`; else `false`

### 1.3 `/campaign/get/` — campaign metadata

```
Method: GET
Path:   /campaign/get/
Params: advertiser_id, fields=["campaign_id","campaign_name","status","objective_type",...]
```

Returns campaign metadata. Combined with `/report/integrated/get/` (AUC_CAMPAIGN data_level) for full per-campaign UnifiedInsight rows.

### 1.4 `/ad/get/` — ad metadata + creative_material

```
Method: GET
Path:   /ad/get/
Params: advertiser_id, fields=["ad_id","ad_name","status","creative_material","campaign_id","adgroup_id","operation_status","secondary_status","call_to_action","landing_page_url",...]
```

Critical: `creative_material` is the structure that carries `video_id`, `image_ids`, `ad_format`. Verify via probe — this is the highest-risk shape change vector for video-ad surfaces.

### 1.5 `/file/video/ad/info/` — video metadata + poster_url

```
Method: POST (yes, POST despite being a fetch — TikTok inconsistency)
Path:   /file/video/ad/info/
Body:   { advertiser_id, video_ids: [...] }
```

Returns `poster_url` for each video_id. The `TikTokCreativeCard` uses this for the static thumbnail. Per ADR-020 §Decision 11, NO iframe embed; just an external "View on TikTok" link.

### 1.6 `/oauth2/refresh_token/` — token refresh

Already implemented in `tiktok/oauth.ts` as `refreshTiktokAccessToken` but **never called** (see Code Review §CRITICAL #1). Session 2 wires it into a `getAccessTokenForUser()` helper that runs before every API call (since the refresh_token cannot be used directly on report/ad/campaign endpoints — those require the 24h access_token).

---

## 2. normalize.ts mapping plan

`src/lib/tiktok/normalize.ts` is the **isolation layer** per ADR-020 §Decision 6 — when v1.4 changes shapes, this is the second file (after api.ts) to patch.

**Shape:**

```typescript
// All inputs are TikTok-native (the api.ts return shapes).
// All outputs are UnifiedAd / UnifiedInsight from src/lib/ads/types.ts.

export function normalizeTiktokReportRowToInsight(
  row: TiktokReportRow,
  context: { dateFrom: string; dateTo: string; currency: string; level: "account" | "campaign" }
): UnifiedInsight;

export function normalizeTiktokAdToUnified(
  ad: TiktokAd,                                          // /ad/get/ row
  reportMetrics: TiktokAdMetrics | undefined,            // /report/integrated/get/ row (joined by ad_id)
  videoInfo: TiktokVideoInfo | undefined,                // /file/video/ad/info/ entry (joined by video_id)
  context: { currency: string }
): UnifiedAd;  // returns UnifiedAdTiktok variant
```

**Join keys (verify via probe):**

- `report.dimensions.ad_id` ↔ `ad.ad_id`
- `ad.creative_material.video_id` ↔ `videoInfo.video_id`
- `ad.campaign_id` → already present, no join needed for parent context
- `ad.adgroup_id` → maps to `UnifiedAdCommon.adsetId`

**Currency handling per ADR-020 §10.2:**

TikTok reports in the advertiser's currency (`connections.metadata.currency` populated at select-accounts time). `UnifiedAdCommon.currency` is stamped per-ad from `accountInfo.currency` passed into the adapter constructor. Existing `formatAndConvert` handles USD↔SAR via the 3.75 peg. No new currency code path.

**Status mapping** (verify via probe — TikTok status enums may shift):

| TikTok `operation_status` / `secondary_status` | UnifiedAdCommon.status |
|------------------------------------------------|------------------------|
| `STATUS_DELIVERY_OK` / `STATUS_ENABLE` / `ADVERTISER_AUDIT_APPROVE` | `ACTIVE` |
| `STATUS_DISABLE` / `STATUS_FROZEN` / any `PAUSED`-suffix | `PAUSED` |
| `STATUS_DELETE` | `DELETED` |
| Anything unrecognized | `PAUSED` (conservative default) |

---

## 3. Probe scripts that MUST run FIRST

Per ADR-020 §Decision 15 + the M8/M9 integer-drift precedent, blind implementation from docs is **rejected**. Probes verify the real API shapes against TikTok Sandbox before fetcher code is written.

### Probe 1 — `scripts/_tiktok-report-shape.mjs` (CRITICAL)

Verifies `/report/integrated/get/` actual response shape against the user's sandbox advertiser. Specifically:

1. **Does TikTok return metrics as strings or numbers?** Meta returns strings (requires `parseFloat`); Google returns numbers. TikTok docs imply strings but the probe is the truth.
2. **What's the actual CTR scale?** 0-1 (Google) or 0-100 (Meta)? Affects normalize.ts multiplier.
3. **Date range format** — `"2026-05-29"` (YYYY-MM-DD) or Unix timestamp? Verify the parameter format that yields non-empty results.
4. **Does `complete_payment` come back even when 0?** Affects `hasConversionData` derivation.
5. **`video_views` availability** — is it always returned for video ads, or only when objective_type is VIDEO_VIEWS?
6. **Pagination** — confirm cursor vs page+page_size; confirm `total_number` field semantics.
7. **Rate-limit error format** — trigger one (call the endpoint in a tight loop) to confirm code 40100 actual response shape.
8. **Empty data response shape** — what does the response look like for an advertiser with zero ad spend in the date range?

### Probe 2 — `scripts/_tiktok-creative-probe.mjs` (CRITICAL)

Verifies `/ad/get/` + `/file/video/ad/info/` shapes:

1. **`creative_material` structure** — is it nested object or array? What fields are present for video ads vs image ads vs carousel?
2. **`video_id` field path** — `creative_material.video_id` or `creative_material.material_ids[]`?
3. **`/file/video/ad/info/` response shape** — does it return `poster_url` directly or a more deeply nested path?
4. **Multi-video ads** — TikTok supports carousel video ads; how does `creative_material` represent multiple videos?
5. **External video URL** (`share_url`) availability — needed for "View on TikTok" link per ADR-020 §Decision 11.
6. **`call_to_action` enum values** — verify they're string literals or integer enums (integer-drift risk per M8/M9).

### Probe 3 (Session 3) — `scripts/_verify-tiktok-conversion-attribution.mjs`

Validates pixel conversion attribution matches user's expected ground truth. Same pattern as M7.5 + M9 verification probes (`±5%` revenue tolerance against recon baseline).

**These probes are non-negotiable.** No fetcher code writes happen before all 3 pass.

---

## 4. Known unknowns (things the probe MUST answer)

| Unknown | Risk if wrong | Probe answers it via |
|---------|---------------|---------------------|
| String vs number metric format | Off-by-100 errors in spend / silent zeros | Inspect a sample response |
| CTR scale (0-1 vs 0-100) | UI shows "1.5%" vs "0.015%" | Compare 1 known-good ad against TikTok dashboard |
| Date format | Empty results / 400 errors | Try both formats |
| Pagination scheme | Missed data on large accounts | Request `page=1` and check `page_info` |
| Rate-limit response code | Error classification fails | Hammer the endpoint until 40100 fires |
| `complete_payment` always-returned vs conditional | Wrong `hasConversionData` flag | Inspect a sample with + without pixel |
| `video_views` availability | TikTokCreativeCard shows "—" wrongly | Inspect a video-objective ad |
| `creative_material` shape | TikTokCreativeCard can't extract video_id | Walk the structure manually |
| `/file/video/ad/info/` parameter shape | Poster URL missing | Try the documented body shape, inspect response |
| Status enum drift (operation_status vs secondary_status) | Wrong "Active" / "Paused" badges | Cross-reference 1 enabled + 1 paused ad |
| call_to_action format (string vs int) | Wrong CTA labels in modal | Inspect a sample |

---

## 5. Session 2 file plan with LOC estimates

**Calibration note:** Session 1 estimate was 795 LOC, actual was 1,570 LOC (+98%). Applying a +50% safety margin to all estimates below + matching Session 1's "match Google's full feature richness" UX bar.

| File | Action | Honest estimate |
|------|--------|----------------:|
| `src/lib/tiktok/api.ts` | EXTEND — add `getCampaigns`, `getAdGroups`, `getAds`, `getReport`, `getVideoInfo`, `getAccessTokenForUser` helpers | +400 |
| `src/lib/tiktok/normalize.ts` | NEW — transform layer (`normalizeTiktokReportRowToInsight`, `normalizeTiktokAdToUnified`, status mapper, currency stamper) | +300 |
| `src/lib/ads/providers/tiktok.ts` | EXTEND — fill in `getCampaigns`, `getAccountInsights`, `getCampaignInsights`, `getAds` stubs. Wire api.ts + normalize.ts via Promise.all. Add `withReauthMapping` wrap points. | +250 |
| `src/app/api/ads/insights/route.ts` | EXTEND — no change to TikTok handling specifically (provider switch already routes via factory). Verify factory case for tiktok works end-to-end. | +0-20 |
| `src/app/api/ads/creatives/route.ts` | EXTEND — same | +0-20 |
| `src/components/creatives/TikTokCreativeCard.tsx` | NEW — 9:16 aspect ratio component with poster + play overlay + perf footer | +220 |
| `src/app/dashboard/reports/ReportsClient.tsx` | EXTEND — new "TikTok" tab with selector + cards grid + KPI strip wiring. Mirror Google tab structure. | +280 |
| `scripts/_tiktok-report-shape.mjs` | NEW probe (CRITICAL) | +250 |
| `scripts/_tiktok-creative-probe.mjs` | NEW probe (CRITICAL) | +200 |
| **Total Session 2 estimate** | | **~1,920 LOC** |

LOC estimate revised honestly from ADR-020's original ~932. Including probes (which technically commit in Session 3's chore) brings us to ~1,920.

---

## 6. Cross-cutting Session 2 patterns to honor

### 6.1 Per-API-call refresh pattern

Per Code Review §CRITICAL #1 (this doc § 9 below), every API call in Session 2 must first refresh the access_token. Pattern:

```typescript
// In src/lib/tiktok/api.ts
export async function getAccessTokenForUser(
  adminClient: SupabaseClient<Database>,
  userId: string
): Promise<string> {
  const { data: cred } = await adminClient
    .from("platform_credentials")
    .select("refresh_token")
    .eq("user_id", userId)
    .eq("platform", "tiktok")
    .maybeSingle();
  if (!cred?.refresh_token) throw new Error("no_tiktok_refresh_token");

  const fresh = await refreshTiktokAccessToken(cred.refresh_token);

  // CRITICAL: TikTok ROTATES refresh tokens — persist the new one back
  // or future refreshes fail.
  await adminClient
    .from("platform_credentials")
    .update({
      refresh_token: fresh.refresh_token,
      expires_at: new Date(
        Date.now() + fresh.access_token_expire_in * 1000
      ).toISOString(),
    })
    .eq("user_id", userId)
    .eq("platform", "tiktok");

  return fresh.access_token;
}
```

Every helper in `api.ts` accepts `accessToken: string` (not refresh_token). Caller is responsible for calling `getAccessTokenForUser` once per request session.

### 6.2 Perf-recon timing instrumentation (Session 3)

Per ADR-020 §Decision 15 + ADR-019 perf-gate precedent. Temporary `[tiktok-perf]` logs added to `/api/ads/creatives` for the TikTok branch only. Removed in a cleanup commit post-verify. M9.1 precedent.

### 6.3 Cache bump v13 → v14

Per ADR-020 §Decision 3. Bumps when the `UnifiedAd.ad_type` literal expands to include `"TIKTOK_AD"` — which already happened in Session 1's `types.ts` edit. Memory #28 protocol applies pre-push for Session 2.

---

## 7. Dependency gate (HARD BLOCKER)

**Session 2 implementation CANNOT begin until ALL of these are true:**

1. ✅ **TikTok app approved** (`TIKTOK_APP_ID` + `TIKTOK_SECRET` available). Currently Pending (Issue #43).
2. ✅ **Env vars set in Vercel** (sensitive flag on the two secrets).
3. ✅ **Probe 1 (`_tiktok-report-shape.mjs`) run + response shape confirmed.** All 8 known-unknowns from §4 answered.
4. ✅ **Probe 2 (`_tiktok-creative-probe.mjs`) run + creative URLs confirmed.** Verified `creative_material` structure + `poster_url` resolution.

Only after probes verify the real API shapes do we write the fetchers. **No blind implementation from docs** — the M8 LANDSCAPE_LOGO-vs-AD_IMAGE incident + the M9 composite-key 9% collision both got caught by probes that ran before fetcher code shipped.

---

## 8. Session 2 commit structure (preview)

| # | Commit | Files |
|---|--------|-------|
| (this) | `chore(recon): TikTok Session 2 implementation plan` | docs/recon/tiktok-session2-plan-2026-05-29.md |
| Session 2 commit 1 | `chore(recon): TikTok Session 2 probe results` | docs/recon/tiktok-probe-results-<date>.md + scripts/_tiktok-report-shape.mjs + scripts/_tiktok-creative-probe.mjs (committed AFTER passing) |
| Session 2 commit 2 | `feat(tiktok): Session 2 — normalize + adapter fetchers + reports UI` | All implementation files per §5 |
| Session 2 commit 3 (Session 3 boundary) | `chore(perf): remove temporary [tiktok-perf] logs` | cleanup post-verify |

---

## 9. Outstanding code review findings to resolve BEFORE Session 2

Per the parallel code review (surfaced separately in chat):

| # | Finding | Severity | Session 2 dependency? |
|---|---------|:--------:|:--------:|
| 1 | refresh_token-vs-access_token confusion (discover + select-accounts pass refresh_token as Access-Token header) | CRITICAL | YES — fix in Session 2 commit 1 via the `getAccessTokenForUser` helper above. Session 1 won't work end-to-end until this is fixed. |
| 2 | `refreshTiktokAccessToken` defined but never called | MODERATE | YES — gets called as part of fix #1 |
| 3 | Rotating refresh_token not persisted back | MODERATE | YES — fix as part of #1 (the `update` step in `getAccessTokenForUser`) |
| 4 | `getAccessibleAdvertisers` bypasses `tiktokGet` helper (inconsistent error handling) | MINOR | NICE-TO-HAVE — consolidate during Session 2 if cheap |
| 5 | `oauth.ts` has hardcoded paths (`/oauth2/access_token/`, `/oauth2/refresh_token/`) outside api.ts | MINOR | NICE-TO-HAVE — defer to v1.4 migration if it surfaces |
| 6 | `classifyTiktokError` doesn't surface as response to discover failures (discover returns generic 500 instead of 401 reauth) | MODERATE | YES — fix in Session 2 as part of error-handling unification |

---

## 10. What's explicitly NOT in Session 2

Per ADR-020 §Open Items:

- v2 engagement metrics (`video_watched_2s` / `video_watched_6s` / completion percentages) — defer
- `audience.read` scope + audience demographics — defer
- `bc.read` Business Center support — defer
- TikTok Shop integration — defer
- Spark Ads — defer
- Write-back actions (pause/resume/edit) — defer
- Retry-with-backoff infrastructure — defer per YAGNI

---

## Code Review Findings (Session 1 post-implementation review)

Session 1's OAuth flow has 1 CRITICAL + 3 MODERATE issues, all
clustered around the access_token refresh pattern. These are Session 2's
FIRST work item (before report fetchers).

**CRITICAL #1: refresh_token incorrectly passed as access_token to
discover/info endpoints.** TikTok requires a fresh 24h access_token from
`/oauth2/refresh_token/` for all non-refresh endpoints. Current code will
fail with error 40105 on first API call.

Root cause: `discover/route.ts:65` comment was incorrect speculation
contradicting public docs ("the refresh token IS the long-lived
credential, accepted by this endpoint"). This is exactly the
"assumption vs empirical reality" anti-pattern that probes exist to
catch.

Fix (Session 2 Task 1): Implement `getAccessTokenForUser(adminClient,
userId)` in `tiktok/api.ts` that:
  1. Calls `refreshTiktokAccessToken` with current refresh_token
  2. Receives NEW access_token + NEW refresh_token (TikTok rotates
     refresh_token on EVERY refresh — unlike Google's stable token)
  3. Persists the rotated refresh_token back to `platform_credentials`
     (CRITICAL — without this, user reauths every 24h)
  4. Returns the fresh access_token for the API call

This single helper resolves CRITICAL #1 + MODERATE #2 (dead code
`refreshTiktokAccessToken` becomes used) + MODERATE #3 (rotated token
persistence).

**MODERATE #4:** `discover/route.ts` catch returns generic 500 instead of
routing through `classifyTiktokError` → 401 `reauth_required`. Fix: wrap
with `isReauthError`-aware branch (same as `/api/ads/insights` pattern).

**MINOR #5, #6:** deferred (endpoint path localization, helper consistency).

**KEY LESSON:** TikTok's refresh_token ROTATION differs from Google (stable)
and Meta (60-day). The probe (`_tiktok-oauth-probe.mjs`) must verify the
rotation behavior empirically before the helper ships. This is a
memory-entry candidate post-verification.

## 11. Session 2 success criteria

1. `/dashboard/reports` → TikTok tab loads within 8s (matches M9.1 envelope)
2. Each TikTok ad card shows spend / impressions / clicks / CTR / ROAS / purchases / revenue
3. KPI strip at top of TikTok tab aggregates across the user's selected advertisers
4. AdDetailModal for TIKTOK_AD variant renders poster + "View on TikTok" link + performance grid + pixel conversions
5. Switch to Google tab — no regression (existing M9.1 lazy-load pattern unchanged)
6. Switch to Meta tab — no regression
7. Memory #28 8-step protocol passes (now 3 providers in matrix)
8. Probe re-runs clean against sandbox
9. tsc + build clean

Standing by until probes can run against an approved TikTok app.
