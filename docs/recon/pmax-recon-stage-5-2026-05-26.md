# M-PMax Recon — Stage 5 follow-up (effective ad status rollup)

**Date:** 2026-05-26
**Branch:** `phase-4.8-m-pmax` (recon-only; production fix re-applied in the next commit)
**Scope:** Re-run of Q9 probe (initially shipped in [bc26b17](../../scripts/_pmax-recon.mjs) but blocked yesterday by `invalid_grant` OAuth failure) against the freshly re-OAuthed imaa Google connection. Verifies the GAQL field surface that the effective-ad-status production fix depends on.
**Trigger:** Original Q9 was meant to gate commit `9caac84` (effective ad status from campaign/ad_group/ad rollup) — couldn't run because imaa's `refresh_token` returned `invalid_grant`. Fix was shipped on high-confidence analysis ("Path 3"), caused a 0-campaigns regression, reverted in `3f7c6b8`. Stage 5 diagnostic established the regression was NOT in 9caac84's code path but in the v5→v6 cache bump unmasking the broken OAuth. User re-OAuthed imaa on 2026-05-25 evening; this run is the late-arriving probe completing the verification trail before re-shipping the fix.
**Companions:** [pmax-recon-stage-4-2026-05-24.md](pmax-recon-stage-4-2026-05-24.md), [pmax-recon-stage-2-3-2026-05-24.md](pmax-recon-stage-2-3-2026-05-24.md)

---

## Question

Are `campaign.status` and `ad_group.status` SELECTable from `FROM ad_group_ad` in Google Ads API SDK v23 (not another SDK-vs-runtime trap — pattern has bit us 5 times this milestone)? And does imaa's data contain rows where the production bug actually fires (ad ENABLED but parent campaign PAUSED)?

## Q9-1 — SELECTability probe

**Status:** ✅ PASSED (6 rows returned)

```sql
SELECT
  ad_group_ad.ad.id,
  ad_group_ad.status,
  ad_group.id,
  ad_group.status,
  campaign.id,
  campaign.status,
  campaign.name
FROM ad_group_ad
WHERE segments.date BETWEEN '2026-04-25' AND '2026-05-25'
  AND ad_group_ad.status != 'REMOVED'
LIMIT 50
```

Both `campaign.status` and `ad_group.status` accepted by the GAQL parser when querying `FROM ad_group_ad`. **Not a trap.** No `query_error 32` (`Unrecognized field`) as the milestone has hit with `image_ad.image_asset` (M5), `sitelink_asset.description1/2` (M6), `asset_group_asset.performance_label` (M-PMax recon Q3), `asset_group_listing_group_filter.vertical` (Q7e), and `shopping_performance_view → asset_group` JOIN (Q8d).

The fields are mechanical extensions of the established `campaign.id` + `ad_group.id` join — high-confidence analysis from Stage 5 confirmed live.

## Q9-2 — bucket distribution (the bug-scenario probe)

**Status:** ✅ PASSED. imaa data contains the bug instances.

| (campaign.status, ad_group_ad.status) | Row count |
|---|---|
| (2 / ENABLED, 2 / ENABLED) | 4 |
| (3 / PAUSED, 2 / ENABLED) | **2** ← bug instances |

Integer enum mapping: `2 = ENABLED, 3 = PAUSED, 4 = REMOVED` per Google's `CampaignStatusEnum` + `AdGroupStatusEnum` + `AdGroupAdStatusEnum` proto definitions (9th instance of the integer-drift pattern — all three share the same `{0..4}` encoding).

## Mismatch rows — the specific ads that previously rendered as نشط incorrectly

```
ad_id=674572394288  campaign="IMA-Sales-2kSAR--NDOffer-Oct"
  status: campaign=PAUSED ag=ENABLED ad=ENABLED  →  effective=PAUSED
ad_id=679819748807  campaign="Search-3"
  status: campaign=PAUSED ag=ENABLED ad=ENABLED  →  effective=PAUSED
```

These two ads exactly match the user's bug report ("2 of the 7 creative cards show نشط on Google Creatives grid, but the parent campaigns are PAUSED"). The `computeEffectiveAdStatus` rollup (REMOVED > PAUSED > ENABLED, min-restrictive) correctly maps both to `effective=PAUSED` → UI badge `موقوف`.

## Implication for the production fix

The Stage 5 fix that was originally `9caac84` (reverted in `3f7c6b8` after the 0-campaigns regression) is empirically verified safe to re-ship:

- **Code-level analysis** (from Stage 5 diagnostic): the fix's diff is structurally isolated to the ad-level code path. The campaigns-tab code path uses `fetchCampaigns` + `normalizeCampaignToInsight` — entirely untouched.
- **GAQL field availability** (this probe): both new SELECT fields accepted at runtime in SDK v23.
- **Data shape** (this probe): the bug instances exist in imaa's data and will visibly flip from نشط to موقوف on the next dashboard refresh.
- **Cache invalidation**: v5 → v6 bump still bundled with the fix. This will force every account's `insights_cache` + `creatives_cache` rows to refetch, applying the new effective-status semantics universally. Critical difference from the first attempt: imaa's OAuth is now healthy, so the refetch will succeed — no repeat of the v5→v6-exposes-broken-OAuth regression that nuked the campaigns tab yesterday.

## Re-ship sequence

1. ✅ This recon doc — landed atomically as `docs(recon): Q9 probe findings — campaign + ad_group status verified`
2. Next commit: `git revert 3f7c6b8` — un-reverts the revert, restoring `9caac84`'s changes (ads.ts + google.ts + cache.ts v5→v6)
3. `npm run check` + `git push origin phase-4.8-m-pmax`
4. Vercel rebuilds preview
5. User hard-refreshes — expected result: 7 campaigns visible in الحملات tab (NOT empty); 2 specific ads show موقوف badge in الإبداعات tab; PMax card + modal unchanged

## Summary checklist

| Item | Result |
|---|---|
| `campaign.status` SELECTable from `FROM ad_group_ad` | ✅ verified live |
| `ad_group.status` SELECTable from `FROM ad_group_ad` | ✅ verified live |
| Integer enum `2/3/4` convention | ✅ matches Google proto docs |
| imaa has `(campaign=PAUSED, ad=ENABLED)` rows | ✅ 2 rows |
| Bug ads identified | `674572394288` (IMA-Sales-2kSAR--NDOffer-Oct), `679819748807` (Search-3) |
| Effective rollup logic correct | ✅ `min(c, ag, ad)` → PAUSED for both bug instances |
| Original regression root cause | ✅ confirmed = v5→v6 cache bump exposing broken OAuth (now fixed) |
| Safe to re-ship `9caac84` | ✅ verified |

No production code touched in this commit — recon doc only.
