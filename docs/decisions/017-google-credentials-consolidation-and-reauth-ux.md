# ADR-017: Google Credentials Consolidation + Reauth UX (M-hardening-1)

**Status**: Draft — awaiting approval
**Date**: 2026-05-27
**Phase**: M-hardening-1 (pre-launch tech-debt + UX hardening)
**Related**: ADR-008 (no silent defaults), ADR-010 (industry-standard account selection — original `platform_credentials` table design; this ADR closes the read-path drift left over from that pivot), ADR-006 (OAuth callback re-entry semantics — same concerns about idempotent re-OAuth), Memory: "Reproduce locally before re-shipping a reverted feature" (reauth CTA mandates a local-dev test path), CLAUDE.md §10 imaa invalid_grant incident (2026-05-25, the catalytic user-experience failure this ADR addresses)
**Recon**: [docs/recon/m-hardening-recon-2026-05-27.md](../recon/m-hardening-recon-2026-05-27.md) (5-question probe against imaa via `scripts/_diagnose-google-token-lifecycle.mjs`)
**Closes**: Issue #4 (Phase A — verify Google access_token refresh behavior under load), Issue #25 (ADR-010 drift cleanup), Issue #1 (re-sync 4 dropped Google accounts — closed as "won't fix; flow already exists, UI hint added")

## Context

The M-hardening recon surfaced three concrete, interrelated production gaps in the Google Ads integration's credential handling and failure-surfacing UX:

**Gap 1 — ADR-010 read-path drift (HIGH severity, Issue #25).** ADR-010 established `platform_credentials` as the canonical single-row-per-(user, platform) refresh token store. The OAuth callback writes only to that table ([callback/route.ts:85-97](../../src/app/api/google-ads/callback/route.ts#L85-L97)). However, **two production read paths still read `connections.access_token` instead** — [factory.ts:113](../../src/lib/ads/factory.ts#L113) (every ads API request) and [sync-accounts-logic.ts:37](../../src/lib/google-ads/sync-accounts-logic.ts#L37) (metadata refresh). These work today only because `/api/google-ads/select-accounts` duplicates the refresh_token from `platform_credentials` into `connections.access_token` at selection time ([select-accounts/route.ts:121](../../src/app/api/google-ads/select-accounts/route.ts#L121)). **This breaks the moment a user re-OAuths without re-selecting accounts** — the callback updates `platform_credentials` but leaves `connections.access_token` stale, and all subsequent ad fetches use the dead token. For imaa specifically the probe confirmed ✓ MATCH right now (re-OAuth on 2026-05-25 happened before select-accounts on 2026-05-25T22:25:53Z by chance), but the drift will manifest the next time any user re-OAuths a long-standing connection.

**Gap 2 — Silent invalid_grant UX (HIGH severity, Issue #4).** When the Google Ads SDK throws on `invalid_grant` (refresh token revoked by user, expired beyond Google's 6-month inactivity grace, or scope rescinded), the failure path is: SDK throws → adapter re-throws → `/api/ads/{insights,creatives}` outer try/catch returns generic HTTP 500 → frontend shows "fetch failed" with no recovery affordance. The 2026-05-25 imaa incident (CLAUDE.md §10) was diagnosed only because the user observed a "0 campaigns regression" after a cache bump; there was no proactive signal. The fix is small and architectural: a typed error class that propagates cleanly to a 401 + Arabic CTA pointing at the OAuth URL.

**Gap 3 — Issue #1 "re-sync dropped accounts" is already solved by existing infrastructure.** The recon Q5 probe showed imaa has 15 OAuth-accessible Google customers but only 1 persisted in `connections`. The original Issue #1 framing ("4 accounts dropped during migration") is stale by an order of magnitude. Critically: `/dashboard/connections/google/select` **already** reads `platform_credentials.refresh_token`, calls `getAccessibleCustomers`, and lets the user multi-select. The flow works; the user just needs to discover it. A 10-LOC UI hint in workspace settings resolves the "where do I add more accounts?" discoverability gap. Building a one-click "sync all" button (Option B from recon) was considered and rejected as YAGNI for a flow that already exists end-to-end.

Three non-goals are explicitly excluded from this milestone, captured here so future readers don't wonder why they were skipped:

- **Retry-with-backoff on transient failures.** The recon found zero evidence of transient SDK failures in production logs (the only failure class observed is `invalid_grant`, which is non-retryable — it needs user action, not a retry). Adding retry infrastructure for non-existent failures is defensive code for hypothetical requirements and violates CLAUDE.md §6 "Don't add error handling for scenarios that can't happen." Revisit only if real retry-able failures surface.
- **Sentry / structured observability.** Paid third-party service requiring billing setup, key management, and a separate UX-impact analysis (PII scrubbing in error breadcrumbs). Belongs in its own ADR. `console.error` + Vercel function logs remain the baseline for this milestone.
- **Google OAuth Verification submission.** Requires Privacy Policy, Terms of Service, and a Demo Video. The user explicitly deferred the Demo Video until the product is more presentable. Reauth UX shipping today helps users on the existing unverified-app consent flow; verification is a Phase B concern.

The CACHE_SCHEMA_VERSION pre-push verification protocol (Memory #28) does NOT apply to this milestone — no GAQL shape changes, no UnifiedAd type changes, no cached value semantics changes. Cache v11 stays valid.

## Decision

### 1. Single source of truth: collapse to `platform_credentials.refresh_token`

Drop `connections.access_token` from the schema. Read path consolidation:

- `factory.ts` (adapter construction) — read `refresh_token` from `platform_credentials` via a new helper `getRefreshTokenForUser(userId, 'google')` instead of from `connections.access_token`. One DB read per adapter construction; pre-existing `platform_credentials` lookup pattern (already used in `discover/route.ts` + `select-accounts/route.ts`).
- `sync-accounts-logic.ts` — same helper.
- `select-accounts/route.ts` — stop writing `access_token: refreshToken` into the upsert row. Column won't exist post-migration.

DB migration `supabase/migrations/<ts>_drop_connections_access_token.sql`:

```sql
-- UP
ALTER TABLE public.connections DROP COLUMN IF EXISTS access_token;

-- (paired DOWN preserved as comment for rollback reference)
-- ALTER TABLE public.connections ADD COLUMN access_token TEXT;
-- UPDATE public.connections c SET access_token = pc.refresh_token
--   FROM public.platform_credentials pc
--   WHERE c.user_id = pc.user_id AND c.platform = pc.platform;
```

Pre-migration sanity check: the column is read by exactly 2 production files (`factory.ts`, `sync-accounts-logic.ts`), confirmed via grep. Both will be updated in the same commit as the migration. No other consumer.

Meta integration is unaffected — Meta's access_token semantics are different (long-lived, not refresh-token-derived) and Meta connections continue to store the token in `connections.access_token`... **except the column will be gone**. **Subtle correction during ADR drafting**: Meta also uses `connections.access_token` ([factory.ts:82](../../src/lib/ads/factory.ts#L82)). The migration cannot blindly drop the column without breaking Meta. Two resolution options:

- **Option 1a — Rename rather than drop.** Rename `connections.access_token` → `connections.legacy_access_token` is meaningless. Better: keep the column for Meta, just stop writing it for Google. Add an explicit comment + change the variable name in `factory.ts:82` to `connection.access_token` (Meta only).
- **Option 1b — Migrate Meta credentials to `platform_credentials` too.** Symmetric architecture. Larger blast radius (Meta callback, Meta select-accounts, Meta adapter all touched). Out of M-hardening-1 scope.

**Decision: Option 1a.** Keep `connections.access_token` column; stop writing it for Google; add a column-level comment documenting it's Meta-only post-this-ADR. Migrate Meta to `platform_credentials` in a separate future milestone (M-hardening-2 or whenever Meta integration receives its next significant touch).

Revised migration:

```sql
-- UP (no DDL — column kept for Meta)
COMMENT ON COLUMN public.connections.access_token IS
  'Meta access_token (long-lived). Google has migrated to platform_credentials.refresh_token. See ADR-017.';

-- Backfill cleanup: NULL out Google rows so a future audit can verify the
-- Google→platform_credentials migration completed.
UPDATE public.connections SET access_token = NULL WHERE platform = 'google';
```

### 2. Typed `ReauthRequiredError` propagation

New file `src/lib/google-ads/errors.ts`:

```typescript
export class ReauthRequiredError extends Error {
  readonly provider: 'google';
  readonly reason: 'invalid_grant' | 'consent_revoked' | 'token_expired';
  readonly reauthUrl: string;

  constructor(reason: ReauthRequiredError['reason']) {
    super(`Google Ads reauth required: ${reason}`);
    this.provider = 'google';
    this.reason = reason;
    this.reauthUrl = '/dashboard/connections/google';
  }
}

export function isReauthError(err: unknown): err is ReauthRequiredError {
  return err instanceof ReauthRequiredError;
}

/**
 * Detect a Google Ads SDK failure that indicates the user's refresh
 * token is no longer usable. Maps the SDK's error shape (which includes
 * GoogleAdsFailure + RequestError + plain Error) to a typed
 * ReauthRequiredError, or returns null if the error doesn't match.
 *
 * Logs the classification outcome so if Google changes their error
 * message format and the substring matching silently fails, Vercel
 * logs will surface the new pattern via the "Auth-like error but no
 * match" warning. We can then add the new substring to the classifier.
 */
export function classifyGoogleAdsError(err: unknown): ReauthRequiredError | null {
  if (!(err instanceof Error)) return null;
  const msg = err.message.toLowerCase();

  let result: ReauthRequiredError | null = null;
  if (msg.includes('invalid_grant')) {
    result = new ReauthRequiredError('invalid_grant');
  } else if (msg.includes('access_denied') || msg.includes('consent')) {
    result = new ReauthRequiredError('consent_revoked');
  } else if (msg.includes('token expired') || msg.includes('token has been expired')) {
    // Token expired is rare (refresh tokens are 6-month sliding) but the
    // SDK surfaces it with a distinct message when it does happen.
    result = new ReauthRequiredError('token_expired');
  }

  if (result) {
    console.warn('[reauth-classification] Classified as reauth-required:', err.message);
  } else if (
    // Auth-like signals that didn't match our known reauth patterns —
    // worth logging so future SDK error-format changes surface in Vercel logs.
    msg.includes('auth') || msg.includes('credential') || msg.includes('unauthorized') ||
    msg.includes('401') || msg.includes('403') || msg.includes('permission')
  ) {
    console.warn('[reauth-classification] Auth-like error but no match:', err.message);
  }

  return result;
}
```

In `src/lib/ads/providers/google.ts` — wrap the existing SDK call sites at the **outermost** boundary (the adapter's `getCampaigns` / `getInsights` / `getAds` / `getAccount` methods, NOT each individual fetch helper — wrapping at the helper level would force 8+ identical try/catches). Pattern:

```typescript
async getAds(range: DateRangeInput): Promise<UnifiedAd[]> {
  try {
    // ...existing logic
  } catch (err) {
    const reauth = classifyGoogleAdsError(err);
    if (reauth) throw reauth;
    throw err;
  }
}
```

Four wrap sites: `getAccount`, `getCampaigns`, `getInsights`, `getAds`. Each ~3 LOC.

### 3. API route mapping: `ReauthRequiredError` → HTTP 401

In `src/app/api/ads/insights/route.ts` and `src/app/api/ads/creatives/route.ts` — outer try/catch gains a typed branch:

```typescript
} catch (err) {
  if (isReauthError(err)) {
    return NextResponse.json(
      {
        error: 'reauth_required',
        provider: err.provider,
        reason: err.reason,
        reauthUrl: err.reauthUrl,
        message: 'انتهت صلاحية ربط حساب Google. يرجى إعادة الربط للمتابعة.',
      },
      { status: 401 }
    );
  }
  // ...existing 500 path
}
```

HTTP 401 (not 403) because the failure semantic is "your credentials are no longer accepted, please re-authenticate." Matches the OAuth idiom users (and HTTP intermediaries) expect.

### 4. UI surfacing: Arabic reauth CTA banner

In `src/app/dashboard/reports/ReportsClient.tsx` (and Dashboard mirror if applicable) — extend the existing data-fetch error handling to recognize the `reauth_required` shape:

```jsx
{insightsError?.reason === 'reauth_required' && (
  <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 mb-4">
    <h3 className="font-bold text-amber-900">إعادة ربط حساب Google مطلوبة</h3>
    <p className="text-sm text-amber-800 mt-1">
      انتهت صلاحية الربط مع Google Ads. اضغط على الزر أدناه لإعادة الربط
      والاستمرار في عرض بيانات حملاتك.
    </p>
    <a
      href={insightsError.reauthUrl}
      className="inline-block mt-3 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
    >
      أعد ربط حساب Google
    </a>
  </div>
)}
```

Render position: above the existing campaign/creative grids, below the date range picker. Banner is dismissible-by-resolution-only (no `X` button) — the user must reauth to clear it, by design.

### 5. Workspace settings hint for Issue #1

In `src/app/dashboard/settings/workspaces/[id]/edit/page.tsx` (or wherever workspace settings live — TBD during implementation grep) — add a small hint card:

```jsx
<div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mt-4">
  <p className="text-sm text-gray-700">
    تحتاج تضيف حسابات Google Ads إلى مساحة العمل هذه؟{" "}
    <Link
      href="/dashboard/connections/google/select"
      className="text-blue-600 hover:text-blue-700 underline"
    >
      اضغط هنا
    </Link>
  </p>
</div>
```

Position: at the bottom of the workspace settings page, after the existing account list. Visible to all users with Google integration; gracefully degrades (still links correctly) for users without any Google connection — the destination page handles the "no OAuth token" state.

### 6. Single branch + 3-commit atomic structure

| # | Commit | Files |
|---|---|---|
| 1 | `chore(recon): M-hardening recon doc + token lifecycle probe` | docs/recon/m-hardening-recon-2026-05-27.md, scripts/_diagnose-google-token-lifecycle.mjs |
| 2 | `docs(adr): ADR-017 Google credentials consolidation + reauth UX` | docs/decisions/017-google-credentials-consolidation-and-reauth-ux.md (this file) |
| 3 | `feat(google): consolidate credentials + surface reauth requirement` | supabase/migrations/<ts>_consolidate_google_credentials.sql, src/lib/google-ads/errors.ts (NEW), src/lib/google-ads/credentials.ts (NEW helper), src/lib/ads/factory.ts, src/lib/google-ads/sync-accounts-logic.ts, src/app/api/google-ads/select-accounts/route.ts, src/lib/ads/providers/google.ts, src/app/api/ads/insights/route.ts, src/app/api/ads/creatives/route.ts, src/app/dashboard/reports/ReportsClient.tsx, src/app/dashboard/settings/workspaces/[id]/edit/page.tsx (or actual workspace settings location) |

Matches the M7/M7.5 3-commit atomic pattern. Preserves bisect-ability + ADR-precedes-implementation discipline.

### 7. Issue #1 closure: "won't fix — flow exists, UI hint added"

Close with a comment citing this ADR and the workspace-settings hint commit SHA. The 14-account-gap on imaa (per recon Q5) is solvable by the user navigating to `/dashboard/connections/google/select` — no new feature needed.

## Alternatives considered

### Alternative A — Item 3 retry-with-backoff (from recon)

**Rejected.** YAGNI. The recon found zero observed transient failures in production traffic; the only documented failure class is `invalid_grant`, which is non-retryable by nature (user must reauth, not the system). Adding retry infrastructure for hypothetical failures violates CLAUDE.md §6 "Don't add error handling for scenarios that can't happen." The Google Ads API is a Google-managed service running on Google infrastructure; transient 5xx is rare and the SDK's existing HTTP-level retry covers what does occur. Revisit only if real retry-able failure patterns surface in Vercel logs or user-reported "intermittent fetch errors."

### Alternative B — Issue #1 Option B (one-click sync-all button)

**Rejected.** The existing `/dashboard/connections/google/select` flow already provides multi-select + sync end-to-end. A one-click button would be a UX feature (saves the user 1-2 clicks per onboarding), not a bug fix. The user explicitly stated UI hint sufficient. Building Option B would also create a divergent path: the selector UI has plan-limit guardrails (`canAddMoreAccounts`); a one-click button would either need to duplicate those guardrails or skip them — both are wrong. Existing flow is the right answer; discoverability is the only real gap, and the workspace-settings hint resolves it.

### Alternative C — Multi-branch strategy (one branch per issue)

**Rejected.** Three fixes (Issue #4 drift, Issue #4 UX, Issue #1 hint) are conceptually one "M-hardening-1" unit: all touch the Google credential lifecycle, all benefit from being verified together against the same imaa account, and the changes are interdependent (the ADR-010 drift fix is what makes the reauth UX clean — if the drift remained, reauth would fix `platform_credentials` but leave `connections.access_token` stale and the user would still see broken data despite "successful" reauth). Single PR keeps the review and merge atomic.

### Alternative D — Sentry / observability now

**Rejected.** Paid third-party service. Requires billing setup, key management in Vercel env vars, separate ADR for PII scrubbing in error breadcrumbs, evaluation of competitors (Sentry vs Datadog vs Honeycomb vs Vercel's own observability). Belongs in its own architectural conversation. `console.error` + Vercel function logs are the baseline for this milestone; the reauth UX shipping today makes the "silent failure" experience much louder for the user, which is what observability would have surfaced to the developer. User-facing surfacing > developer-facing observability when forced to pick one for the launch-prep sprint.

### Alternative E — Migrate Meta to `platform_credentials` in the same milestone

**Rejected for M-hardening-1.** Meta's access_token semantics differ from Google's (long-lived debug-token-extended access_token; no refresh_token in the OAuth flow). Migration would require: schema change on `platform_credentials` to support a nullable `refresh_token` + new `access_token` column or rename; Meta callback rewrite; Meta select-accounts rewrite; Meta adapter rewrite. ~3× the LOC of M-hardening-1 and zero customer-facing benefit (Meta's `connections.access_token` write path doesn't have the same drift issue Google does, because Meta has no equivalent of "re-OAuth without re-running select-accounts" — Meta's OAuth re-issue *only* happens via the selector flow). Defer to M-hardening-2 or whenever Meta integration receives its next significant touch.

### Alternative F — Don't drop / NULL `connections.access_token` for Google; just stop reading it

**Rejected.** Leaves stale tokens at rest in plaintext. NULL-ing the Google rows is a one-line UPDATE that eliminates the staleness without dropping the column (which Meta still uses). Net cleaner. Pre-existing rows remain valid (token-of-record moves to `platform_credentials`); no production downtime.

### Alternative G — Make the reauth banner dismissible

**Rejected.** Dismissibility implies the error state is optional. It is not — the user has no data to view until reauth completes. A dismissible banner would let users hide the only path back to working data, then complain that "the dashboard is broken." Banner stays until the underlying error resolves; visual prominence (amber + bold heading + CTA button) is intentional.

### Alternative H — Single-commit atomic

**Rejected per ADR-precedes-implementation discipline.** Same rationale as ADR-015/016: 3-commit preserves the architectural decision trail (recon evidence → architectural decision → implementation), making `git log` self-documenting and `git bisect` precise.

## Consequences

### Positive

- **ADR-010 drift eliminated** — `platform_credentials.refresh_token` becomes the unambiguous single source of truth for Google credentials. Re-OAuth scenarios will work correctly going forward. Issue #25 closed concurrently.
- **Users see actionable failure UX** — instead of generic "fetch failed," users encounter a clear Arabic CTA pointing at the fix. Time-to-recovery drops from "user reports issue → developer diagnoses → developer instructs re-OAuth" to "user sees banner → user clicks → done." The 2026-05-25 imaa incident loop closes.
- **Issue #1 closed without new feature surface** — fewer UI surfaces to maintain, no new failure modes, leverages existing fully-tested infrastructure.
- **Tech-debt trifecta in one merge** — three open issues close on a single PR review.
- **Discoverability improvement for new users** — the workspace-settings hint surfaces "how to add Google accounts" exactly where users go when they're looking for "how do I manage my workspace?" — a high-intent moment.
- **Typed error class scaffold for future providers** — `ReauthRequiredError` shape generalizes. When Meta hits the same need (Meta's access_token can be revoked too), the pattern extends with a `provider: 'meta'` discriminant. Same for future TikTok / Snap / Salla / Zid integrations.

### Negative

- **Schema migration touches the `connections` table** — NULL-ing the `access_token` column for Google rows is reversible (the value is duplicated from `platform_credentials.refresh_token` and can be restored via the DOWN migration) but is a write against a hot table. Blast radius: minimal — UPDATE on 1 row for imaa (the only current Google user). Production traffic during migration: zero concern at current scale.
- **Banner UX takes screen real estate when triggered** — users will see less data above the fold during the reauth state. Acceptable: when the reauth state is active, there IS no data, so the banner replaces empty-state real estate, not actual content.
- **`isReauthError` detection relies on SDK error message substrings** — fragile if Google SDK error messages change format. Mitigation: the substring matches are broad (`invalid_grant`, `access_denied`, `consent`, `token expired`) and the fallback path (`return null` → generic 500) preserves current behavior. SDK message changes would silently degrade reauth UX back to generic 500 — same as today, not worse.
- **Workspace settings page gains a hint card that is always-visible** — even when the user has all 15 imaa accounts connected, the "اضغط هنا" link is still rendered. Could be conditionally hidden (`if accessible-but-not-persisted > 0`), but that requires an extra API call on page load. Defer the conditional rendering; the link is benign for fully-connected users.

### Risk

- **ReauthRequiredError must propagate cleanly through the entire async stack** — the four adapter methods (`getAccount`/`getCampaigns`/`getInsights`/`getAds`) each wrap multiple parallel fetcher calls inside `Promise.all`. A reject in any leaf must bubble up as `ReauthRequiredError`, not get swallowed by another error class. **Verification**: write a temporary mock during local-dev test that forces one fetcher to throw a fake `invalid_grant` Error; confirm the API returns 401 and the UI shows the banner. This is the **highest-risk single behavior** in the milestone; the dev-server reproduction step in the Verification plan is non-skippable.

- **Schema migration ordering** — the NULL-ing UPDATE must execute AFTER the `factory.ts` + `sync-accounts-logic.ts` reads are migrated to `platform_credentials`, or the production app will lose Google access during the deploy window. **Mitigation**: Vercel deploys the new code BEFORE the next request runs, and the migration runs via Supabase migration tooling on the developer's local machine, not as part of the Vercel build. Migration runs AFTER push + AFTER Vercel preview is verified, in the same atomic ship sequence as past schema changes.

- **Meta unaffected, but documentation must clarify** — the column comment + ADR text both explicitly note that `connections.access_token` is now Meta-only. Future readers grepping for `access_token` could be misled into thinking it's also Google's. The Meta-only comment defends against that.

## Implementation plan (3 commits on `phase-hardening-m1`, ~120 LOC total)

| Commit | File | Change | Est. LOC |
|---|---|---|---|
| 1 | `docs/recon/m-hardening-recon-2026-05-27.md` | NEW (already written, untracked from previous turn) | — |
| 1 | `scripts/_diagnose-google-token-lifecycle.mjs` | NEW (already written, untracked) | — |
| 2 | `docs/decisions/017-google-credentials-consolidation-and-reauth-ux.md` | NEW — this ADR | — |
| 3 | `supabase/migrations/<ts>_consolidate_google_credentials.sql` | NEW — column comment + NULL-out Google rows | +5 |
| 3 | `src/lib/google-ads/errors.ts` | NEW — `ReauthRequiredError` + `isReauthError` + `classifyGoogleAdsError` | +30 |
| 3 | `src/lib/google-ads/credentials.ts` | NEW — `getRefreshTokenForUser(client, userId, platform)` helper. Single chokepoint for `platform_credentials` reads. | +20 |
| 3 | `src/lib/ads/factory.ts` | Replace `connection.access_token` (Google branch only) with `await getRefreshTokenForUser(...)`. Meta branch unchanged. Throw the same loud error if no credential row exists. | +10/-5 |
| 3 | `src/lib/google-ads/sync-accounts-logic.ts` | Replace `conn.access_token` reads with `getRefreshTokenForUser` call once per user (move OUT of the per-connection loop — one user has one refresh_token). | +8/-5 |
| 3 | `src/app/api/google-ads/select-accounts/route.ts` | Stop writing `access_token: refreshToken` into the upsert row. | +0/-2 |
| 3 | `src/lib/ads/providers/google.ts` | Wrap `getAccount`/`getCampaigns`/`getInsights`/`getAds` outer bodies in try/catch → `classifyGoogleAdsError` → throw `ReauthRequiredError` if matched, re-throw otherwise. | +20 |
| 3 | `src/app/api/ads/insights/route.ts` | Add `isReauthError` branch in outer catch returning 401 with structured body. | +12 |
| 3 | `src/app/api/ads/creatives/route.ts` | Same. | +12 |
| 3 | `src/app/dashboard/reports/ReportsClient.tsx` | Extend `useInsights` / fetch error handling to surface the reauth shape. Render amber CTA banner above the data grid when `error.reason === 'reauth_required'`. | +25 |
| 3 | `src/app/dashboard/settings/workspaces/[id]/edit/page.tsx` (path TBD during impl grep) | Append workspace-settings hint card with link to `/dashboard/connections/google/select`. | +10 |
| **Total commit 3** | | | **~125** |

## Verification plan

### Local (pre-push, BLOCKING)

1. `npx tsc --noEmit` clean — no type errors after the helper extraction + factory rewrite
2. `npm run build` clean — no module-resolution issues with the new `errors.ts` / `credentials.ts` files
3. **Schema migration test** — apply migration to local Supabase, verify `connections.access_token` is NULL for Google rows + Meta rows unchanged. Verify the column comment is present.
4. **Reauth-CTA reproduction test — BLOCKING per Refinement 2.** Promise.all propagation is the highest-risk single behavior in this milestone (per Consequences §Risk). The reproduction is mandatory and non-skippable. Temporary code mock: inject a throw-on-first-call branch into `src/lib/google-ads/customer.ts` keyed by an env var (e.g. `FAKE_INVALID_GRANT=1`). With the mock on:
   - Start local dev server against production Supabase
   - Hit `/api/ads/insights?provider=google&account_id=5473228670&refresh=true`
   - **REQUIRED OUTCOME 1**: HTTP 401 with body `{ error: 'reauth_required', reason: 'invalid_grant', reauthUrl: '/dashboard/connections/google', message: '...' }`. ANY other status code (200/500) means propagation broke — STOP, do not push, diagnose the adapter → route catch chain.
   - Open `/dashboard/reports`, switch to Google tab
   - **REQUIRED OUTCOME 2**: amber banner renders, "أعد ربط حساب Google" button visible and links to the OAuth-start URL. Browser DevTools Network tab confirms the 401 response shape.
   - **REQUIRED OUTCOME 3**: Mock cleanup verified. Remove the mock + the `FAKE_INVALID_GRANT` env var; confirm normal data renders on next request. No leftover override remains in source or env.
   - **STOP CONDITIONS**: any of the three outcomes fails → STOP, do not push, do not commit further, do not attempt git operations until the propagation chain is debugged (adapter wraps → catch in API route → fetch error handling in client). Most likely failure modes:
     - Adapter outer try/catch catches the wrong scope (inner Promise.all not wrapped)
     - API route's `isReauthError` check runs AFTER a generic error swallow
     - Client's error parser doesn't recognize the 401 body shape and falls through to generic error UI
5. **Existing-functionality regression test** (without mock):
   - Hit `/api/ads/insights?provider=google&account_id=5473228670&refresh=true` — expect HTTP 200 with fresh data
   - Hit `/api/ads/creatives?provider=google&account_id=5473228670&refresh=true` — same
   - Hit both Meta endpoints — expect HTTP 200 (Meta path untouched but worth confirming)

ANY check failing → push BLOCKED. Diagnose and fix before retry.

**Header-driven dev mock** (per Refinement 2 follow-up — Option D
adopted instead of env-gated mock): both `/api/ads/insights` and
`/api/ads/creatives` accept a dev-only `x-fake-error: invalid_grant`
request header that throws `ReauthRequiredError` directly after the
auth check, before the adapter call. The check is gated by
`process.env.NODE_ENV !== "production"` so production builds skip the
branch entirely (Vercel sets NODE_ENV=production; dead-code elimination
makes the line unreachable). Used for CTA propagation testing without
env var manipulation. To verify on preview: curl with a captured
session cookie + the header, or inject the header via browser DevTools
request interception. Cleanup is a single edit to remove both
~6-line blocks; tracked via TODO(ADR-017) comments in both route files
and `scripts/_verify-adr017-reauth-propagation.mjs` documentation.

### Vercel preview (visual verification by user)

1. Open preview URL → `/dashboard/reports` → Google tab loads campaigns + creatives normally for imaa (no reauth banner; token is valid)
2. Open `/dashboard/settings/workspaces/<id>/edit` — hint card visible at bottom with "اضغط هنا" link to `/dashboard/connections/google/select`
3. Click the hint link — selector page loads, lists all 15 accessible imaa accounts (Q5 probe baseline)
4. No regressions on M-PMax modal, M8 image grid, M7 keywords table, M7.5 KPI strip, Meta cards

### Post-merge production

1. Hard-refresh `arabiadash.com/dashboard/reports` → Google tab — data renders normally (no reauth banner; cache may serve stale during the 30-min window, then fresh fetches succeed against `platform_credentials.refresh_token`)
2. `arabiadash.com/dashboard/settings/workspaces/<id>/edit` — hint card visible
3. (Optional) Run the lifecycle probe in production again to confirm `connections.access_token` is now NULL for imaa's Google row and `platform_credentials.refresh_token` remains the live token

## Open items deferred (NOT in M-hardening-1 scope)

1. **Retry-with-backoff for transient SDK failures** — item 3 from recon Phase A. Revisit if Vercel logs show real transient patterns over the next 30 days.
2. **Sentry / structured observability** — separate ADR. Requires billing, key management, PII scrubbing decision, vendor evaluation.
3. **Google OAuth Verification submission (Phase B)** — Privacy Policy + Terms of Service + Demo Video. Demo Video blocked on product being more presentable. Reauth UX from this ADR is forward-compatible with the verified-app consent flow.
4. **Meta credentials migration to `platform_credentials`** — Alternative E. Defer to M-hardening-2 or next Meta-touching milestone.
5. **Workspace-settings hint conditional rendering** — show only if `accessible > persisted`. Requires extra API call on page load; benign always-visible link is acceptable.
6. **Memory entry for "feature-already-exists" recon discoveries** — the pattern of probing existing infrastructure before building new features (Issue #1 turned out to need zero new code) is worth capturing. Defer to see if it recurs before promoting to a documented pattern; one instance is insufficient signal.
7. **Replace error-message substring matching with structured SDK error introspection** — if `google-ads-api` SDK exposes typed error codes in a future version, swap `classifyGoogleAdsError`'s substring matching for that. Today's substring matching is the documented escape hatch.

## Commits

- *(next on this branch)* — `chore(recon): M-hardening recon doc + token lifecycle probe`
- *(next on this branch)* — `docs(adr): ADR-017 Google credentials consolidation + reauth UX` (this file)
- *(next on this branch)* — `feat(google): consolidate credentials + surface reauth requirement`
