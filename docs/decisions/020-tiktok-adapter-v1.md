# ADR-020: TikTok Marketing API Adapter (v1 — Level 1 Basic + pixel conversions)

**Status**: Draft — awaiting approval
**Date**: 2026-05-28
**Phase**: 7 (TikTok integration — first integration since Google Ads in Phase 4)
**Related**: ADR-005 (Google integration + multi-currency — direct platform-precedent), ADR-010 (industry-standard account selection — selector flow reused), ADR-013 (PMax variant pattern — discriminated-union variant precedent reused for `TIKTOK_AD`), ADR-017 (M-hardening-1 — `ReauthRequiredError` widens to cover TikTok), ADR-019 (M9.1 lazy-load — payload hygiene inherited from day 1), Memory #27 (long-term-fit), Memory #28 (cache bump pre-push protocol — 8th iteration), Memory #29 (Saudi/Gulf accounts run at thousands-scale)
**Recon**: [docs/recon/tiktok-phase7-recon-2026-05-28.md](../recon/tiktok-phase7-recon-2026-05-28.md) (8-section research: SDK analysis + architectural fit + defensive plan + scope + DB + Saudi market + risk + open questions)

## Context

ArabiaDash's customer profile is Saudi/Gulf e-commerce operators. Recon §6 surfaced that **TikTok ads are table-stakes for this persona, not optional**: 138% ad-reach penetration of 18+ adults at start of 2025 (multi-account / measurement methodology overflow), 95 min/day average usage (highest in MENA, +30% vs global), 68% of Saudi consumers report purchasing after influencer exposure. Shipping a Meta+Google-only dashboard is incomplete by Saudi-market standards.

Three architectural truths constrain how we build this:

**Truth 1 — TikTok's API is less stable than Google/Meta.** Recon §1 confirmed the official SDK is v1.0.1 with no tagged releases, 197 stars, 34 commits on main, no TypeScript types in the package. The Marketing API itself has "aggressive versioning" per public reports — v1.3 is current; v1.4 announcement-to-deprecation cycle is ~3 months. Enterprise tools anecdotally report 10-15 hrs/month maintenance during the transition windows. We need defensive architecture from day 1, not bolted on after the first breaking change bites us.

**Truth 2 — TikTok's data model is closer to Meta than Google.** Pixel-based attribution (`complete_payment` metric) is platform-native and pre-aggregated by the Reporting endpoint — same shape as Meta's `omni_purchase` action_type. **No ADR-011 family merger needed.** No client-side conversion_actions cache table. Hierarchical structure (Advertiser → Campaign → AdGroup → Ad) cleanly maps to the existing `UnifiedAdCommon` shape (`accountId` / `campaignId` / `adsetId` / `id`). No Google-style keyword/search-term/asset-group surfaces complicate v1.

**Truth 3 — All four critical tables are already platform-agnostic.** `AdProvider = "meta" | "google" | "tiktok" | "snapchat"` declared at [cache.ts:113](../../src/lib/ads/cache.ts#L113). `platform_credentials` + `connections` + `insights_cache` + `creatives_cache` all have `text` columns with no CHECK constraint; the multi-platform migration ([20260509150000](../../supabase/migrations/20260509150000_refactor_to_multi_platform.sql#L75-L76)) explicitly comments `tiktok` as a future provider. **Zero DDL bumps needed.**

The remaining design surface is the adapter implementation, the OAuth flow, the modal UX for video-first creatives, and the defensive patterns that isolate breaking-change blast radius. Each decision below has been recon-validated against the 8 question matrix surfaced in the recon doc §8 + the user's expanded 8-question lock.

## Decision

### 1. Direct HTTP, NO SDK (mirrors Meta precedent)

`src/lib/tiktok/api.ts` is the single file that owns all v1.3 endpoint details. Uses Node's `fetch()` directly against `https://business-api.tiktok.com/open_api/v1.3/`. Pattern matches [src/lib/meta/api.ts](../../src/lib/meta/api.ts) verbatim — the established precedent for unstable / under-typed external APIs.

**Rejected: official SDK** (recon §1.2 Option A) — v1.0.1, no TypeScript types, no tagged releases. Coupling our types to SDK-internal `any`s creates dependency hell when v1.4 ships.

**Rejected: community SDK `@quantum-forge/tik-tok-business-sdk`** (recon §1.2 Option C) — single-maintainer risk, smaller user base than official.

### 2. Conversion attribution: Meta `omni_purchase` pattern, NOT ADR-011 family

TikTok's pixel-based `complete_payment` metric is returned directly by `/report/integrated/get/`. Server-side pre-aggregated. NO `tiktok_conversion_actions` table. NO 9th ADR-011 merger sibling.

Mapping in `src/lib/tiktok/normalize.ts`:

```typescript
unifiedAd.purchases = Number(metrics.complete_payment ?? 0);
unifiedAd.revenue = Number(metrics.total_purchase_value ?? 0);
unifiedAd.roas = metrics.complete_payment_roas ?? null;
unifiedAd.hasConversionData = (metrics.complete_payment_setup_status != null);
```

`hasConversionData = true` whenever the advertiser's TikTok Pixel is configured (per `complete_payment_setup_status` field). Same "platform-native truthiness" semantic as Meta's `omni_purchase` precedent — no cache map dependency.

### 3. Cache bump v13 → v14 (Memory #28 8th iteration)

`UnifiedAd.ad_type` discriminated union gains the literal `"TIKTOK_AD"`. Cached v13 rows from Meta/Google won't have this value — they still narrow cleanly to existing variants. But TikTok rows written by v14 code into a v13-keyed cache would orphan on first read; bumping invalidates universally so all clients pick up the new shape immediately.

Memory #28 pre-push verification protocol applies:

1. `npm run check` + `npm run build` clean
2. Local dev server up against production Supabase
3. Force fresh **Google** fetch — `/api/ads/{insights,creatives}?refresh=true` return HTTP 200 `source: "fresh"`
4. Force fresh **Meta** fetch — same with `provider=meta`
5. Force fresh **TikTok** fetch — same with `provider=tiktok` (against sandbox in v1; production after app-review)
6. ANY HTTP 500 / non-fresh → push BLOCKED
7. Probe re-runs (oauth + discover + report-shape + creative) confirm shape stability
8. All checks green → push

8th iteration under Memory #28 (v5→v6 caught Google invalid_grant; v6→v7 baseline; v7→v8 caught M5/M8 GAQL bugs; v8→v9 baseline; v9→v10 baseline; v10→v11 value-fix; v11→v12 baseline; v12→v13 baseline). v13→v14 adds a third platform to the verification matrix.

### 4. 3-session v1 commitment + flexibility for hardening

Session breakdown:

| Session | Scope | Deliverables |
|---------|-------|--------------|
| **1** | OAuth + account selection + base adapter foundation | `tiktok/api.ts` skeleton, `tiktok/oauth.ts` helpers, `/api/auth/tiktok/{init,callback,discover,select-accounts}` routes, `/dashboard/connections/tiktok/select` page, `platform_credentials` write on callback (mirrors Google's ADR-017 single-source-of-truth) |
| **2** | Reports integration + creatives view + KPI strip | `TikTokAdapter` implementing `AdProviderAdapter`, `tiktok/normalize.ts` for shape mapping, `TikTokCreativeCard` component (9:16 aspect), new "TikTok" tab in `ReportsClient.tsx`, KPI strip wired |
| **3** | Pixel conversions + pre-push verification + ship | `complete_payment` / `total_purchase_value` mapping, `[tiktok-perf]` timing logs, Memory #28 8-step probe gate, app-review submission for production scope, merge to main |

Sessions 1+2 ship to a `phase-7-tiktok-v1` branch incrementally. Session 3 closes the milestone with the perf gate + the merge. Flexibility for a hardening session 3.5 if the Memory #28 protocol catches any pre-push surprises.

### 5. App review: sandbox-now + production-before-launch

TikTok Marketing API requires app-review for production access to most read scopes. Same pattern as Google Verification deferred in ADR-017 §Open Items.

Strategy:
- Sessions 1-3 work against **TikTok Sandbox** (test advertiser accounts, full API access without review). Sandbox token works on production endpoints with sandbox-tagged advertisers.
- Submit production app-review application AFTER session 3 merges to main + before public Saudi launch.
- Expected lead time: 2-4 weeks per public docs. Belt-and-suspenders: start the application during session 1 so review is in-flight while we build.

Document in §Open Items as a launch-prep gate alongside Google Verification (also Phase B per ADR-017).

### 6. Thin-boundary 3-layer architecture (per recon §3.3)

```
TikTok API v1.3
       ↓
src/lib/tiktok/api.ts        ← thin HTTP layer
  Owns: endpoint URLs, request shapes, response shapes,
        TIKTOK_API_VERSION constant, headers, error parsing
  Behavior: returns TikTok-native shapes, never UnifiedAd
       ↓
src/lib/tiktok/normalize.ts  ← shape mapper
  Owns: TikTok-native → UnifiedAd / UnifiedInsight transformations
        `complete_payment` → `purchases`, etc.
  Behavior: pure functions, no I/O, isolates breaking shape changes
       ↓
src/lib/ads/providers/tiktok.ts  ← TikTokAdapter implementation
  Owns: AdProviderAdapter interface methods (getCampaigns, getAds, ...)
  Behavior: calls api.ts + normalize.ts, returns Unified shapes
       ↓
src/lib/ads/factory.ts case → routes / hooks / UI
  Consumers know nothing about TikTok-specific details
```

When v1.3 → v1.4 ships:
1. Read the changelog.
2. Bump `TIKTOK_API_VERSION` in `tiktok/api.ts`.
3. Patch any field path changes in `tiktok/api.ts`.
4. If response shapes changed (rare), patch `tiktok/normalize.ts`.
5. Re-run the 5 probe scripts.
6. Done.

One- to two-session upgrade path per major version bump.

### 7. API version pinned in config

`src/lib/tiktok/api.ts` declares:

```typescript
export const TIKTOK_API_VERSION = "v1.3";
const TIKTOK_BASE_URL = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;
```

Mirrors `META_API_VERSION` precedent in [src/lib/meta/oauth.ts](../../src/lib/meta/oauth.ts). Single source of truth; no floating version reference anywhere else in the codebase.

### 8. Graceful degradation via factory.ts

`factory.ts:getAllAdaptersForUser` already uses `Promise.all` over active connections. We extend to `Promise.allSettled` so a TikTok adapter throwing on construction (e.g. token expired before Memory #28 cache invalidation completes) does NOT kill the whole adapter list — Meta + Google adapters still return for the same user.

```typescript
const adapters = await Promise.allSettled(
  connections.map(c => getAdapterForProvider(userId, c.platform, c.account_id))
);
return adapters
  .filter((r): r is PromiseFulfilledResult<AdProviderAdapter | null> => r.status === "fulfilled")
  .map(r => r.value)
  .filter((a): a is AdProviderAdapter => a !== null);
```

Failed-construction errors logged via `console.error` for Vercel debugging; don't bubble up to the user dashboard.

### 9. ReauthRequiredError widened from ADR-017

`provider` discriminator changes from `"google"` literal to `"google" | "tiktok"`:

```typescript
export class ReauthRequiredError extends Error {
  readonly provider: "google" | "tiktok";
  readonly reason: ReauthReason;
  readonly reauthUrl: string;
  // ...
}
```

New `classifyTiktokError(err)` in `src/lib/tiktok/errors.ts` mirrors `classifyGoogleAdsError` — substring-matches TikTok's error codes (`40100` rate limit; `40105` invalid_access_token; `40110` access_token_expired; `40115` access_denied) and returns typed errors. Existing `isReauthError` type guard works unchanged.

The reauth CTA banner in `ReportsClient.tsx` already routes on `reauth_required` HTTP 401 — no new UI branching needed. Arabic copy reuses ADR-017's message with provider-aware substitution:

```typescript
const message =
  err.provider === "google"
    ? "انتهت صلاحية ربط حساب Google. يرجى إعادة الربط للمتابعة."
    : "انتهت صلاحية ربط حساب TikTok. يرجى إعادة الربط للمتابعة.";
```

### 10. Database schema — NO DDL

All TikTok-specific extras → `connections.metadata jsonb`:

```typescript
metadata: {
  currency: "SAR" | "USD" | ...;
  timezone_name: string;
  tiktok_advertiser_name?: string;
  tiktok_business_center_id?: string;   // v2+ if Business Center surfaces
  tiktok_pixel_id?: string;             // v1 — for conversion attribution check
  tiktok_pixel_setup_status?: string;   // v1 — drives hasConversionData
}
```

Per Q1 sub-issue resolution:
- **No `refresh_token_expires_at` column.** TikTok's 1-year refresh token lifetime is unique vs Google, but ADR-017's `ReauthRequiredError` flow handles expiry naturally — user reconnects on prompt. Pre-emptive expiry tracking adds complexity for no UX gain.
- **No `connections.account_id` prefix.** TikTok endpoints take bare numeric advertiser_id. Meta's `act_` prefix is Graph API-specific; not generalizable.

Zero migrations. The migration directory stays clean.

### 11. UI — static video poster + external TikTok link (NOT iframe embed)

`TikTokCreativeCard` component:

- Vertical 9:16 aspect ratio (matches TikTok native video format)
- Poster image (from `/file/video/ad/info/` response's `poster_url`)
- Play-icon overlay with subtle scale-on-hover
- Click → opens TikTok video URL in new tab (`target="_blank"` + `rel="noopener noreferrer"`)
- Same performance metrics footer (spend / impressions / clicks / CTR / purchases / revenue / ROAS) as `CreativeCard`

`AdDetailModal` for `TIKTOK_AD` variant: video poster section on top + standard metric grid + pixel conversion section. **No new tabbed modal pattern** — single-section reuse of M5-era modal shell.

Skipped in v1: iframe embed (requires another OAuth scope + tightly couples our UI to TikTok player breaking changes), engagement metrics block (2s view rate / completion rate / etc.), audience demographics. All deferred to v2.

### 12. TikTok-only field handling — `video_views` only in v1

`UnifiedAd.TIKTOK_AD` variant `type_data` shape:

```typescript
{
  ad_type: "TIKTOK_AD";
  type_data: {
    posterUrl?: string;        // /file/video/ad/info/ poster_url
    videoId?: string;          // advertiser-internal video_id
    tiktokVideoUrl?: string;   // share_url for external link
    objective_type: string;    // CONVERSIONS / TRAFFIC / VIDEO_VIEWS / ENGAGEMENT
    callToAction?: string;     // SHOP_NOW / LEARN_MORE / etc.
    videoViews?: number;       // metrics.video_views — TikTok-native total view count
  };
}
```

`videoViews` is the ONLY TikTok-specific metric surfacing in v1 — meaningfully different from `impressions` in TikTok's autoplay-by-default UX. Engagement metrics (2s view rate, 6s view rate, completion percentage, engaged_view) deferred to v2 per recon Q3.

### 13. OAuth scopes — minimum 5 read-only

| Scope | Purpose |
|-------|---------|
| `user.info.basic` | OAuth identity verification |
| `ad.read` | List + fetch ads, ad_groups, campaigns |
| `report.read` | `/report/integrated/get/` for all performance metrics |
| `creative.read` | Video metadata + poster URLs |
| `pixel.read` | Pixel setup status for `hasConversionData` |

Deferred:
- `audience.read` — v2 candidate when audience-demographics feature surfaces
- `bc.read` (Business Center) — v2 candidate if user reports Business Center accounts not showing in selector
- Any `*.write` scope — Phase 9+ for write-back features, separate app-review cycle

Adding scopes later requires re-OAuth from every user — known and acceptable cost. Documented in §Open Items.

### 14. Rate limiting — port Meta `isRateLimitError` pattern

`src/lib/tiktok/errors.ts` exposes `isRateLimitError(err)` matching the Meta precedent. Detects TikTok error code `40100` (verified pre-push via recon probe). On rate-limit hit:

- Stale cache exists → serve stale with `source: "rate-limited"` warning (same shape as Meta's existing behavior)
- No cache → HTTP 429 with Arabic message: "تم تجاوز الحد المسموح للاستفسارات من TikTok. الرجاء المحاولة بعد بضع دقائق."

**No queue or throttling infrastructure** at v1 scale (single user, single advertiser, ~10-15 requests per user-action — well under TikTok's 600 req/min/advertiser).

### 15. Testing — 5 probe scripts + `[tiktok-perf]` timing instrumentation

Pre-push probe scripts (all preserved per disposition-B / M7/M7.5/M9 precedent):

| Probe | Purpose |
|-------|---------|
| `scripts/_tiktok-oauth-probe.mjs` | Walks `auth_code` → `access_token` + `refresh_token` roundtrip against TikTok Sandbox |
| `scripts/_tiktok-discover-probe.mjs` | `/oauth2/advertiser/get/` shape verification + advertiser_id listing |
| `scripts/_tiktok-report-shape.mjs` | `/report/integrated/get/` shape + per-metric availability against real advertiser |
| `scripts/_tiktok-creative-probe.mjs` | `/ad/get/` creative_material structure + `/file/video/ad/info/` poster URL resolution |
| `scripts/_verify-tiktok-conversion-attribution.mjs` | Phase 3 pre-push — confirm `complete_payment` totals match user's expected pixel data |

`[tiktok-perf]` timing instrumentation added to `/api/ads/creatives` route for the TikTok branch per ADR-019's perf-gate convention. Removed post-verify in a cleanup commit (M9.1 precedent).

### 16. Error handling — NO retry-with-backoff in v1

Same YAGNI precedent as ADR-017 §Alternative A:

| Error class | v1 behavior |
|-------------|-------------|
| Reauth required | `ReauthRequiredError` thrown → HTTP 401 + Arabic CTA banner |
| Rate limited (40100) | Stale-cache fallback → HTTP 429 with no-cache fallback |
| Transient 5xx | Single-attempt-fail; user retries via UI |
| Network error | Same as transient 5xx |
| Unknown error | `console.error` + generic 500 |

Retry-with-backoff infrastructure deferred. If Vercel logs show real transient patterns post-ship, revisit then. Don't pre-build infrastructure for hypothetical failures.

### 17. Cache TTL — match Google/Meta exactly

| Cache | Fresh | Stale-while-revalidate |
|-------|-------|------------------------|
| `creatives_cache` (TikTok) | 30 min | 24 hours |
| `insights_cache` (TikTok) | 15 min | 24 hours |

Same as Google + Meta. Memory #28 cache schema bumps (v13→v14 etc.) handle the "TikTok API changed shapes" case at the version-key layer; TTL handles data freshness. Don't conflate the two layers.

### 18. 4-commit atomic structure on `phase-7-tiktok-v1` branch

| # | Commit | Files |
|---|---|---|
| 1 | `chore(recon): Phase 7 TikTok adapter recon doc` | `docs/recon/tiktok-phase7-recon-2026-05-28.md` |
| 2 | `docs(adr): ADR-020 TikTok adapter v1` | `docs/decisions/020-tiktok-adapter-v1.md` (this file) |
| 3 | `feat(tiktok): adapter v1 — OAuth + reports + creatives + pixel conversions` | All implementation files (session 1 + 2 + 3 work bundled OR split into 3 sub-commits if session boundaries warrant) |
| 4 | `chore(scripts): preserve TikTok recon + verification probes` | All 5 probe scripts |

If sessions 1-2-3 stretch across multiple chat sessions, commit 3 splits into 3 sub-commits (one per session) — matches M-PMax + M-hardening-1 precedent. Final merge is single PR regardless.

### 19. Memory entries — TBD post-implementation

Two memory candidates from recon:

- **TikTok API instability mitigation pattern** — thin-boundary architecture as the established response for unstable external APIs. Worth saving once v1 ships and the pattern is proven (vs M9.1's lazy-load memory which captured a confirmed pattern post-fact).
- **Sandbox-then-production app-review timing** — start review in session 1 so it overlaps with development. Worth saving if Google Verification Phase B follows the same pattern (likely).

Both deferred for now. Memory entries get written post-ship based on what surprises actually surface, not preemptively.

## Alternatives considered

### Alternative A — Official TikTok SDK

**Rejected.** v1.0.1 with no tagged releases. 197 GitHub stars. Maintenance signals "moderate" per recon §1.1. No TypeScript types in the package — coupling to SDK shapes via `any` defeats our TypeScript-strict discipline. When v1.4 ships, SDK lag adds an entirely separate failure mode beyond the API itself.

### Alternative B — Embedded iframe TikTok video player

**Rejected.** Requires another OAuth scope (`embed.read` or similar). Tightly couples our UI to TikTok's player JS bundle — when TikTok changes the player API, our modal breaks. External link via `share_url` is the M-PMax YouTube precedent (`watch?v=…` external link instead of embed).

### Alternative C — Retry-with-backoff infrastructure

**Rejected** per ADR-017 §Alternative A precedent — same YAGNI reasoning. The recon's "10-15 hrs/month maintenance" cited from enterprise tools includes their retry-tuning work; we explicitly opt out of that by detecting auth-class errors at the boundary (`ReauthRequiredError`) and treating everything else as single-attempt-fail with stale-cache fallback. Revisit only if Vercel logs show real transient patterns.

### Alternative D — Track `refresh_token_expires_at` column

**Rejected.** TikTok's 1-year refresh token lifetime is unique among our three providers (Google effectively perpetual; Meta 60-day debug-extended access_token; TikTok 1-year refresh_token). Pre-emptive expiry tracking adds:
- 1 new column on `platform_credentials`
- DDL migration
- New "your TikTok connection will expire in N days" UX
- Edge cases around clock skew + refresh-resets

ADR-017's reactive `ReauthRequiredError` flow handles expiry naturally — user reconnects on prompt. Same UX outcome at zero infrastructure cost.

### Alternative E — Dedicated `connections.tiktok_advertiser_id` column

**Rejected.** Same precedent as ADR-017's Meta-only `access_token` column collapse — don't add provider-specific columns when the existing `account_id text` column accepts any string. TikTok-specific extras go in `metadata jsonb`. Provider parity preserved.

### Alternative F — Extend ADR-011 family with TikTok merger

**Rejected.** TikTok's pixel-based `complete_payment` is platform-native and pre-aggregated. No client-side conversion-action mapping needed. The ADR-011 family pattern exists because Google's `metrics.conversions` includes ALL configured conversion actions (sign-ups + add-to-cart + lead-forms + purchases) and we need a `purchaseActionIds` filter. TikTok already filters at the metric level — `complete_payment` IS the purchase. Adding a 9th merger sibling would be architectural overhead for nothing.

### Alternative G — Skip Sandbox; develop directly against production with manual review

**Rejected.** App-review for production TikTok scope takes 2-4 weeks. Doing it AFTER development would block ship for weeks. Doing it INSTEAD of sandbox would block development for weeks. Doing it IN PARALLEL with sandbox-based development is the right sequencing.

### Alternative H — Single-commit atomic

**Rejected per ADR-precedes-implementation discipline.** Same rationale as ADR-015 through ADR-019: 3-commit (or 4-commit including scripts) preserves the architectural decision trail and bisect-ability.

## Consequences

### Positive

- **Saudi market table-stakes met.** Dashboard moves from "Meta + Google ads only" to "complete Saudi e-commerce ads dashboard." Customer-acquisition fundamental, not a feature.
- **Defensive architecture inherited from day 1.** Thin-boundary 3-layer + pinned API version + ReauthRequiredError widening + graceful degradation in factory.ts. When v1.3 → v1.4 ships, the upgrade path is one file's worth of patches.
- **No DB migrations.** Recon §5 + Decision §10 confirm zero DDL. Saves a Memory #28 protocol gate around schema correctness.
- **Lazy-load pattern inherited from M9.1.** If TikTok future adds per-ad_group surfaces (audiences, demographics), the lazy-fetch pattern from ADR-019 is the established convention.
- **Conversion handling stays simple.** No 9th ADR-011 merger. No new cache table. The `complete_payment` metric maps to `purchases` with a one-line cast.
- **Memory #28 protocol matures across 3 platforms.** 8th iteration adds TikTok to the verification matrix; pattern continues exercising on real production accounts.
- **Three-session commitment is realistic per recon §7** — pattern known, scope locked, no Google-style multi-milestone foundation needed.

### Negative

- **Maintenance burden 4-8 hrs/month average, spiking to 15-20 during v1.X→v1.Y migrations** (~every 6-9 months estimated). Higher than Meta's ~2 hrs/month, lower than Google's M-hardening-era 6-10 hrs/month during ADR-011 family build-out.
- **External video link fragments the UX vs embedded playback.** Users click into TikTok app/web to see the actual video. Industry standard, but worth flagging — Google + Meta show creative content in-modal; TikTok will open externally.
- **Manual API version updates required.** Pinned `TIKTOK_API_VERSION = "v1.3"` doesn't auto-upgrade. Worth it for stability; tracked via TikTok changelog subscription as an operational dependency.
- **App-review timing creates a launch-prep gate.** Production scope unlocks 2-4 weeks after submission. Mitigated by submitting during session 1 (work overlaps with review).
- **5 OAuth scopes asked upfront** (vs Meta's 3, Google's 1). Slightly more friction at the consent screen. Industry-typical; not a blocker.

### Risk

- **API v1.3 → v1.4 breaking change mid-development** is the highest single risk. Mitigation: thin-boundary architecture (Decision §6). Worst case: one extra hardening session to patch `tiktok/api.ts` field paths.
- **Saudi customer pixel-only attribution confusion.** Some users expect in-app TikTok Shop purchases to count; v1 only surfaces pixel-tracked purchases. Mitigation: UI tooltip documents the "pixel-tracked purchases only" scope. Shop integration deferred to Phase 9.5.
- **OAuth app-review rejection or extended timeline.** Mitigation: submit during session 1; have sandbox-tagged advertiser accounts ready for user dogfooding during the review window.
- **Sandbox-vs-production behavior divergence.** Sandbox accounts have synthetic data; production behavior may differ in edge cases (date range coverage, metric availability). Mitigation: post-app-review, run probes against the user's real production advertiser before declaring v1 shipped.
- **Cache v13 → v14 invalidation cascade timing.** Same 30-min transition window blast radius as prior bumps. Mitigated by Memory #28 protocol gate (now an 8-step matrix incorporating TikTok sandbox).

## Implementation plan

### Session 1 — OAuth + account selection + base adapter foundation (~3-4 hours)

| File | Change | Est. LOC |
|---|---|---|
| `src/lib/tiktok/api.ts` | NEW — thin HTTP layer skeleton + `TIKTOK_API_VERSION` constant + auth helpers | +100 |
| `src/lib/tiktok/oauth.ts` | NEW — auth_code → access_token exchange + refresh_token logic | +80 |
| `src/lib/tiktok/errors.ts` | NEW — `classifyTiktokError` + widened error types | +30 |
| `src/app/api/auth/tiktok/init/route.ts` | NEW — OAuth consent URL generator, state-cookie + workspace-cookie | +50 |
| `src/app/api/auth/tiktok/callback/route.ts` | NEW — auth_code exchange + `platform_credentials` upsert | +110 |
| `src/app/api/auth/tiktok/discover/route.ts` | NEW — list accessible advertiser_ids + per-advertiser display metadata | +80 |
| `src/app/api/auth/tiktok/select-accounts/route.ts` | NEW — selected-advertiser upsert to `connections` | +90 |
| `src/app/dashboard/connections/tiktok/select/page.tsx` | NEW — server page wrapper | +50 |
| `src/app/dashboard/connections/tiktok/select/TikTokAccountSelectorClient.tsx` | NEW — selector UI matching Google/Meta pattern | +150 |
| `src/lib/ads/types.ts` | Extend `ReauthRequiredError` provider discriminator + add `TIKTOK_AD` literal to `AdType` | +25 |
| `src/lib/ads/factory.ts` | Promise.allSettled in `getAllAdaptersForUser` + new `case "tiktok"` switch | +30 |
| **Session 1 total** | | **~795** |

### Session 2 — Reports integration + creatives view + KPI strip (~3-4 hours)

| File | Change | Est. LOC |
|---|---|---|
| `src/lib/tiktok/api.ts` | EXTEND — `/campaign/get/`, `/adgroup/get/`, `/ad/get/`, `/report/integrated/get/`, `/file/video/ad/info/` callers | +150 |
| `src/lib/tiktok/normalize.ts` | NEW — TikTok-shape → `UnifiedAd` / `UnifiedInsight` transformations including `complete_payment` → `purchases` | +180 |
| `src/lib/ads/providers/tiktok.ts` | NEW — `TikTokAdapter implements AdProviderAdapter` (getCampaigns / getAccountInsights / getCampaignInsights / getAds / getAccount) | +200 |
| `src/lib/ads/types.ts` | Add `TIKTOK_AD` variant `type_data` shape (posterUrl, videoId, tiktokVideoUrl, objective_type, callToAction, videoViews) | +30 |
| `src/lib/ads/cache.ts` | Bump v13 → v14 + history entry | +12 |
| `src/components/creatives/TikTokCreativeCard.tsx` | NEW — 9:16 aspect ratio + poster + play-icon overlay + perf footer | +180 |
| `src/app/dashboard/reports/ReportsClient.tsx` | New "TikTok" tab + TikTok creatives grid + per-account selector + KPI strip wiring | +180 |
| **Session 2 total** | | **~932** |

### Session 3 — Conversions + pre-push verification + ship (~2-3 hours)

| File | Change | Est. LOC |
|---|---|---|
| `src/lib/tiktok/normalize.ts` | Extend with pixel conversion attribution (`complete_payment` / `total_purchase_value` / `complete_payment_roas`) + `hasConversionData` derivation from `complete_payment_setup_status` | +50 |
| `src/app/dashboard/reports/ReportsClient.tsx` | Wire pixel conversions into TikTok KPI strip + creative card footer | +40 |
| `scripts/_tiktok-oauth-probe.mjs` | NEW probe | +120 |
| `scripts/_tiktok-discover-probe.mjs` | NEW probe | +100 |
| `scripts/_tiktok-report-shape.mjs` | NEW probe | +180 |
| `scripts/_tiktok-creative-probe.mjs` | NEW probe | +130 |
| `scripts/_verify-tiktok-conversion-attribution.mjs` | NEW probe — Phase 3 pre-push gate | +160 |
| `src/app/api/ads/creatives/route.ts` | TEMPORARY `[tiktok-perf]` timing instrumentation for the TikTok branch (removed post-verify per M9.1 precedent) | +15 |
| **Session 3 total** | | **~795** |

**Cumulative total estimated: ~2,520 LOC.** Recon §4 estimated ~1,150 — revised upward as the file breakdown clarified. Still smaller than Google M1-M9 cumulative (~5,000+ LOC).

## Verification plan (Memory #28 8th iteration)

### Pre-push (BLOCKING)

1. `npx tsc --noEmit` clean
2. `npm run build` clean (3 new API routes emit in the route table)
3. Local dev server up against production Supabase
4. **Standard Memory #28 gates extended to 3 platforms:**
   - Force fresh **Google** fetch — `/api/ads/{insights,creatives}?refresh=true` return HTTP 200 `source: "fresh"`
   - Force fresh **Meta** fetch — same with `provider=meta`
   - Force fresh **TikTok** fetch — same with `provider=tiktok` (against sandbox in v1; production after app-review)
5. **5 probe scripts run clean** against TikTok Sandbox + a real user-authorized advertiser:
   - OAuth roundtrip succeeds
   - Discover returns ≥1 advertiser_id
   - `/report/integrated/get/` returns expected metric fields including `complete_payment` + `total_purchase_value`
   - `/ad/get/` creative_material structure matches our normalize.ts expectations
   - Pixel conversion attribution probe matches user's expected ad-level totals within ±5% tolerance (same convention as M9 search-terms verification)
6. **[tiktok-perf] timing gate** — TikTok creatives wall time under 8s on a real account (matches the M9.1 post-fix Google + Meta envelope per the user's production measurement)
7. ANY check failing → push BLOCKED. Diagnose + fix before retry.

### Vercel preview (visual verification by user)

1. Open preview → login → `/dashboard/connections/tiktok` — initiate OAuth
2. Complete OAuth flow against TikTok Sandbox → returns to selector
3. Selector lists sandbox advertiser_ids → pick one or more → upsert succeeds
4. Navigate to `/dashboard/reports` → TikTok tab → expect creative grid loads within 8s
5. Click any TikTok creative card → modal opens with poster + "View on TikTok" external link + performance grid + pixel conversions
6. Switch to Google tab — no regression (existing M9.1 lazy-load pattern unchanged)
7. Switch to Meta tab — no regression
8. KPI strip totals on TikTok tab match the per-ad card sum

### Post-merge (production)

Hard-refresh `arabiadash.com/dashboard/reports` after merge. Cache v13 → v14 transition window ~30 min. After app-review approval (separate post-merge milestone), repeat verification against the user's real production TikTok advertiser.

## Open items deferred (NOT in v1 scope)

1. **v2 engagement metrics** — `video_watched_2s` / `video_watched_6s` / `video_views_p25/50/75/100` / `engaged_view` / `average_video_play_per_user`. Adds ~6 fields to `TIKTOK_AD.type_data` + UI block in modal.
2. **`audience.read` scope + audience demographics surface** — separate v2 feature.
3. **`bc.read` (Business Center) scope** — v2 candidate if real user reports Business Center accounts not appearing in selector.
4. **Spark Ads (boosted organic posts)** — different post-graph integration; separate scope.
5. **TikTok Shop integration** — completely different API (Shop Partner API, not Marketing API). Phase 9.5 candidate.
6. **Write-back actions** (pause/resume/edit ads) — Phase 9+ + separate app-review for write scopes.
7. **Retry-with-backoff infrastructure** — revisit only if Vercel logs show real transient patterns post-ship.
8. **Production app-review** — submission during session 1; approval expected 2-4 weeks post-submit; ship to Saudi launch after approval.
9. **Saved audiences management** — Phase 9+ write-scope feature.
10. **Memory entries** — TikTok-instability-mitigation pattern + sandbox-vs-production app-review timing. Written post-ship based on actual surprises.

## Commits

- *(next on this branch)* — `chore(recon): Phase 7 TikTok adapter recon doc`
- *(next on this branch)* — `docs(adr): ADR-020 TikTok adapter v1` (this file)
- *(next on this branch, session 1)* — `feat(tiktok): session 1 — OAuth + account selection + adapter foundation`
- *(next on this branch, session 2)* — `feat(tiktok): session 2 — Reports integration + creatives + KPI strip`
- *(next on this branch, session 3)* — `feat(tiktok): session 3 — pixel conversions + perf gate`
- *(next on this branch, session 3 end)* — `chore(scripts): preserve TikTok 5 probe scripts (disposition-B)`

## Empirical Amendment (2026-05-29 — post-probe verification)

The Session 1 OAuth probe (`scripts/_tiktok-oauth-probe.mjs`) was re-run with the WARP-bypass-of-STC connectivity issue resolved and surfaced three findings that contradict the original ADR-020 assumptions. The architectural decisions below SUPERSEDE the original draft where indicated. Original decisions are preserved above for the audit trail.

### §13b — Token model (SUPERSEDES Decision §10's `refresh_token_expires_at` premise + Decision §13's implicit 24h-token model + Alternative D)

**Empirical finding** (probe 2026-05-29 against TikTok Marketing API v1.3 `/oauth2/access_token/`):

Response shape returns ONLY:
- `data.access_token` — 40-char long-lived token
- `data.advertiser_ids` — array of advertiser_id strings (10 IDs returned for the test app)
- `data.scope` — array of 37 integer scope IDs

Response shape does NOT return:
- `refresh_token` (verified ABSENT at 7 plausible nesting paths)
- `access_token_expire_in` / `refresh_token_expire_in` / any expiry field (verified ABSENT at 9 variant names)

This contradicts the original ADR-020 assumption of a `refresh_token + 24h access_token` rotation model. Web research confirms the empirical finding: TikTok Marketing API access_tokens are **long-lived and do not expire** unless explicitly invalidated via `/oauth2/revoke_token/` or user revocation in TikTok Business Center. The "24h+refresh" model documented elsewhere applies to TikTok Login Kit / Creator API, NOT to Marketing API.

**Architectural impact** (executed in Session 2 Commit 1):

- NO refresh logic anywhere in `src/lib/tiktok/`. The `refreshTiktokAccessToken()` function in `oauth.ts` is dead code — DELETE.
- NO `getAccessTokenForUser()` helper. Session 2 plan §6.1 is OBSOLETE — the access_token IS the storage credential.
- Store `access_token` directly in `platform_credentials.access_token` (NOT `refresh_token`). TikTok rows have `refresh_token = NULL`.
- ADR-017's consolidation policy (`platform_credentials.access_token = NULL` because Google's token IS the refresh_token) is **provider-specific** — TikTok uses the column with its documented semantic.
- Re-auth flow: `ReauthRequiredError` triggered ONLY on TikTok error codes 40105 / 40110 / 40115 (already wired in `errors.ts`).
- Alternative D (track `refresh_token_expires_at`) was already rejected; this amendment confirms there's nothing to track.

### §14b — Scope reality (SUPERSEDES Decision §13's 5-scope minimization premise)

**Empirical finding**: TikTok consent UI does NOT enforce scope minimization at this app tier. Two probe runs showed:

| Probe | Scope count | Notes |
|-------|:-----------:|-------|
| Run 1 (2026-05-29, original consent) | 34 | 25-item uncheck attempt incomplete |
| Run 2 (2026-05-29, after re-uncheck) | **37** | Unchecks did NOT persist; count INCREASED |

TikTok returns scope as **integer IDs**, not the string array (`["ad.read", ...]`) originally assumed in ADR-020 §13. Magnitude buckets observed in Run 2:

- **14 small ints (<100)** — `[4, 5, 10, 12, 13, 14, 23, 24, 62, 64, 65, 67, 68, 69]` — likely documented named scopes (e.g. 4 ≈ ad.read, 5 ≈ report.read, 10 ≈ user.info.basic — int→name mapping is not publicly documented; not relied upon)
- **9 medium ints (100-999)** — `[200, 210, 220, 600, 610, 630, 660, 800, 802]` — likely sub-permissions of the named scopes
- **2 xlarge ints (~6.1M)** — `[6100000, 6110000]` — unclear; possibly Spark Ads or Business Center-tier permissions
- **12 huge ints (>1B)** — values like `7280601645967278000` — almost certainly TikTok-internal asset/Pangle/auto-granted feature IDs

**Resolution**: ABANDON consent-UI scope minimization. The over-grant is at the app-tier policy layer, not the consent flow.

**Mitigation**: **code-level discipline**. ArabiaDash only CALLS endpoints within the 5 read scopes (ad.read, report.read, creative.read, pixel.read, user.info.basic). Over-granted scopes are dormant permissions — they do not expand actual access until our code exercises them. Documented as **accepted-but-unexercised risk** in the §Risk section of this amendment.

### §15b — Discover call elimination (SUPERSEDES Decision §6's 3-call OAuth flow)

**Empirical finding**: `/oauth2/access_token/` returns `advertiser_ids` inline in the same response that delivers the access_token. The test app returned 10 advertiser IDs without a separate `/oauth2/advertiser/get/` call.

**Architectural impact**:

OAuth flow collapses from 3 API calls to 2:

| Step | Endpoint | Returns |
|------|----------|---------|
| 1 | `POST /oauth2/access_token/` | access_token + advertiser_ids[] |
| 2 | `POST /oauth2/advertiser/info/` | per-advertiser metadata (name, currency, timezone) |

`getAccessibleAdvertisers()` in `src/lib/tiktok/api.ts` is **dead code** — DELETE in Session 2 Commit 1. `getAdvertiserInfo()` remains (needed for per-advertiser display metadata in the selector UI).

The `discover/route.ts` endpoint must be reworked to consume `advertiser_ids` carried over from the callback (via session cookie, state-encoded payload, or DB write at callback time), NOT by calling `/oauth2/advertiser/get/`.

### Amendment §Risk additions

- **Over-granted scope risk** — 37 numeric scope IDs granted vs the 5 intended. Dormant unless exercised; mitigated by code-level endpoint discipline. Worth a Vercel-log audit pre-Saudi-launch to confirm no accidental write-scope calls slipped through.
- **No expiry signal** — TikTok provides no clock-based expiry hint. We can NOT proactively warn users "your TikTok connection expires in N days" because there is no N. Reauth is reactive-only via 40105/40110/40115. Acceptable.

### Amendment commit traceability

This amendment lands in:
- `docs(adr): TikTok empirical findings — long-lived token + integer scopes (#43)` — this commit
- `feat(tiktok): session 2 commit 1 — delete dead refresh layer` — code execution of the amendment (Session 2)

### §15c — Discover call REINSTATED (corrects §15b, 2026-05-30)

§15b prescribed deleting `getAccessibleAdvertisers` based on the observation that `advertiser_ids` appear inline in the OAuth token-exchange response. Subsequent recon proved this was an OPTIMIZATION mistaken for a capability gap:

1. The `/oauth2/advertiser/get/` endpoint EXISTS and remains functional.
2. It accepts the long-lived access_token (no `advertiser_ids` input required) and returns `{ list: [{ advertiser_id, advertiser_name }] }`.
3. This is the exact semantic of Google's `listAccessibleCustomers` and Meta's `/me/adaccounts` — a live "what can this token access?" call.

The function `getAccessibleAdvertisers` ([src/lib/tiktok/api.ts](../../src/lib/tiktok/api.ts)) appeared broken only because the discover route passed `credential.refresh_token` (NULL post-§13b) instead of `access_token`. The function was correct; the call site was wrong.

**DECISION**: KEEP `getAccessibleAdvertisers`. Match the established Google/Meta pattern exactly — callback writes token only; the discover route re-fetches the advertiser list LIVE on selector-page load. **NO cookie carry-over, NO metadata column, NO persisted advertiser_ids.** The inline `advertiser_ids` in the OAuth response is retained as a diagnostic-only signal (optionally logged to assert parity with discover's result) but is NOT persisted.

This supersedes §15b's "delete" prescription and the "OAuth flow collapses 3→2 calls" optimization (irrelevant since discovery happens on selector load, not during the OAuth dance).

**Architectural impact** (revises Session 2 Commit 1):

- KEEP `getAccessibleAdvertisers` in `src/lib/tiktok/api.ts` (do NOT delete)
- Discover route ([src/app/api/auth/tiktok/discover/route.ts](../../src/app/api/auth/tiktok/discover/route.ts)) reads `access_token` from `platform_credentials.access_token` and passes it to `getAccessibleAdvertisers` + `getAdvertiserInfo` — same live-re-fetch shape as Google's `/api/google-ads/discover` and Meta's `/api/auth/meta/discover`
- Select-accounts route ([src/app/api/auth/tiktok/select-accounts/route.ts](../../src/app/api/auth/tiktok/select-accounts/route.ts)) similarly reads `access_token` (not `refresh_token`) for the `getAdvertiserInfo` enrichment call
- Callback ([src/app/api/auth/tiktok/callback/route.ts](../../src/app/api/auth/tiktok/callback/route.ts)) writes `access_token` to `platform_credentials.access_token`. The inline `advertiser_ids` from the OAuth response may be `console.log`-ed for diagnostic parity but is NOT persisted in any cookie, column, or other store.

**Net effect on Session 2 Commit 1**: drops the cookie/metadata carry-over design surface entirely. The commit becomes a straightforward credential-column flip (`refresh_token` → `access_token`) across callback / discover / select-accounts / factory, with zero divergence from the Google/Meta callback pattern.

### §13c — Credential column REUSED, not added (corrects §13b storage prescription, 2026-05-30)

§13b prescribed "store the `access_token` directly in `platform_credentials.access_token`". This assumed a dedicated `access_token` column was needed — an assumption driven by the column NAME (`refresh_token`) rather than its documented SEMANTIC. Recon of the existing Meta integration proved otherwise:

1. `platform_credentials.refresh_token` is documented as a **generic credential slot**, not literally a refresh token. See the Meta callback comment ([src/app/api/auth/meta/callback/route.ts](../../src/app/api/auth/meta/callback/route.ts)): *"Meta's long-lived token is the 'refresh_token' equivalent for the platform — column reused as generic credential storage (ADR-010)"*.
2. Meta — which (like TikTok) has NO refresh_token, only a long-lived access_token (~60d) — already stores that access_token in the `refresh_token` column, and has since the Meta integration shipped.
3. TikTok's long-lived access_token fits the IDENTICAL pattern.

**DECISION**: TikTok REUSES `platform_credentials.refresh_token` to store its long-lived access_token, exactly as Meta does. **NO new column. NO migration.** The column name is an accepted misnomer (generic credential slot); semantic clarified via callback + discover jsdoc.

**Consequences**:

- §13b's "column flip to `access_token`" prescription is VOID. There is no `access_token` column and none is needed.
- The shared helper `getRefreshTokenForUser` ([src/lib/google-ads/credentials.ts](../../src/lib/google-ads/credentials.ts)) works UNCHANGED for TikTok (returns whatever lives in `refresh_token`, platform-agnostic). No new `getTiktokAccessToken` helper is needed.
- Session 2 Commit 1 reduces to: (a) delete dead `refreshTiktokAccessToken`, (b) value-side bug fix in callback (`tokens.refresh_token` → `tokens.access_token`), (c) read-site variable-naming clarity (`const accessToken = credential.refresh_token`). ~−55 LOC, 5 files, zero new files, zero migration.

This supersedes §13b's column-storage prescription. §13b's core finding (access_token is long-lived, no refresh cycle) REMAINS valid — only the storage-location prescription is corrected.

## Report-Shape Empirical Findings (2026-05-31)

Probes `_tiktok-report-shape.mjs` + `_tiktok-report-q2b.mjs` + `_tiktok-report-active.mjs` + `_tiktok-video-metrics.mjs` ran against advertiser `7114520895124750337` (481k impressions / 1320 clicks / 1597.73 SAR over last 30 days). All findings below empirically verified against real Saudi TikTok ad activity.

### 1. §Decision 12 CORRECTION — `video_play_actions` (not `video_views`)

`video_views` is REJECTED with envelope code `40002 "Invalid metric fields: ['video_views']"` at BOTH `AUCTION_ADVERTISER` AND `AUCTION_AD` data_levels. The canonical v1.3 metric name is **`video_play_actions`** (maps internally to TikTok's `total_play` per the official SDK YAML at [github.com/tiktok/tiktok-business-api-sdk/blob/main/yml_files/smart_plus_material_report_overview.yml](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/yml_files/smart_plus_material_report_overview.yml)).

**`TIKTOK_AD.type_data.videoViews?: number`** field stays as defined in §Decision 12. The shape change is in the SOURCE metric name only:

```typescript
// Was (§Decision 12 original):
videoViews?: number;  // ← metrics.video_views (parseInt)
// Now (this amendment):
videoViews?: number;  // ← metrics.video_play_actions (parseInt from string)
```

Real-data verification: an ad with 108.60 SAR spend had `video_play_actions = "123634"` (123,634 plays). normalize.ts maps `metrics.video_play_actions` → `UnifiedAdTiktok.type_data.videoViews` via `parseInt`.

### 2. CTR scale (K2) — 0-100 percentage

Empirically resolved against advertiser `7114520895124750337` real data:

| Field | Returned value |
|-------|----------------|
| `metrics.ctr` | `"0.27"` |
| clicks | 1320 |
| impressions | 481114 |
| (clicks / impressions) × 100 | 0.274363 |
| \|ctr − ratio×100\| | 0.004363 (rounding to 2 dp) |
| \|ctr − ratio×1\| | 0.267256 |

**CTR is a 0-100 percentage** (Meta-style; NOT a 0-1 fraction like Google). `normalize.ts` requires NO scale conversion — pass `parseFloat(metrics.ctr)` through unchanged. The two-decimal format (`"0.00"` even for zero) is consistent with the percentage interpretation.

### 3. Metric value types (K1) — all strings

ALL metrics return as strings in `/report/integrated/get/` responses, regardless of underlying numeric kind:

| Metric kind | Returned format | Parse via |
|-------------|-----------------|-----------|
| Counts (impressions, clicks, complete_payment, video_play_actions, likes, ...) | `"0"`, `"123634"` (integer-shaped string) | `parseInt` |
| Money (spend, total_purchase_value) | `"0.00"`, `"1597.73"` (decimal-shaped string) | `parseFloat` |
| Ratios (ctr, complete_payment_roas, average_video_play) | `"0.00"`, `"0.27"`, `"1.42"` (decimal-shaped string) | `parseFloat` |

This matches the Meta precedent (Meta also returns strings). `normalize.ts` must coerce on every metric read. Direct number access (`row.metrics.spend + 5`) produces string concatenation bugs.

### 4. Purchase metrics (K4) — §Decision 2 CONFIRMED + attribution-split deferred

All three §Decision 2 metric names are valid at `AUCTION_ADVERTISER` data_level (empirically):

| Metric | Status | Sample format |
|--------|:------:|---------------|
| `complete_payment` | ✓ valid | `"0"` (integer string — count) |
| `total_purchase_value` | ✓ valid | `"0.00"` (decimal string — currency) |
| `complete_payment_roas` | ✓ valid | `"0.00"` (decimal string — ratio) |

**§Decision 2 KEEP — no change.** The original `complete_payment` → `UnifiedInsight.purchases` mapping is the v1.3-correct shape.

TikTok ALSO offers attribution-split alternatives (`vta_purchase` for view-through, `cta_purchase` for click-through) — both empirically valid. **DECISION**: v1 uses the aggregate `complete_payment` family for UnifiedInsight to stay consistent with Meta/Google unified purchase semantics + enable cross-platform blending in `ReportsClient`. The vta/cta attribution split is deferred to a TikTok-specific surface in v2 (see §Open Items §1) — NOT in the unified layer.

### 5. Empty-data shape (K8) — two distinct empties

Two zero-activity cases must be handled by `normalize.ts`:

| Case | Response shape |
|------|----------------|
| Advertiser with zero activity in window | `data.list = [{metrics: {spend: "0.00", impressions: "0", ...}, dimensions: {...}}]` — single row, zero-value strings |
| Advertiser that returns code 0 but no row (e.g. inactive across the entire date range) | `data.list = []` — empty array |

normalize.ts treats `parseFloat("0.00") === 0` and `parseInt("0") === 0` identically to a missing row. The empty-array case must short-circuit to "no data" UI state without crashing on `list[0]?.metrics`.

### 6. Pagination shape (K6)

```json
"data": {
  "page_info": {
    "page": 1,
    "page_size": 100,
    "total_page": 1,
    "total_number": 1
  },
  "list": [...]
}
```

All four `page_info` fields are integers (despite metrics-as-strings convention — `page_info` numeric values are NOT stringified). Standard page-based pagination; `page=1` indexed, `page_size` accepts 1-1000.

### 7. v2 ENGAGEMENT SURFACE (deferred, §Open Items addition)

The following AUCTION_AD-level metrics all validated empirically (envelope code 0, real non-zero values on active ads). They are candidates for a TikTok-specific creative detail surface in a future milestone — explicitly **NOT in v1**:

| Metric | v1.3 valid | Real-data sample value |
|--------|:----------:|------------------------|
| `video_watched_2s` | ✓ | `"21675"` (early hook) |
| `video_watched_6s` | ✓ | `"10835"` (engaged hook) |
| `engaged_view` | ✓ | `"10805"` |
| `engaged_view_15s` | ✓ | `"5358"` |
| `average_video_play` | ✓ | `"5.78"` (replays-per-impression) |
| `average_video_play_per_user` | ✓ | `"7.11"` (replays-per-user) |
| `video_views_p25` | ✓ | `"6491"` (25% completion) |
| `video_views_p50` | ✓ | `"2955"` (50% completion) |
| `video_views_p75` | ✓ | `"1684"` (75% completion) |
| `video_views_p100` | ✓ | `"1263"` (full completion) |
| `likes` | ✓ | `"278"` |
| `shares` | ✓ | `"32"` |
| `comments` | ✓ | `"3"` |
| `follows` | ✓ | `"47"` |
| `profile_visits` | ✓ | `"31"` |

These give v2 a rich engagement story (early-hook rate, completion quartiles, replay rate, social engagement). All confirmed valid at `AUCTION_AD` data_level. Adds approximately 15 fields to `TIKTOK_AD.type_data` when v2 ships.

### 8. data_level note

`/report/integrated/get/` v1 uses TWO data_levels — both empirically working:

| data_level | Use case | Dimensions |
|------------|----------|------------|
| `AUCTION_ADVERTISER` | Account-level KPI strip totals (spend, impressions, clicks, ctr, purchases, revenue, roas) | `["advertiser_id"]` |
| `AUCTION_AD` | Per-ad rows for TikTokCreativeCard grid + AdDetailModal | `["ad_id"]` |

Note the **`AUCTION_*` prefix** is the v1.3 convention — NOT `AUC_*` as session2-plan §1.1 originally documented. The session2-plan abbreviation was wrong; verified via TikTok SDK source code + empirical probe.
