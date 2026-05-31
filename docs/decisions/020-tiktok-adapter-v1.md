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

## §12c — Creative-card architecture, three paths + URL expiry (SUPERSEDES §Decision 12 static-URL + single-path assumptions, 2026-05-31)

§Decision 12 assumed a single creative path (one `/file/video/ad/info/` call yielding a stable poster URL), modeled on the M-PMax YouTube external-link precedent. Empirical creative probes against IMAA (advertiser `7327982125339328514`, 201 ads) proved the real surface is materially more complex. This amendment rewrites the creative architecture to match v1.3 reality. Source: [docs/recon/tiktok-creative-findings-2026-05-31.md](../recon/tiktok-creative-findings-2026-05-31.md).

### 1. THREE creative paths, discriminated by `identity_type`

The ad's `identity_type` field is the canonical discriminator. `normalize.ts` MUST route on it.

| Path | Detection rule | State | Visual source endpoint |
|------|----------------|:-----:|------------------------|
| **A — Direct video upload** | `video_id` populated AND `identity_type=BC_AUTH_TT` (UUID identity_id) | ✓ FULLY RESOLVED | `/file/video/ad/info/` → `data.list[].video_cover_url` (poster JPG) + `data.list[].preview_url` (playable MP4) |
| **B — Spark Ad** (boosted organic post) | `tiktok_item_id` populated AND `video_id=null` AND `identity_type=AUTH_CODE` (numeric identity_id) | ✓ FULLY RESOLVED | `/identity/video/info/` → `data.video_detail.video_info.poster_url` (poster) + `data.video_detail.video_info.url` (playable) |
| **C — Pure image ad** | `image_ids` populated AND `video_id=null` AND `tiktok_item_id=null` | ⚠️ DEFERRED to v2 follow-up | `/file/image/ad/info/` exists + accepts JSON-array `image_ids` query (multi format rejected with code 40002). Response shape UNVERIFIED — IMAA has zero pure-image ads; the only image_id probed (a video poster from a path-A ad) returned code 40001 "Insufficient permissions for some images" — different ACL surface for video-cover vs creative images. |

**Empirical share** (IMAA, 201 ads scanned across 5 pages): path A and path B both common; path C did not appear. Saudi ecommerce TikTok activity is overwhelmingly video. Paths A + B are first-class for v1; path C is rare-but-possible and handled defensively (see §3 below).

`identity_type` values observed in v1.3 on Saudi accounts:
- `AUTH_CODE` — Spark Ad authorization (numeric `identity_id`, `tiktok_item_id` populated)
- `BC_AUTH_TT` — Business Center authorized TikTok account (UUID `identity_id`, `video_id` populated)
- Other documented values not yet observed (`TT_USER`, `CUSTOMIZED_USER`) — `normalize.ts` handles defensively (defaults to path C placeholder when unrecognized + video_id is also null)

### 2. URL EXPIRY — critical architecture correction (SUPERSEDES §Decision 12's static-URL assumption)

**Both** video endpoints (path A + path B) return **signed URLs that expire in hours**:

| Field | Expiry signal | Observed TTL |
|-------|---------------|--------------|
| Path A `data.list[].preview_url` | Explicit `preview_url_expire_time` field (datetime string) + `vvpl=1&l=<request_id>` URL params | ~hours from issuance |
| Path A `data.list[].video_cover_url` | URL query params `x-expires=<epoch>&x-signature=<hmac>` | ~hours from issuance |
| Path B `data.video_detail.video_info.url` | URL query params (same signed-CDN pattern) | ~hours from issuance |
| Path B `data.video_detail.video_info.poster_url` | URL query params `x-expires=<epoch>&x-signature=<hmac>` | ~hours from issuance |

§Decision 12's `posterUrl` + `tiktokVideoUrl` design assumed cacheable static URLs. **That's wrong.** Storing signed URLs in `creatives_cache` (30-min fresh / 24-hr stale per the SWR convention) means cached URLs will 403 well before the cache row goes stale.

**Corrected architecture** (storage):

- `creatives_cache` stores ONLY the resolution inputs (IDs + identity tuple), never the URLs:
  - Path A row: `{ ad_id, video_id, identity_type: "BC_AUTH_TT", ...metrics, ...metadata }`
  - Path B row: `{ ad_id, tiktok_item_id, identity_type: "AUTH_CODE", identity_id, ...metrics, ...metadata }`
  - Path C row: `{ ad_id, image_ids[], ...metrics, ...metadata }`

**Corrected architecture** (URL resolution at render time):

The TikTokCreativeCard renders trigger a SECOND server call to resolve fresh URLs:

```
TikTokCreativeCard mount
  → GET /api/ads/creatives/tiktok-url-resolve?ad_id=X
       → server reads creatives_cache row for ad_id=X
       → routes by identity_type:
            BC_AUTH_TT → /file/video/ad/info/ with video_id
            AUTH_CODE  → /identity/video/info/ with (identity_type, identity_id, item_id)
       → returns fresh posterUrl + playableUrl
  → card renders the poster image
```

Adds **1 extra API call per card render** — accepted tradeoff to eliminate the signed-URL-expiry footgun. Matches the established Google/Meta thin-proxy precedent (Meta's discover already follows this "re-fetch live, don't cache transient state" pattern per ADR-017's Meta callback comment block).

Lazy-load coupling: the per-card URL resolve fits cleanly into the ADR-019 (M9.1) lazy-load architecture — URL resolution happens only when the card actually mounts (visible in viewport / detail modal open), not eagerly across the whole grid. Implementation guidance: the resolver route SHOULD support a batch parameter so the eager grid view can resolve N URLs in one round-trip; the detail modal uses the single-ad form.

### 3. TWO `normalize.ts` mappers — one per video endpoint

`src/lib/tiktok/normalize.ts` must implement TWO video-info mapping functions. Different read paths, same output shape (`UnifiedAdTiktok.type_data`):

```typescript
// Path A — direct video upload
function normalizeFileVideoAdInfoToCreative(
  row: FileVideoAdInfoRow  // from /file/video/ad/info/ data.list[]
): TikTokCreativeUrls {
  return {
    posterUrl: row.video_cover_url,
    playableUrl: row.preview_url,
    expiresAt: new Date(row.preview_url_expire_time),
    duration: row.duration,
    width: row.width,
    height: row.height,
  };
}

// Path B — Spark Ad
function normalizeIdentityVideoInfoToCreative(
  detail: IdentityVideoDetail  // from /identity/video/info/ data.video_detail
): TikTokCreativeUrls {
  return {
    posterUrl: detail.video_info.poster_url,
    playableUrl: detail.video_info.url,
    expiresAt: parseExpiresFromXExpiresQueryParam(detail.video_info.url),
    duration: detail.video_info.duration,
    width: detail.video_info.width,
    height: detail.video_info.height,
    caption: detail.text,                     // bonus, path B only — full post caption
    itemType: detail.item_type,                // "VIDEO" | "CAROUSEL"
    authStatus: detail.auth_info?.ad_auth_status,
  };
}
```

The `TiktokAdapter` (`src/lib/ads/providers/tiktok.ts`) routes each ad's resolve request to the correct mapper based on the cached `identity_type` value.

`UnifiedAdTiktok.type_data.videoViews` (the field defined in §Decision 12) remains as defined — sourced from `metrics.video_play_actions` per the report-shape findings amendment §1, not from any creative endpoint. The two changes are orthogonal: report-shape findings fixed the metric name; this amendment fixes the URL resolution model.

### 4. Defensive field handling — `/ad/get/` has THREE failure modes per field

Empirical probes surfaced three distinct ways `/ad/get/` handles fields:

| Mode | Example | Behavior |
|------|---------|----------|
| Valid + returned | `ad_id`, `ad_name`, `video_id`, `image_ids` | Field name accepted, value present in response (may be `null` or `[]` when no value applies) |
| 40002 hard reject | `status` (renamed in v1.3), `creative_material` (does not exist) | Whole request fails with envelope code `40002` + error message naming the invalid field |
| Silently dropped | `ad_format`, `call_to_action`, `call_to_action_id`, `creative_type`, `image_mode` on Spark Ads | Field name in TikTok's official allowed-fields list, accepted without error, but key is ABSENT from the response (no `undefined` / `null` — literally not in the response object) |

Mode 3 is the dangerous one — code assuming "the field is in the allowed list, so it'll be there" produces silent undefined-bugs. **`normalize.ts` MUST treat all `/ad/get/` fields as optional/defensive — every read uses `?.` + nullish-coalesce fallbacks. Never assume presence.**

Pattern:

```typescript
// CORRECT — defensive
const adFormat = ad?.ad_format ?? null;
const callToAction = ad?.call_to_action ?? null;

// WRONG — assumes presence
const adFormat: string = ad.ad_format;  // type-safe but RUNTIME UNDEFINED on Spark Ads
```

This applies to `/ad/get/` specifically. `/file/video/ad/info/` + `/identity/video/info/` are stricter — when they return code 0, the documented fields are present.

### 5. Defensive fallback for path C (deferred image-ad support)

When `normalize.ts` detects an ad matching path C (image_ids populated, no video, no tiktok_item_id, identity_type doesn't match A/B routing), the TikTokCreativeCard renders:

1. **Image placeholder block** (neutral background + camera icon) instead of a real preview
2. Standard metric footer (spend / impressions / clicks / CTR / purchases / revenue / ROAS)
3. Ad metadata header (ad_name, ad_text, landing_page_url)
4. Arabic footer note: `"صورة الإعلان غير متوفرة في المعاينة"` ("Ad image not available in preview")
5. NO "View on TikTok" external link — image ads don't have a tiktok.com public URL (item_id is null)
6. Vercel log signal: `[tiktok-creative] path C ad encountered, image rendering deferred: ${ad_id}` — drives the v2 promotion timing

Promotion to first-class when a real path C ad appears:
- Vercel logs surface the `[tiktok-creative]` signal
- Run a one-shot probe against that customer's `image_ids` (a TRUE direct-uploaded image, not a video cover — different ACL)
- Probe should return code 0 with the response shape (likely `data.list[].image_url` + signed-URL pattern)
- Add a third `normalize.ts` mapper + third TikTokCreativeCard render branch + ADR-020 amendment at that time

### 6. "View on TikTok" link — path B only

| Path | "View on TikTok" link | Source |
|------|----------------------|--------|
| A | NO | Direct uploads have no `tiktok_item_id` → no public tiktok.com URL exists |
| B | YES | `https://www.tiktok.com/player/v1/<tiktok_item_id>` — embed-player URL pattern, no username lookup needed, always works for any valid item_id |
| C | NO | Same as A — no item_id |

The embed player URL replaces the original §Decision 11 "share_url" plan (none of the explored endpoints actually return a `share_url` field; the constructed embed URL is the only deterministic option without resolving the source creator's `@username` via `/identity/get/`).

### 7. Supersession scope + items preserved

This §12c **SUPERSEDES**:

- §Decision 11's "external link via share_url" — no `share_url` is returned by any endpoint; the embed-player URL replaces it (path B only)
- §Decision 12's single-path video model — three paths now required (A + B + deferred C)
- §Decision 12's static-URL caching assumption — URLs are signed/expiring; IDs-only caching with per-render resolution required
- §Decision 12's `creative_material` nested-object assumption (already nominally superseded by Empirical Amendment §15c findings, restated here for the discriminator-routing context)

This §12c **PRESERVES** unchanged:

- §Decision 12's `UnifiedAdTiktok.type_data` shape — `videoViews?: number` field remains (sourced from `metrics.video_play_actions` per the report-shape amendment §1)
- §Decision 12's 9:16 vertical aspect ratio for video preview (empirically confirmed: width=1080, height=1920 in both path A and path B responses)
- §Decision 12's "no iframe embed" stance for the EMBEDDED video player on path A. (Path B's embed-iframe via `tiktok.com/player/v1/<item_id>` is the "View on TikTok" link target opened in new tab, NOT an in-card iframe — distinct concern.)

### 8. Implementation impact on Session 2 Commit 2

This amendment expands Session 2 Commit 2's scope vs the original session2-plan §5:

| New surface | What |
|-------------|------|
| `src/lib/tiktok/api.ts` | Add `getIdentityVideoInfo({advertiser_id, identity_type, identity_id, item_id})` — the path B endpoint helper. Plus `getFileImageAdInfo` placeholder returning a "deferred" sentinel (path C handler). |
| `src/lib/tiktok/normalize.ts` | TWO video mappers (`normalizeFileVideoAdInfoToCreative` + `normalizeIdentityVideoInfoToCreative`) — different input types, same output shape. Plus a `routeCreativeByIdentityType` dispatcher consumed by the URL-resolve route. |
| `src/app/api/ads/creatives/tiktok-url-resolve/route.ts` | NEW thin route — reads creatives_cache row, routes by identity_type, calls the matching video endpoint, returns fresh URLs. Single-ad + batch forms. |
| `src/components/creatives/TikTokCreativeCard.tsx` | THREE render branches: A (with playable + poster + no "View on TikTok"), B (with playable + poster + embed-iframe "View on TikTok"), C (placeholder + Arabic message + log signal). |
| `src/app/dashboard/reports/ReportsClient.tsx` | TikTok tab wires the URL-resolve route into the lazy-load layer (per ADR-019) — resolve happens on card mount, not eager grid load. |

Cache schema bump (`creatives_cache` v13 → v14) covers the storage shape change: rows now carry `{ identity_type, identity_id, tiktok_item_id }` triple for path B routing. Per Memory #28 pre-push protocol — verify all 3 providers (Meta + Google + TikTok) fetch clean post-bump before push.

Net LOC estimate revision (vs session2-plan §5's ~1,920): the URL-resolve route + path-routing dispatcher + 3-branch TikTokCreativeCard add roughly +300 LOC to the original estimate. New total estimate: ~2,200 LOC for Commit 2.

### 9. Source-of-truth references

This amendment's findings derive from these probe runs (preserved in `scripts/` per ADR-020 §18 disposition-B):

- `_tiktok-spark-creative.mjs` — identity_type discrimination + video_id hunt
- `_tiktok-final-shapes.mjs` — `/identity/video/info/` shape (path B) + `/file/image/ad/info/` request-shape-only (path C deferred)
- `_tiktok-creative-probe.mjs` — `/file/video/ad/info/` shape (path A) + `/ad/get/` field behavior (three failure modes)

Full raw response evidence catalogued in [docs/recon/tiktok-creative-findings-2026-05-31.md](../recon/tiktok-creative-findings-2026-05-31.md) — that recon doc is canonical for the verbatim JSON shapes; this amendment is the architectural-decision distillation.

## §2b — Revenue metric correction: `total_complete_payment_rate`, not `total_purchase_value` (2026-05-31, live-data verified)

§Decision 2 + the Report-Shape Empirical Findings §4 chose `total_purchase_value` as the revenue metric (paired with `complete_payment` count + `complete_payment_roas` ratio). Live integration testing against IMAA (a real website-pixel Saudi store, May 2-31) proved this returns 0 for website-attributed purchases — `total_purchase_value` is the APP-attribution value metric (internal ID `time_attr_total_repetitive_active_pay_value` — the `active_pay` family), which is 0 for any pure website pixel store.

The CORRECT website revenue metric is **`total_complete_payment_rate`**.

### ⚠️ NAMING TRAP

Despite the `_rate` suffix, this metric is the **aggregate VALUE in account currency**, NOT a rate/percentage. TikTok's internal ID is `time_attr_total_shopping_value` (per the SDK YAML mapping in `smart_plus_material_report_overview.yml`), which confirms it's a SUM-of-values, not a ratio. The API key name appears to be a TikTok SDK naming inconsistency — the value family generally uses `total_*_value` suffixes, but this particular metric got `_rate` instead. Documented prominently in `src/lib/tiktok/api.ts` next to the metric so no future reader "fixes" the apparent rate-vs-value mismatch.

### Live-data evidence (IMAA, advertiser `7327982125339328514`, May 2-31, AUCTION_ADVERTISER)

| Source | Value | Method |
|--------|------:|--------|
| **`total_complete_payment_rate`** (direct) | **456,410.51 SAR** | single metric request |
| `value_per_complete_payment` × `complete_payment` | 456,404.20 SAR | per-event (246.04) × count (1855) |
| `spend` × `complete_payment_roas` | 456,335.83 SAR | computed sanity check |
| **Platform UI "Purchase value (website)" sum** | **456,409 SAR** | 391,681 + 35,870 + 28,858 across 3 active campaigns |

Three independent computation paths converge within **0.02%** (max delta 75 SAR on a 456,410 SAR figure). The direct metric matches the platform within **0.00%** (1.51 SAR delta).

### Per-campaign verification — exact platform UI match

| campaign_id | spend (SAR) | count | API `complete_payment_roas` | Platform UI "Payment completion ROAS (website)" |
|-------------|------------:|------:|----------------------------:|------------------------------------------------:|
| 1856897020453890 | 7,490.05 | 116 | **4.79** | **4.79** ✓ |
| 1856896918015106 | 7,429.86 | 74 | **3.88** | **3.89** (rounding) ✓ |
| 1833373551147026 | 70,058.46 | 1,665 | **5.59** | **5.59** ✓ |

The platform UI's `4.79 / 3.89 / 5.59` figures the user reported map verbatim to the API's per-campaign `complete_payment_roas` values. **The `complete_payment_roas` metric IS the website ROAS**, NOT app-attribution — the original "app-attribution" hypothesis was wrong; the confusion was in the platform UI's separate "Purchase ROAS (app)" label (a distinct metric that returns 0 for website stores) vs "Payment completion ROAS (website)" (the one our metric matches).

### §Decision 2 metric set correction

| Metric | Action | Reason |
|--------|--------|--------|
| `total_purchase_value` | **REMOVE** from request list | App-attribution (active_pay family); returns 0 for website pixel stores — wrong family entirely |
| `complete_payment_roas` | **REMOVE** from request list | Metric itself is VALID + correct (returns website ROAS), but we compute `roas = revenue / spend` client-side per the null-safe contract pattern (see `src/lib/tiktok/normalize.ts` — null on zero spend, distinct from 0). The metric remains a documented diagnostic reference but is not requested. |
| `complete_payment` | KEEP unchanged | Returns the correct website purchase count from the same shopping family |
| `total_complete_payment_rate` | **ADD** to request list | Website-pixel aggregate revenue per this amendment's evidence |

Net change to `INSIGHTS_METRICS_ACCOUNT` / `INSIGHTS_METRICS_CAMPAIGN` / `INSIGHTS_METRICS_AD`: **−2 metrics, +1 metric → 11 → 10 metrics per `/report/integrated/get/` call**.

### `normalize.ts` mapper change

Single line in `normalizeReportRowToInsight`:

```typescript
// Was:
const revenue = extractNumber(m, "total_purchase_value");
// Now:
const revenue = extractNumber(m, "total_complete_payment_rate");
```

The `roas` and `costPerPurchase` null-safe computation logic is unchanged (`roas = spend > 0 ? revenue / spend : null`; `costPerPurchase = purchases > 0 ? spend / purchases : null`). The contract semantics from 2b-1 stay intact — TikTok purchases/revenue are always numbers (never null per pixel-native; 0 = real zero, not "no data"). Only the source metric name changes.

### Generalization — applies to the full Saudi/Gulf customer base

TikTok Pixel's `CompletePayment` event is the standard website-conversion event for ecommerce platforms. Per the TikTok Pixel installation docs:

- **Salla** uses CompletePayment for order-completion firing
- **Zid** uses CompletePayment for order-completion firing
- **Custom website pixels** (Shopify-hosted, WordPress/WooCommerce, headless React/Next.js storefronts) follow the same convention

The internal ID family `time_attr_shopping*` (which `total_complete_payment_rate` belongs to) captures ALL CompletePayment events. So this correction covers the entire Saudi/Gulf ecommerce customer profile — not just IMAA. The `active_pay` family that `total_purchase_value` belongs to is for APP-install + in-app-purchase campaigns, which is a different ad-objective surface (`APP_PROMOTION` rather than `WEB_CONVERSIONS`). ArabiaDash's customer focus is `WEB_CONVERSIONS` advertisers, so app-attribution metrics are universally wrong for our use case.

### Open checkpoint (NOT corrected here — deferred)

API `complete_payment` account-total returned 1,855 while platform UI's "Purchases (website)" showed 1,665. Investigation confirmed:

- 1,665 is the dominant campaign's per-campaign count (campaign 1833373551147026), not the account total
- 1,855 is the API account-level sum (1,665 + 74 + 116 across the 3 active campaigns)
- NOT a discrepancy — different aggregation scopes (the platform UI may default to the highest-spend campaign's headline number; the API returns the true account aggregate)

Attribution window may also contribute small deltas: platform UI typically defaults to "7-day click + 1-day view" attribution while the API may default to "7-day click" or another window. The API has request params for `attribution_event_lookback_window` + `attribution_view_lookback_window` that could be added to align if a customer reports the difference. **Deferred** — current values are within 0.02% on revenue + ROAS, which is the load-bearing metric. Worth a future probe if attribution-window alignment becomes a customer concern.

### Probe evidence

- `scripts/_tiktok-website-attribution.mjs` — initial onsite_shopping family probe (family doesn't exist for IMAA; rules out the wrong path)
- `scripts/_tiktok-revenue-metric.mjs` — final probe that identified `total_complete_payment_rate` + cross-validated 3 methods against platform UI

Both throwaway (untracked); preserve in Session 3's `chore(scripts)` commit per ADR-020 §18 disposition-B since they document the empirical chain that landed this correction.

### Supersession + preservation

This §2b **SUPERSEDES**:

- §Decision 2's `total_purchase_value` → `revenue` mapping (incorrect family — replaced with `total_complete_payment_rate`)
- Report-Shape Empirical Findings §4's listing of `total_purchase_value` as a "valid + verified" purchase metric (the metric is valid as an API name but returns wrong-family data for website stores — corrected here)

This §2b **PRESERVES** unchanged:

- §Decision 2's `complete_payment` → `purchases` mapping (count correct + website-family confirmed)
- §Decision 2's pixel-native semantic (`hasConversionData: true` always — TikTok pixel is the platform-native attribution source)
- The null-safe `roas` + `costPerPurchase` computation pattern from 2b-1's normalize.ts
- The deferral of `vta_purchase` / `cta_purchase` attribution-split metrics to a v2 TikTok-specific surface

## §Lifetime — Chunked-fetch architecture for true lifetime semantics across long-history accounts (2026-05-31, supersedes commit 772f500's single-request 365-day clamp)

Commit 772f500 fixed the immediate "lifetime returns empty grid" symptom by clamping the `lifetime` preset to 365 days in `src/lib/tiktok/api.ts:resolveRangeToDates`. That fix unblocked the lifetime range from erroring out (`code:40002 max time span must be less than 365 days`) but introduced a different problem: **TikTok's "lifetime" now means "last 365 days"**, while Meta's lifetime means "since account inception" via the real `date_preset=maximum` preset, and Google's lifetime path is similarly unbounded. Cross-platform semantic drift — same UI label, materially different data scopes.

Live-data evidence against IMAA (2026-05-31) proved the drift hides real customer data, not just an edge-case. This amendment moves TikTok lifetime to **chunked-fetch + client-side merge** to restore semantic parity with the other adapters.

### Live-data evidence (IMAA, advertiser `7327982125339328514`)

`/advertiser/info/` returns a `create_time` field (Unix epoch seconds) that we do NOT currently capture in `TiktokAdvertiserInfo`:

| Field | Value | Decoded |
|-------|------:|---------|
| `create_time` | `1706178822` | **2024-01-25 UTC** (account inception) |

Chunked AUCTION_ADVERTISER probe (`scripts/_tiktok-history-chunked-probe.mts`, 2026-05-31) over 7 × 365-day windows back from today:

| Chunk | Window | Spend (SAR) | % of total history |
|-------|--------|------------:|-------------------:|
| 0 (current 365d clamp covers) | 2025-05-31 → 2026-05-31 | **570,096.94** | **70%** |
| 1 | 2024-05-31 → 2025-05-30 | 222,086.06 | 27% |
| 2 | 2023-06-01 → 2024-05-30 | 22,386.44 | 3% |
| 3-6 (pre-creation) | older | 0 | 0% |
| **Total IMAA history** | ~2.4 years | **~814K** | 100% |

**~30% of IMAA's total TikTok spend (~244K SAR) lives BEYOND the current 365-day clamp.** Chunks 1+2 are real customer history the clamp truncates.

### Paused-ad coverage gap (the load-bearing evidence)

Cross-referencing `/ad/get/` inventory (no status filter) with the AUCTION_AD report per-chunk:

| Metric | Count |
|--------|------:|
| Total ads (`/ad/get/`) | 201 |
| Paused ads (`operation_status != ENABLE`) | 101 |
| Ads with spend > 0 anywhere in history | 194 |
| **Paused ads with spend > 0 anywhere in history** | **96** |
| **Paused ads whose spend is ONLY beyond 365d (clamp truncates)** | **96 of 96 (100%)** |

Every single paused-with-spend ad for IMAA spent before the 365-day clamp, then was paused. The current clamp makes **all 96 of them invisible**. The user-facing complaint "paused ads with results don't show" is a legitimate coverage gap, not a misperception — the ads exist, they had real spend, they were paused, and they fall entirely outside the visible window. The earlier dismissal of Observations 5/6 as "behavior is correct" was based on the 90-day probe; the chunked probe across full history shows the opposite.

### Why TikTok is the only platform that needs this

| Platform | Lifetime semantic | API capability |
|----------|------------------|----------------|
| Meta | `date_preset=maximum` | Native lifetime preset; Meta resolves against full account history server-side ([src/lib/meta/api.ts:305-323](../../src/lib/meta/api.ts#L305-L323)) |
| Google | preset-driven | Google Ads API has no per-query hard cap that requires client chunking for the typical account lifetime |
| **TikTok** | NO lifetime preset + **HARD 365-day per-request cap** (`code:40002 max time span must be less than 365 days`, probe-confirmed at exactly the 365/366 boundary) | Must synthesize lifetime client-side by chunking |

This is TikTok-specific work. The `resolveRangeToDates` helper in `src/lib/tiktok/api.ts` is already TikTok-scoped (Meta has a separate file-private `resolveRangeToDates`; Google has its own date-handling). The chunking logic stays within TikTok files. **Zero Meta / Google regression risk.**

### Decision

Replace TikTok's lifetime path with chunked-fetch + client-side merge. Single-request paths for finite-window presets (`7d`, `30d`, `90d`, `365d`, custom ranges) remain unchanged.

#### Chunking policy

1. **Lower bound**: account `create_time` from `/advertiser/info/` (capped at today − N days for sanity, where N is the largest documented TikTok history retention — empirically ~3 years per probe data, but in practice the account's `create_time` is always tighter).
2. **Chunk size**: 365 days (the probe-confirmed boundary — `365d` succeeds at `code:0`, `366d` errors at `code:40002`).
3. **Chunk count**: `ceil((today − create_time) / 365)`. For IMAA (2.4y history) = 3 chunks. For a 5-year power-user account = 6 chunks. Bounded by retention.
4. **Execution**: `Promise.all` over the chunks — N parallel `/report/integrated/get/` calls, not sequential.
5. **Off-by-one safety**: chunk N covers `[today − 365(N+1), today − 365N − 1]` to avoid double-counting the boundary day. Tested across the 365/366 cap probe; the empirical 365-inclusive behavior matches.

#### Merge rules (load-bearing — getting this wrong silently corrupts metrics)

The merge happens per dimension key (`advertiser_id` for account-level, `campaign_id` for campaign-level, `ad_id` for ad-level).

| Metric class | Examples | Merge rule | Why |
|--------------|----------|------------|-----|
| **Additive** | `spend`, `impressions`, `clicks`, `complete_payment` (purchases), `total_complete_payment_rate` (revenue per §2b), `reach` (caveat below) | **SUM across chunks** | Each chunk reports a window-scoped sum; cross-chunk total = sum of windows. |
| **Ratios — recomputed in the MERGE layer** | `ctr`, `cpc`, `cpm`, `frequency` | **RECOMPUTE from summed components BEFORE building the synthesized row** | These metrics are PASSTHROUGH in [`normalizeReportRowToInsight`](../../src/lib/tiktok/normalize.ts) (the normalizer reads them as-is from `row.metrics`). Summing them in the merge would produce sum-of-percentages (garbage). The merge layer recomputes from summed components: `ctr = clicks / impressions * 100`, `cpc = spend / clicks`, `cpm = spend / impressions * 1000`, `frequency = impressions / reach`. Standard recompute, ~6 lines. |
| **Ratios — recomputed in the NORMALIZER** | `roas`, `costPerPurchase` | **NOT recomputed by the merge** — passed through as summed `spend` / `revenue` / `purchases`, then `normalizeReportRowToInsight` recomputes correctly downstream | The normalizer already computes these client-side per §2b's null-safe contract (`roas = spend > 0 ? revenue / spend : null`; `costPerPurchase = purchases > 0 ? spend / purchases : null`). Feeding it the merged spend/revenue/purchases produces correct merged roas + costPerPurchase. No duplication. |
| **Caveat: `reach`** | unique-reach across chunks | **SUM is an overestimate** (the same user reached in chunks 0 and 1 is counted twice). | We don't currently surface `reach` as a load-bearing metric in the v1 KPI set; if added later, this needs a deduplication strategy or an explicit "reach is window-scoped" UI disclaimer. Out of scope for this amendment — flagged for the same future work as the §Open Items reach metric addition. |

**Split responsibility — merge layer vs normalizer**: the merge step constructs a single synthesized `TiktokReportRow` per dimension key by (1) summing additive metrics across chunks, (2) recomputing `ctr` / `cpc` / `cpm` / `frequency` from those summed components and writing them into the synthesized row, then feeding the row through the existing normalizer. The normalizer's existing null-safe computation handles `roas` + `costPerPurchase` from the merged components; `ctr` / `cpc` / `cpm` / `frequency` are passthrough at the normalizer layer but already-correct because the merge layer recomputed them. **No normalizer signature change.** **The §2b correction is preserved** — `total_complete_payment_rate` (revenue) is additive across chunks (sum-of-sums = total website revenue), and `roas` is recomputed from the merged components by the normalizer.

#### `create_time` capture approach

Two viable approaches:

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **(A) Call `/advertiser/info/` inside the lifetime path** | Zero schema change; no migration; data is always fresh; trivial | One extra API call per lifetime fetch (~200ms overhead) | ✅ Pick this for v1 |
| (B) Thread `create_time` through `select-accounts` into `connections.metadata` | One-time fetch; no per-request overhead | Requires schema (or metadata-jsonb) work; existing TikTok rows lack the field and need a backfill path | Defer to a later optimization if the extra call shows up in latency budgets |

The lifetime path is by definition rare (user explicitly opts into a max-history view), and `create_time` doesn't change. The extra call is amortized by cache (the lifetime cache entry covers most subsequent lifetime requests within TTL). Option A is the right call for v1; revisit if real-world telemetry shows the overhead matters.

#### Cache interaction

`insights_cache` keys by `(connection_id, provider, cache_key)`. The route at [src/app/api/ads/insights/route.ts](../../src/app/api/ads/insights/route.ts) builds `cache_key` from a string-prefix + `cacheKeyRangePart`, where `cacheKeyRangePart === "lifetime"` for the lifetime preset.

**Decision: one merged cache entry per `(account, level, lifetime)` tuple.**

- Cache **hit**: single DB read returns the pre-merged lifetime result. Same speed as today's 365d clamp behavior.
- Cache **miss**: fire N parallel chunk requests → merge → write ONE cache row with the merged result. The TTL (`CACHE_TTL_MINUTES = 15` and the SWR `INSIGHTS_FRESH_MINUTES = 15` / `INSIGHTS_STALE_HOURS = 24` from [src/lib/ads/cache.ts](../../src/lib/ads/cache.ts)) applies uniformly.
- `?refresh=true`: invalidates the lifetime cache entry → re-fires all N chunks on next read.
- No per-chunk caching: simpler invalidation semantics; no risk of partial-stale composition (e.g. chunk 0 fresh, chunk 1 stale, merging produces inconsistent metrics for a single rendered point).

**No cache schema bump.** The cache `data` column is jsonb; the merged result has the same shape as a single-chunk result (an array of `UnifiedInsight` rows). Existing cache schema v13 (post-§2b) accommodates the change transparently. **Memory #28 protocol still applies pre-push** — Meta + Google paths are unchanged so the cache-bump validation is a smoke-test, not a schema bump.

#### Deploy-day action: stale lifetime cache entries (NOT a schema bump)

Existing `insights_cache` rows whose `cache_key` ends with `:lifetime` hold pre-amendment data — i.e. the 365-day-clamped result. After this amendment lands, a lifetime cache HIT on one of those entries would return stale 365-day data instead of triggering the new chunked path. The data is wrong-shape semantically (covers only the last year, not full history) even though it's same-shape structurally (still `UnifiedInsight[]`).

**Stale window without intervention**: lifetime rows enter `stale_until` at deploy time + 24h (`INSIGHTS_STALE_HOURS = 24`) and continue serving via SWR until then. Worst case: a user opening the TikTok lifetime view 23 hours and 59 minutes after deploy gets the clamped result and revalidation hands them the chunked result silently in the background — the next refresh is correct, but the first view shows last-year-only with no surface signal that it's stale-shape.

**Decision: targeted invalidation on deploy.** Run ONE SQL statement post-deploy to delete the affected cache keys:

```sql
DELETE FROM insights_cache
WHERE provider = 'tiktok'
  AND cache_key LIKE '%:lifetime:%';
```

This is **not** a schema bump (Memory #28 risk avoided — no `CACHE_SCHEMA_VERSION` change, no universal cache flush across all platforms, no cold-cache cost for Meta/Google). It is one targeted DELETE on the rows specifically affected by this amendment. The first post-deploy lifetime fetch for each account re-runs the chunked path and writes a fresh entry. All other range presets (`7d`, `30d`, `90d`, `365d`, `custom`) for TikTok keep their cache — they're unchanged by this amendment. Meta + Google cache untouched.

**Rejected: rely on TTL expiry alone.** 24h of stale-shape data on a feature shipping the correctness gain is a self-defeating launch. Targeted DELETE is one SQL statement; the cost-benefit is overwhelmingly in favor of explicit invalidation.

The DELETE statement runs as part of the same commit that ships the amendment — surfaced for explicit user approval, executed once against production after the deploy reports healthy, then forgotten. No recurring action.

### Implementation scope (files that change vs files that don't)

**Files that change:**

| File | Change | LOC est. |
|------|--------|----------|
| `src/lib/tiktok/api.ts` | (a) `TiktokAdvertiserInfo` interface gains `create_time?: number` (we already fetch `/advertiser/info/` but don't capture the field); (b) new `chunkLifetimeRange(createTime)` helper returning `{since, until}[]`; (c) new `fetchAccountInsightsLifetime` / `fetchCampaignInsightsLifetime` / `fetchAdInsightsLifetime` wrappers that dispatch chunked-or-single based on `range === "lifetime"`; (d) `resolveRangeToDates` lifetime branch keeps 365d clamp as defensive fallback for callers that bypass the wrappers | ~100-130 |
| `src/lib/ads/providers/tiktok.ts` | Switch the three insight methods to call the new `*Lifetime` wrappers; no behavior change for non-lifetime ranges | ~10 |
| `docs/decisions/020-tiktok-adapter-v1.md` | This amendment | — |

**Files that explicitly do NOT change:**

| File | Why |
|------|-----|
| `src/lib/ads/cache.ts` | Cache schema unchanged; merged-result-as-single-row pattern fits the existing jsonb shape |
| `src/app/api/ads/insights/route.ts` | Route logic unchanged — chunking is fully internal to the adapter layer |
| `src/lib/meta/api.ts` / Meta provider | Untouched — Meta lifetime semantic stays correct via `date_preset=maximum` |
| `src/lib/google-ads/*` | Untouched |
| `src/lib/tiktok/normalize.ts` | The existing `normalizeReportRowToInsight` is reused; no normalizer change |
| `src/lib/ads/types.ts` | `UnifiedInsight` shape unchanged; merge produces same-shape rows |

**Files that change as a side effect (optional):**

| File | Change |
|------|--------|
| `src/lib/tiktok/api.ts` `getAdvertiserInfo` callers | None forced — `create_time` is captured opportunistically. The select-accounts route may opt to store it in `connections.metadata` for future optimizations, but this is OUT of scope for the amendment. |

### What gets surfaced to the user after this lands

- Lifetime tab on TikTok now reflects **all spend since `create_time`**, not the last 365 days
- The 96 paused-with-historical-spend IMAA ads (96 / 101 = 95% of paused inventory) become visible in lifetime view
- Total visible spend goes from ~570K to ~814K (+43%) for IMAA at the lifetime preset
- Cross-platform "lifetime" semantic is consistent across Meta + Google + TikTok tabs
- Other range presets (7d / 30d / 90d / 365d / custom) — **unchanged in any behavior**

### Performance budget

Lifetime cache hit ≈ today's speed. Lifetime cache miss adds 1 advertiser_info call + N parallel chunk calls (N ≈ 3 for IMAA's 2.4-year history; bounded by retention). Within TTL, lifetime is as fast as any other range. Post-merge optimizations if telemetry shows cold-fetch cost matters: pre-warm lifetime cache via background job, or persist `create_time` in `connections.metadata` to skip the per-fetch advertiser_info call.

### Probe evidence

- `scripts/_tiktok-lifetime-paused-probe.mts` (2026-05-31) — established the 365-day per-request hard cap at the 365/366 boundary; surfaced the `code:40002 max time span must be less than 365 days` error response shape
- `scripts/_tiktok-paused-spend-probe.mts` (2026-05-31) — proved the 90-day window has 0 paused-with-spend ads for IMAA, which was the initial misleading "behavior is correct" data point that nearly closed Observations 5/6 as a non-issue
- `scripts/_tiktok-history-chunked-probe.mts` (2026-05-31) — the load-bearing probe: confirmed IMAA's 2.4-year history, the 30% spend-beyond-clamp gap, and the 96 paused-with-historical-spend ads invisible to the 365d clamp. Also captured the `create_time` field availability on `/advertiser/info/`.

All three are throwaway (untracked); preserve in Session 3's `chore(scripts)` commit per ADR-020 §18 disposition-B since the chain landing this amendment depends on the probe evidence trail. The chunked-history probe specifically should be retained as the empirical baseline for future lifetime regressions.

### Supersession + preservation

This §Lifetime amendment **SUPERSEDES**:

- Commit `772f500`'s 365-day single-request lifetime clamp as the architectural answer for lifetime semantics. The 365-day value remains as a defensive fallback inside `resolveRangeToDates` for callers that bypass the chunked wrappers, but is no longer the user-facing lifetime semantic.
- The earlier triage finding that classified Observations 5/6 as "behavior is correct, IMAA has no paused-with-spend ads" — the 90-day probe that supported that finding sampled too narrow a window; the full-history probe inverts the conclusion.

This §Lifetime **PRESERVES** unchanged:

- §2b's revenue metric set (`total_complete_payment_rate` remains the revenue source; additive across chunks)
- §2b's null-safe roas/costPerPurchase computation pattern (the merge reuses it for the recompute step)
- `normalizeReportRowToInsight`'s pixel-native semantic (TikTok purchases/revenue stay non-null; 0 = real zero)
- The single-request path for all non-lifetime ranges (`7d` / `30d` / `90d` / `365d` / `custom`)
- The route-layer cache contract (`insights_cache` schema, key shape, TTL)
- Memory #28's cache-bump pre-push protocol (still applies — Meta + Google paths must validate even though this work is TikTok-only)
- Meta's `date_preset=maximum` lifetime path (untouched by definition)
