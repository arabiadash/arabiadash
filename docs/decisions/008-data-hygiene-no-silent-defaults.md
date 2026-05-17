# ADR-008: Data Hygiene — No Silent Defaults

**Status**: Accepted
**Date**: 2026-05-17
**Related**: ADR-005 (multi-currency), ADR-006 (OAuth callback semantics)

## Context

On May 17, 2026, we discovered that all Google insights data was inflated by ~3.75x in the UI. Root cause: `factory.ts` line 67 used:

```typescript
currency: metadata.currency || "USD"
```

Google connections in production had `metadata.currency = null` because `sync-accounts` had never been run for them. The silent fallback to "USD" caused the Google adapter to tag SAR data as USD. The frontend then converted "USD → SAR" by multiplying by 3.75.

The bug existed in production but was invisible until per-platform tabs (Phase 4.8 M1) exposed it via side-by-side comparison with the cross-platform Top section.

## Decision

**Required metadata fields must throw at construction time, not silently default.**

Specifically:
- `metadata.currency` is required for adapter construction
- `metadata.timezone_name` is required for adapter construction
- Other future required fields follow the same rule

Default values are acceptable only for genuinely optional fields where a sensible default doesn't change business logic (e.g., display preferences, UI hints).

## Consequences

### Positive

- Wrong-currency inflation impossible at the adapter layer
- Errors surface immediately at config time, not silently via wrong math
- Forces upstream code (OAuth callbacks, manual syncs) to populate metadata correctly
- Future required fields (e.g., account_name when UI demands it) can follow the same pattern

### Negative

- Existing API routes calling getAdapterForProvider must catch the new error
  (verified: all 4 routes — insights, creatives, account, campaigns — already
  wrap in try/catch returning 500)
- Connections created before sync-accounts runs will fail until sync completes
  (mitigated by auto-sync in OAuth callback — see C3 in the shipping PR)
- A bug in sync-accounts now breaks the adapter entirely instead of producing
  wrong numbers — but loud failure is better than silent wrong data

## Prevention pattern

For new adapters or new required fields, follow this pattern:

```typescript
if (!metadata.requiredField) {
  throw new Error(
    `Connection ${connection.id} missing requiredField in metadata. ` +
    `Run sync-accounts to populate it.`
  );
}
```

Never use `metadata.requiredField || "fallback"` for fields where a wrong default changes business logic.

## Related fixes shipped with this ADR

- `fix(factory): throw on missing currency/timezone instead of silent USD fallback` (commit d7321b8)
- `refactor(google-ads): extract sync-accounts logic into shared helper` (commit c4b9ed6)
- `feat(google-ads): auto-sync metadata after OAuth callback` (commit 71ee6cb)
