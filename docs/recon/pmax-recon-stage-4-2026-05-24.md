# PMax Recon Report — Stage 4 (Post-M-PMax Hotfix Probe)

**Date:** 2026-05-24
**Branch:** phase-4.8-m-pmax (probe-only, no production code touched)
**Scope:** Verify `asset_group_asset.status` is SELECTable in SDK v23 and measure payload reduction from adding `!= 'REMOVED'` to the `fetchAssetGroupAssets` WHERE clause.
**Trigger:** imaa's PMAX_ASSET_GROUP card was rendering ~163 assets including historical removed entries (~90 YouTube videos the user had unlinked months ago). Diagnostic traced root cause to missing status filter on `fetchAssetGroupAssets` GAQL query ([google.ts:1822](../../src/lib/ads/providers/google.ts#L1822)). This probe verifies the proposed one-line fix before shipping.
**Companions:** [pmax-recon-stage-2-3-2026-05-24.md](pmax-recon-stage-2-3-2026-05-24.md) (Stage 2/3 + Phases 2-4)

---

## Question

Does `asset_group_asset.status` exist as a SELECTable + WHERE-filterable field on Google Ads API v23 (via `google-ads-api@23` SDK), or is it another instance of the SDK-vs-runtime trap that has bit us 5 times in this milestone (`image_ad.image_asset` / `sitelink_asset.description1/2` / `asset_group_asset.performance_label` / `asset_group_listing_group_filter.vertical` / `shopping_performance_view→asset_group JOIN`)?

If queryable, what's the actual data distribution on imaa, and how much payload reduction does `AND asset_group_asset.status != 'REMOVED'` deliver?

---

## Q6f probes (against imaa account 5473228670)

### Q6f-1 — SELECTability probe (no status filter)

**Status:** ✓ PASSED (207 rows returned)

```
SELECT
  asset_group.id,
  asset_group_asset.field_type,
  asset_group_asset.status,
  asset.id,
  asset.type
FROM asset_group_asset
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
```

Sample row (status field populated on every row):
```json
{
  "asset": { "id": 111574805265, "type": 5,
             "resource_name": "customers/.../assets/111574805265" },
  "asset_group": { "id": 6500713373,
                   "resource_name": "customers/.../assetGroups/6500713373" },
  "asset_group_asset": {
    "field_type": 2,
    "status": 3,
    "resource_name": "customers/.../assetGroupAssets/6500713373~111574805265~HEADLINE"
  }
}
```

**Distribution of `asset_group_asset.status` across all 207 rows:**

| Integer value | Row count | Mapping (per Google `AssetLinkStatus` proto) |
|---|---|---|
| `3` | **160** | REMOVED |
| `2` | 47 | ENABLED |

Two findings:
- **No SDK rejection.** Field is SELECTable in SDK v23 — not a trap.
- **The field returns an INTEGER enum**, not a string label. Sixth instance of the integer-enum drift trap pattern (after `ad_strength`, `primary_status`, `ad_type`, `ad_status`, `product_condition`, `field_type`). The known `AssetLinkStatus` proto maps `2=ENABLED, 3=REMOVED, 4=PAUSED, 0=UNSPECIFIED, 1=UNKNOWN`. imaa exhibits only values `2` and `3` (active + historical-removed); no PAUSED rows.

### Q6f-2 — Filtered with `!= 'REMOVED'` (proposed prod filter)

**Status:** ✓ PASSED (47 rows returned)

```
SELECT
  asset_group.id,
  asset_group_asset.field_type,
  asset_group_asset.status,
  asset.id,
  asset.type
FROM asset_group_asset
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND asset_group_asset.status != 'REMOVED'
```

**Result:** 47 rows. Matches the `2` (ENABLED) bucket exactly from Q6f-1 (47 rows). No PAUSED rows in imaa to demonstrate the wider filter would also include them, but the literal `'REMOVED'` in GAQL WHERE worked — confirming Google's query parser accepts the string label even though the response payload returns the integer.

**Payload reduction:** 207 → 47 rows = **77.3% reduction.**

(Less dramatic than the ~95% I had estimated pre-probe — imaa's real ENABLED/REMOVED ratio is roughly 23/77, not 5/95. Still a substantial win on payload size, parse work, cache size, and client-side render cost.)

---

## Key discoveries

1. **`asset_group_asset.status` is fully SELECTable and WHERE-filterable in SDK v23.** Confirmed — not another SDK-vs-runtime trap. Safe to add to production.

2. **GAQL accepts string-literal status in WHERE despite returning integer in response.** This means `WHERE asset_group_asset.status != 'REMOVED'` works correctly in the query, AND we don't need an integer→string map for the filter itself. Google's query parser does the translation. (If we wanted to display the status in the UI per-asset, then we'd need an enum map à la `AD_STRENGTH_MAP` / `PRIMARY_STATUS_MAP`.)

3. **Integer enum mapping for `asset_group_asset.status`** (per Google `AssetLinkStatus` proto, observed values + standard documented set):
   - `0` = UNSPECIFIED
   - `1` = UNKNOWN
   - `2` = ENABLED ← imaa: 47 rows
   - `3` = REMOVED ← imaa: 160 rows
   - `4` = PAUSED ← imaa: 0 rows (not present in this account)
   
   Sixth instance of the integer-enum pattern. If we later need the per-asset status in the UI (e.g. for an "Active / Paused" badge on each AssetChip), we'd add an `ASSET_LINK_STATUS_MAP` const in `providers/google.ts` alongside the existing maps + a `readAssetLinkStatus` defensive reader. Not needed for the current fix.

4. **imaa's actual ratio is 23/77 (active/removed)**, not the ~5/95 I'd estimated. The 160 REMOVED links represent ~3 years of accumulated removed assets (the account is long-running). Different accounts will have different ratios — newer accounts will see less reduction; older ones potentially more. Either way, the filter is correct: users care about currently-active assets, not historical link records.

5. **`AssetLinkStatus` ≠ `AssetGroupPrimaryStatus`** — keep this distinction in mind. `asset_group_asset.status` is the **link** state (is this asset currently attached to this asset_group?), an enum of 5 values. `asset_group_asset.primary_status` (from the Phase 2 follow-up list, never Q6-tested) is a richer **synthesized** state including review/eligibility reasons (LIMITED, NOT_ELIGIBLE, PENDING_REVIEW, etc.). The current ask only needs the link state.

---

## Proposed production fix

**File:** [src/lib/ads/providers/google.ts:1822](../../src/lib/ads/providers/google.ts#L1822)

```diff
       FROM asset_group_asset
       WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
+        AND asset_group_asset.status != 'REMOVED'
```

Net delta: +1 SQL line + a comment explaining the filter intent + the recon trail. ~+5 LOC total. No code-shape changes elsewhere — the existing parser/normalizer in `fetchAssetGroupAssets` already handles the response unchanged.

**Side effect to call out:** the `asset_group_asset.status` field will now be parsed by GAQL's WHERE clause but NOT added to the SELECT (current SELECT doesn't include it). That's fine for the filter alone, but note this means we're losing one piece of information per row that the recon probe was able to see (whether each surviving asset is ENABLED vs PAUSED). If a future commit wants per-asset PAUSED badges on chips, we'd add `asset_group_asset.status` to the SELECT + an `ASSET_LINK_STATUS_MAP` enum map to the helpers.

**Why server-side (WHERE) over post-fetch TS filter:**
- 77% payload reduction (207 → 47 rows for imaa) = smaller cache blob, smaller client payload, lower parse cost, fewer DOM nodes per render
- One-line change, low risk
- Matches the precedent already in `fetchAds` ([google-ads/ads.ts:188](../../src/lib/google-ads/ads.ts#L188): `AND ad_group_ad.status != 'REMOVED'`)
- Reversibility cost (e.g. future "show removed assets" UI toggle) is acceptable — just remove the filter and re-add post-fetch TS filtering if needed

---

## Summary

| Item | Result |
|---|---|
| SELECTability of `asset_group_asset.status` | ✓ PASSED — not a trap |
| `WHERE asset_group_asset.status != 'REMOVED'` accepted | ✓ PASSED |
| Response payload reduction on imaa | 207 → 47 rows (77.3%) |
| imaa ENABLED count | 47 |
| imaa REMOVED count | 160 |
| imaa PAUSED count | 0 (none present) |
| Integer→string mapping needed for current fix | ❌ No — GAQL handles WHERE-clause string literal |
| Integer→string mapping needed for future per-asset badges | ✓ Yes if surfaced (would need `ASSET_LINK_STATUS_MAP`) |
| Production code touched in this probe | None |
| Proposed change size | ~5 LOC, single file |
| Ready to ship | YES — pending user approval |
