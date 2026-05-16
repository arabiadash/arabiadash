# ADR-006: OAuth Callback Re-entry Semantics

**Status**: Accepted
**Date**: 2026-05-17
**Related**: ADR-005 (Google Integration + Multi-Currency)

## Context

ArabiaDash imports ad accounts via OAuth callbacks (Meta, Google today;
TikTok, Snapchat, Salla, Zid planned). Each callback receives a list of
accessible accounts from the provider and writes one row per account to
the `connections` table via `upsert` with
`onConflict: "user_id,platform,account_id"`.

Re-OAuth is a normal operation, not an edge case:

- Tokens expire and need refresh
- User adds new accounts on the provider side and wants them imported
- User re-grants permissions after revoking them

A naive callback writes all fields from the OAuth response on every run.
On conflict, `upsert` UPDATEs all listed columns — so existing rows lose
their stable fields on every re-OAuth.

This caused **issue #10**: a user re-OAuthing Google in workspace B lost
all their accounts active in workspace A. Existing rows were relocated to
workspace B with status reset to `pending` and `account_name` reset to
`null`.

The Meta callback had a **latent** version of the same bug. Phase 4.1.5
preserved `status` on re-OAuth, but `workspace_id` was still overwritten.
The bug never manifested in production because only one Meta account
existed — but the first user with multiple Meta accounts re-OAuthing in a
different workspace would have hit it.

## Decision

**OAuth callbacks MUST pre-fetch existing rows and preserve user-decision
fields on re-OAuth. Token-related fields always refresh.**

### Pattern

```typescript
// 1. Pre-fetch existing rows for this user + platform
const { data: existingRows } = await adminClient
  .from("connections")
  .select("account_id, workspace_id, status, account_name, connected_at")
  .eq("user_id", user.id)
  .eq("platform", "<platform>");

const existingByAccountId = new Map(
  (existingRows ?? []).map((r) => [r.account_id, r])
);

// 2. Build upsert rows, preserving user-decision fields for existing
const rowsToUpsert = accounts.map((account) => {
  const existing = existingByAccountId.get(account.id);
  return {
    user_id: user.id,
    platform: "<platform>",
    account_id: account.id,

    // PRESERVE: user-decision fields
    workspace_id: existing?.workspace_id ?? currentWorkspaceId,
    status: existing?.status ?? "pending",
    connected_at: existing?.connected_at ?? nowIso,
    account_name: existing?.account_name ?? <new-name-or-null>,

    // REFRESH: token-related fields (the point of re-OAuth)
    access_token: <fresh-token>,
    metadata: { /* fresh provider data */ },
  };
});
```

### Field classification

| Field | On re-OAuth | Rationale |
|---|---|---|
| `workspace_id` | **Preserve** | User assigned the account to a workspace. Re-OAuth ≠ relocate. |
| `status` | **Preserve** | User activated the account explicitly. Re-OAuth ≠ reset. |
| `connected_at` | **Preserve** | Semantic accuracy for "connected since" UI. |
| `account_name` | **Provider-dependent** | If callback API returns names (Meta), refresh. If a separate sync enriches them (Google), preserve. |
| `access_token` | **Refresh** | Primary purpose of re-OAuth — token rotation. |
| `metadata` (tokens, expiry) | **Refresh** | Same as above. |

### Provider-specific notes

- **Google**: `account_name` is preserved on re-OAuth. The callback itself
  doesn't fetch names — a separate `/api/google-ads/sync-accounts` enriches
  them. Overwriting with `null` would lose enriched names.
- **Meta**: `account_name` is refreshed from the API response. The Meta
  callback fetches names directly, so account renames on the provider
  side propagate naturally.

### Future platforms (TikTok, Snapchat, Salla, Zid)

When implementing a new platform's OAuth callback:

1. Match the pre-fetch + preserve pattern above.
2. Decide `account_name` policy based on whether the callback fetches
   names directly (refresh) or relies on a separate sync (preserve).
3. Any new user-decision field added later (e.g. user-defined account
   nickname, currency override, custom tags) must be added to the
   `.select()` list and the preserve clauses.

## Consequences

### Positive

- **OAuth re-entry is idempotent for user decisions.** Users don't lose
  state on re-OAuth.
- **Single pattern for all platforms.** TikTok/Snapchat/Salla/Zid will
  reuse it unchanged.
- **Defensive against latent versions of the bug.** Meta's latent bug was
  closed before it manifested in production.

### Negative

- **One extra SELECT query per callback.** Bounded by accounts per user
  per platform — negligible.
- **Provider-side renames are platform-specific.** Google account renames
  on the provider side won't propagate until sync-accounts runs.

## Lessons

1. **The user's "ليش 7 مش 15" question saved the day.** During Phase 4.7
   M1 testing, the user noticed 15 Google accounts instead of the expected
   7 on the connections page. Investigation revealed this bug. Without
   that check, M1 would have shipped on a corrupted DB state. The fix
   was developed manually via SQL during recovery, then codified into
   this ADR.

2. **Latent bugs are real bugs.** Meta's `workspace_id` overwrite never
   manifested because production had only one Meta account. Fixing only
   Google would have left Meta as a time bomb for the first user with
   multiple Meta accounts.

3. **`onConflict` is not "smart merge".** It UPDATEs all listed columns
   on conflict. Selective preservation requires pre-fetch + per-row
   construction. The temptation to write a "simple upsert" is exactly
   how this bug class is born.

## Implementation

- Google callback fixed in commit `8e298f3`
- Meta callback fixed in commit `6c3c5c6`
- Both shipped under PR closing issue #10

## Related

- **ADR-005**: Google integration foundation
- **Issue #10**: Original bug discovery
