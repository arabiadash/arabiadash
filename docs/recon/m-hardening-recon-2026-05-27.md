# M-hardening recon — Google Ads token lifecycle + Issue #1 + Issue #4

**Date:** 2026-05-27
**Mode:** READ-ONLY (audit + live probe; no code changes)
**Probe:** `scripts/_diagnose-google-token-lifecycle.mjs`
**Scope:** Issue #4 Phase A (production-grade token handling) + Issue #1 (re-sync dropped Google accounts) preflight

---

## TL;DR

- **Refresh tokens are stored PLAINTEXT in TWO columns**: canonical `platform_credentials.refresh_token` + duplicated `connections.access_token` (the column name is provider-agnostic — for Google it actually holds the refresh_token).
- **`refreshAccessToken()` helper exists but is NEVER CALLED** anywhere. All access_token refresh happens implicitly inside the `google-ads-api` SDK at request time.
- **Zero retry / zero backoff / zero structured observability.** On `invalid_grant` the adapter throws → API returns 500 → user sees a fetch-failed state. No Sentry, no alert, no auto-recovery.
- **ADR-010 drift confirmed in TWO read paths** (`factory.ts:113`, `sync-accounts-logic.ts:37`) — they read `connections.access_token` instead of `platform_credentials.refresh_token`. Currently benign for imaa (✓ MATCH per Q3) because re-OAuth happened before account-selection. **Breaks the moment a user re-OAuths without re-running select-accounts.**
- **Issue #1 (re-sync dropped accounts) — flow already exists.** `/dashboard/connections/google/select` reads from `platform_credentials`, lists all 15 accessible accounts, lets user re-select. Zero new code needed for the imaa scenario. If a one-click "re-sync all" button is desired, it's ~30 LOC on top of the existing select-accounts endpoint.
- **Live token state for imaa:** ✓ valid, 15 accessible customers, only 1 persisted (`5473228670 imaa perfumes`). Gap of 14 accounts the user could re-add via the existing selector.

---

## Task 1 — Current implementation audit

### Storage architecture

| Column | Source | Refresh path |
|--------|--------|--------------|
| `platform_credentials.refresh_token` | OAuth callback ([callback/route.ts:85-97](../../src/app/api/google-ads/callback/route.ts#L85-L97)) — `onConflict: user_id,platform` upsert | Updated on every re-OAuth |
| `connections.access_token` | `/api/google-ads/select-accounts` ([select-accounts/route.ts:116-125](../../src/app/api/google-ads/select-accounts/route.ts#L116-L125)) — duplicates `platform_credentials.refresh_token` into every selected-account row | **Updated only when user runs select-accounts. Re-OAuth does NOT propagate here.** |

Both columns store **plaintext** refresh tokens. No app-level encryption. Tokens are masked in scripts/logs (8-char prefix + 6-char suffix in [_diagnose-google-token-lifecycle.mjs](../../scripts/_diagnose-google-token-lifecycle.mjs)) but **stored unmasked at rest**, relying on Postgres + Supabase ACL.

### Refresh triggers

| Trigger | Status |
|---------|--------|
| On-demand at API request time (SDK-internal) | ✓ — `google-ads-api` SDK takes `refresh_token` in `api.Customer({...})` and refreshes the access_token implicitly per call ([oauth.ts:124-130](../../src/lib/google-ads/oauth.ts#L124)) |
| Scheduled background refresh | ✗ — no cron job, no Vercel scheduled function |
| Application-level `refreshAccessToken()` helper | **Defined but unused.** [oauth.ts:90-117](../../src/lib/google-ads/oauth.ts#L90-L117) exports it; grep shows zero call sites. Dead code. |

### Failure handling

| Failure | What happens |
|---------|--------------|
| `invalid_grant` (revoked refresh_token) | SDK throws → `errors.GoogleAdsFailure` bubbles up through adapter → API route's outer try/catch returns 500 → frontend shows "fetch failed" |
| Network / 5xx transient | Same path. No retry. |
| Expired access_token (1h TTL) | SDK auto-refreshes; user never sees this case. |
| Invalid scope / consent revoked at Google | Same as `invalid_grant`. |

**Retry logic:** none anywhere. Single attempt, immediate fail.

**Logging:** `console.error` only ([callback/route.ts:125](../../src/app/api/google-ads/callback/route.ts#L125), [factory.ts](../../src/lib/ads/factory.ts) throws, [google.ts catch sites](../../src/lib/ads/providers/google.ts)). Vercel function logs catch these. **No Sentry. No structured error events. No alerting.** Past invalid_grant on imaa (2026-05-25) was diagnosed only because the user reported "0 campaigns regression" after a cache bump — there was no proactive signal.

### Call sites that pass `refreshToken` to the SDK

| File | Count | Pattern |
|------|-------|---------|
| `src/lib/ads/providers/google.ts` | 6× | `refresh_token: this.refreshToken` inside `api.Customer({...})` |
| `src/lib/google-ads/{assets,extensions,keywords,conversion-actions,customer,campaigns,ads,timeseries}.ts` | 1× each | Same pattern, called from the adapter |
| `src/lib/google-ads/oauth.ts:217` | 1× | `getEnrichedCustomerClients` (discovery) |

All take `refreshToken` as a function arg → pass to SDK → SDK handles access_token lifecycle internally. There's no single chokepoint where a refresh failure could be intercepted/retried/escalated.

---

## Task 2 — Issue #1 scope check

**Issue #1 title:** "Re-sync 4 Google accounts dropped during migration"

### Existing infrastructure (already in place)

| Piece | Path | Purpose |
|-------|------|---------|
| Refresh token storage | `platform_credentials` | Survives `connections` row deletion |
| Discovery endpoint | [/api/google-ads/discover](../../src/app/api/google-ads/discover/route.ts) | Reads `platform_credentials.refresh_token`, calls `listAccessibleCustomers` + `getEnrichedCustomerClients`, returns all accessible accounts with `is_already_connected` flag |
| Selector UI | `/dashboard/connections/google/select` | Renders discoverable accounts, lets user multi-select |
| Persistence endpoint | [/api/google-ads/select-accounts](../../src/app/api/google-ads/select-accounts/route.ts) | Upserts selected accounts to `connections` with `status='active'`, auto-runs `syncGoogleAccountsForUser` for metadata enrichment |

### What "Re-sync" would actually need

**Option A — zero new code:** The flow already works. User visits `/dashboard/connections/google/select`, sees the 14 missing accounts (per Q5 probe), re-selects → done. The "missing 4 accounts" framing in Issue #1 is **stale** — reality is 14 accessible-but-not-persisted accounts for imaa.

**Option B — UX polish (one-click re-sync button):** Add a "إعادة مزامنة جميع الحسابات" button on `/dashboard/connections` that:
1. Calls `/api/google-ads/discover` to list accessible accounts.
2. Filters to `is_already_connected: false`.
3. POSTs all those IDs to `/api/google-ads/select-accounts`.
4. Shows a toast with the count.

Estimated LOC: **~30** (one button + one client-side handler). Backend reuse: 100%.

**Option C — Migration-specific recovery:** If Issue #1 specifically refers to 4 accounts dropped by a past migration that the user no longer wants to manually re-pick, a one-shot SQL recovery (3-5 lines) restores them. Likely overkill given Options A/B work.

**Recommendation:** Option A is enough to close Issue #1. Option B is a 30-LOC quality-of-life addition.

---

## Task 3 — Live token lifecycle test (imaa)

Probe output: see [scripts/_diagnose-google-token-lifecycle.mjs](../../scripts/_diagnose-google-token-lifecycle.mjs) — 5 questions Q1-Q5.

| Q | Finding |
|---|---------|
| **Q1** | `user_id = e865198f-643d-4440-bb93-0ce2dfdcde85`, last sign-in 2026-05-26 |
| **Q2** | refresh_token EXISTS (len=103), scope = `adwords`, `created_at = updated_at = 2026-05-24T22:25:33Z` → **token never re-issued since initial OAuth.** `expires_at` column shows -47h (stale; column tracks access_token's 1h TTL, NOT refresh_token expiry — naming is misleading). |
| **Q3** | 1 connection row (`5473228670 imaa perfumes`, status=active). `connections.access_token` ✓ MATCHES `platform_credentials.refresh_token` → no ADR-010 drift for this user **right now** (would drift if user re-OAuths). |
| **Q4** | ✓ Live `listAccessibleCustomers` SUCCESS (6450ms latency). 15 customers returned. Token is currently valid. |
| **Q5** | 15 accessible / 1 persisted → **14-account re-sync gap.** Issue #1's "4 accounts" framing is outdated. |

### Past refresh attempts in logs

`platform_credentials.updated_at = created_at` confirms no re-OAuth has happened since 2026-05-24. The 2026-05-25 invalid_grant incident in CLAUDE.md predates the current row (the current `id=3` row was written by the user's re-auth on 2026-05-25 per CLAUDE.md §10). Vercel function logs are not queryable from this probe — would need `vercel logs --since=72h | grep -i "google.*refresh\|invalid_grant"` for historical refresh attempts.

---

## Gap analysis — Issue #4 Phase A scope

### What's already there

- ✓ Refresh token persisted in `platform_credentials` (one row per user/platform; ADR-010).
- ✓ `refreshAccessToken()` helper function ready to wire up ([oauth.ts:90](../../src/lib/google-ads/oauth.ts#L90)).
- ✓ Token masking in probe scripts (operational hygiene).
- ✓ SDK handles access_token TTL automatically.

### What's missing

| Gap | Severity | Notes |
|-----|----------|-------|
| **ADR-010 drift in read paths** (`factory.ts`, `sync-accounts-logic.ts` read `connections.access_token`) | HIGH | Issue #25. Will silently break re-OAuth scenarios for any user. |
| **No `invalid_grant` detection / surfacing** | HIGH | Errors are logged but user sees only a generic 500. No "please reconnect Google" CTA. |
| **No retry on transient failures** | MEDIUM | Single network blip surfaces as a fetch error. Exponential backoff with N=3 attempts is industry standard. |
| **No structured observability** | MEDIUM | Sentry / equivalent for any error class, not just OAuth. Phase 11 launch blocker. |
| **`expires_at` column is misleading** | LOW | Tracks access_token TTL (1h) but the access_token isn't stored — only the refresh_token. Either rename to `access_token_expires_at` or drop the column. Pure tech debt. |
| **No background refresh / health check job** | LOW | Could pro-actively detect invalid_grant via a daily probe and email the user. Not strictly needed if surfacing is good. |
| **Refresh tokens stored plaintext** | LOW (for now) | Supabase RLS + service-role gating is the current guardrail. App-level encryption (libsodium / AWS KMS) is a Phase 10+ hardening item. |

### Issue #4 Phase A — minimum viable hardening

Suggested commit-sized scope, in priority order:

1. **Fix ADR-010 drift** — change `factory.ts` + `sync-accounts-logic.ts` to read `platform_credentials.refresh_token` instead of `connections.access_token`. Drop the duplicate write in `select-accounts/route.ts:121`. Closes Issue #25 simultaneously.
2. **Surface `invalid_grant` to UI** — catch `GoogleAdsFailure` in the adapter, map to a typed `ReauthRequiredError`, propagate through `/api/ads/insights` + `/api/ads/creatives` as 401 with `reason: 'reauth_required'`. Frontend shows "أعد ربط حساب Google" CTA pointing at the OAuth URL.
3. **Add retry-with-backoff for transient failures** — wrap the SDK call in `withRetry({ attempts: 3, backoffMs: [500, 1500, 4500] })`. Skip retry for `invalid_grant` / auth-class failures (those need user action, not a retry).

Optional Phase A bonus:
4. Drop / rename misleading `expires_at` column.
5. Add `last_refresh_attempt_at` + `last_refresh_error` columns to `platform_credentials` for observability.

---

## Decisions awaited

1. **Issue #4 Phase A scope** — items 1+2+3 (recommended), or just 1+2, or 1 only?
2. **Issue #1 scope** — Option A (close as-is, flow already works), Option B (30-LOC button), or Option C (SQL recovery)?
3. **Branch strategy** — single `phase-hardening-m1` branch covering both issues, or one branch per issue?
4. **Sentry / observability** — Phase A scope or defer to a dedicated observability sprint?
5. **Probe disposition** — preserve `scripts/_diagnose-google-token-lifecycle.mjs` (matches recent M7/M7.5 disposition-B precedent) or delete after recon?
