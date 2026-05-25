# Image Extensions Recon — Phase 4.8 M8

**Date:** 2026-05-26
**Branch:** main @ `20dd28a`
**Probe:** [scripts/_image-extensions-recon.mjs](../../scripts/_image-extensions-recon.mjs)
**Status:** Stage 2 complete — hypothesis confirmed via resource_name suffix walk

---

## Stage 1 — initial probe (Q1-Q4)

Goal: scope out what image-asset data exists on imaa for the M8 (Image Extensions for Search ads) milestone.

| Probe | Query gist | Result |
|---|---|---|
| Q1 | inventory of `asset.type IN (IMAGE, LANDSCAPE_LOGO, LOGO)` | ❌ FAILED — query_error 32 on `asset.image_asset.file_size` or `.mime_type` (5th SDK-vs-runtime trap of this milestone series) |
| Q2 | `campaign_asset` IMAGE links across all SEARCH campaigns, `status=ENABLED` | ✅ 40 rows across 4 Brand campaigns — but Stage 1 read these as "all logos" based on web-search field_type integer mapping |
| Q3 | `ad_group_asset` IMAGE links | ✅ 0 rows |
| Q4 | Display/Video active campaigns | ✅ 0 rows — pure Search/PMax account |

### Stage 1 conclusion (WRONG)

> "imaa has 0 actual image extensions — only logos. M8 would surface nothing unless field_type filter includes BUSINESS_LOGO + LANDSCAPE_LOGO."

This conclusion was based on web-search field_type integer mappings (`MARKETING_IMAGE=5, LANDSCAPE_LOGO=26, BUSINESS_LOGO=27`). The user countered with empirical UI evidence: campaign `23583176100` has 9 marketing images visible in the Google Ads UI's "Add images to your campaign" panel ("9/20" counter).

The contradiction triggered Stage 2.

---

## Stage 2 — hypothesis testing (Q2b, Q5/Q5b, Q6/Q6b, Q7, Q8, Q9)

### H1 — Wrong field_type integer assumption (CONFIRMED — root cause)

**Q2b** ran the same `campaign_asset` query as Q2 but scoped to the target campaign and removed the `status='ENABLED'` filter:

```
✓ 13 rows
field_type breakdown: { '26': 11, '27': 2 }
status breakdown:     { '2': 10 ENABLED, '3': 1 REMOVED, '4': 2 PAUSED }
```

**Q9** then walked `campaign_asset.resource_name` for each ENABLED row — the suffix is the authoritative field-type label (the integer drifts; the suffix doesn't; pattern documented in M-PMax `readAssetFieldType` helper):

```
✓ 17 rows total, ENABLED breakdown by resource_name suffix:
  SITELINK        × 3  (field_type_int=13, asset.type_int=11)
  CALLOUT         × 3  (field_type_int=11, asset.type_int=9)
  BUSINESS_NAME   × 1  (field_type_int=18, asset.type_int=5)
  BUSINESS_LOGO   × 1  (field_type_int=27, asset.type_int=4)
  AD_IMAGE        × 9  (field_type_int=26, asset.type_int=4)  ← THE USER'S 9 IMAGES
```

**Exactly 9 `AD_IMAGE` rows. Matches the UI's "9/20" counter perfectly.**

### Key correction to Stage 1 finding

**`field_type=26` on this account resolves to `AD_IMAGE`, NOT `LANDSCAPE_LOGO` as the web search documentation implied.** This is the **11th documented integer-drift trap instance** — and the second instance where multiple web sources disagree with on-the-wire reality (after the M5 `image_ad.image_asset` SDK trap).

Stage 1's "imaa has 0 image extensions" conclusion was **wrong**. imaa has at least 9 active image extensions on the target campaign alone (and likely more across the other 3 Brand campaigns — Q2's 40-row total across all 4 campaigns should be re-walked with resource_name suffix decoding to nail the true split between AD_IMAGE / LANDSCAPE_LOGO / BUSINESS_LOGO).

### H2 — Images attached via `ad_group_ad_asset_view` (REJECTED)

**Q5b** queried `ad_group_ad_asset_view` for IMAGE assets on the target campaign:

```
✓ 0 rows
```

Definitively rules out ad-level linkages for this campaign's images.

Side trap surfaced: Q5 (original) failed with `Unrecognized field in the query: 'ad_group_ad_asset_view.status'`. The view doesn't expose a `.status` field of its own — it filters via the parent `ad_group_ad.status` instead. **M6's [extensions.ts](../../src/lib/google-ads/extensions.ts) is already correct on this** (line 232 uses `ad_group_ad.status != 'REMOVED'`).

### H3 — Inline `responsive_search_ad.images` field (REJECTED — SDK trap)

**Q6b** tried `SELECT ad_group_ad.ad.responsive_search_ad.images FROM ad_group_ad` on the harvested RSA `797970386535`:

```
✗ FAILED: Unrecognized field in the query: 'ad_group_ad.ad.responsive_search_ad.images'.
          [{"query_error":32}]
```

**6th SDK-vs-runtime trap instance.** RSAs do NOT expose inline image arrays — images live exclusively in the asset-linkage tables. This confirms M8's data path is `campaign_asset` + `customer_asset` (+ `ad_group_asset` if any), not inline RSA fields.

### H4 — `customer_asset` (account-level) image links (REJECTED — only logos)

**Q7** queried `customer_asset` for IMAGE-type assets:

```
✓ 1 row
field_type breakdown: { '27': 1 }     (BUSINESS_LOGO)
status:                { '2': 1 }      (ENABLED)
```

Only the account-level BUSINESS_LOGO appears here (also auto-propagated to each of the 4 Brand campaigns via `campaign_asset` — that's why Q2 showed 4 BUSINESS_LOGO rows across the family). **No account-level marketing/ad images.** All 9 `AD_IMAGE` entries on the target are campaign-scoped, not account-scoped.

### Q8 — single-RSA confirmation

Target campaign `23583176100` has exactly 1 ENABLED ad: `ad_group_ad.ad.type=15` (RESPONSIVE_SEARCH_AD), ad_id `797970386535`. So the 9 AD_IMAGE rows attach via `campaign_asset` → are inherited by every ad in the campaign → effectively render alongside this one RSA.

---

## Definitive findings — what M8 actually has to handle

1. **`campaign_asset` is the canonical attachment table** for image extensions on Search ads — both the M6 SITELINK/CALLOUT/STRUCTURED_SNIPPET pattern (already proven in production) AND new `AD_IMAGE`/`BUSINESS_LOGO`/`LANDSCAPE_LOGO` extensions for M8.

2. **The right field_type filter is `AD_IMAGE`** (resource_name suffix), **not `MARKETING_IMAGE`** (which doesn't appear in imaa's data at all). Web search docs were misleading — they listed Google's enum *names* but the enum *integer* in `campaign_asset.field_type` resolves to `AD_IMAGE` for what the UI calls "Images" on Search ads.

3. **The right integer is `26`** (per Q9's resource_name suffix walk). But: **rely on resource_name suffix at parse time, not the integer**, per the project's existing integer-drift discipline. The M-PMax helpers (`readAssetFieldType` in google.ts) already use this pattern; M8 should follow.

4. **`asset.type_int=4` is `IMAGE`** — same for both AD_IMAGE field_type and BUSINESS_LOGO field_type. So filtering `asset.type='IMAGE'` is correct + necessary (excludes text/lead-form/etc. assets); the secondary filter is on `campaign_asset.field_type` (or its suffix).

5. **9 vs 13 reconciliation**: Q2b returned 13 image-type rows on the target (10 ENABLED, 2 PAUSED, 1 REMOVED). Q9 confirmed 9 of those 10 ENABLED are `AD_IMAGE` + 1 is `BUSINESS_LOGO`. The "9/20" UI counter is counting only `AD_IMAGE`-suffix entries — Google's UI treats LOGOs separately from image extensions even though they share `asset.type=IMAGE`.

6. **SDK trap inventory from this recon (instances #5, #6, #7 in the milestone series):**
   - **#5** — `asset.image_asset.file_size` or `.mime_type` rejected in `FROM asset` (Q1)
   - **#6** — `ad_group_ad_asset_view.status` rejected (Q5; M6's existing impl already avoids this)
   - **#7** — `ad_group_ad.ad.responsive_search_ad.images` rejected (Q6b)

7. **GAQL semantic constraint reminder**: `campaign.id` MUST appear in SELECT when used in WHERE on `campaign_asset` (and per-resource elsewhere). Same `query_error=16` MISSING_REQUIRED_FIELD_IN_SELECT_CLAUSE as the M-PMax `fetchPurchaseProductGroupTotals` query. Worth a project-wide memory entry — this isn't a one-off.

---

## Updated scope recommendations for M8 (supersedes Stage 1)

### Field type filter (corrected)

```sql
WHERE asset.type = 'IMAGE'
  AND campaign_asset.field_type IN ('AD_IMAGE', 'LANDSCAPE_LOGO', 'BUSINESS_LOGO')
  AND campaign_asset.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

Add `MARKETING_IMAGE` + `SQUARE_MARKETING_IMAGE` + `PORTRAIT_MARKETING_IMAGE` to the IN clause for forward-compatibility on accounts that *do* use those — Q2 across all Search campaigns surfaced 0 of these on imaa, but other accounts likely have them.

### Render-side decision needed

`AD_IMAGE` (the marketing-image extension showing next to ad text) and `BUSINESS_LOGO` / `LANDSCAPE_LOGO` (small brand icons) render *visually different* in Google Search results. Options:

- **Option A**: Treat all three as one "images" array — simplest, but UI loses semantic distinction
- **Option B**: Split into `extensions.images` (marketing) + `extensions.logos` (brand icons) — matches the Google UI's own split, more code
- **Option C**: Single array with a `type` discriminator per entry — keeps shape flat, UI groups at render time

Recommend Option C for ADR-014. Defer this to the ADR draft phase.

### Active-filter strictness

Stage 1 recommended strict `= 'ENABLED'`. Stage 2 confirms: on the target campaign, 1 row is REMOVED + 2 are PAUSED — these would polute the surface if filter is `!= 'REMOVED'`. Stick with strict `= 'ENABLED'` for M8.

### No cache bump needed for v7 → v8 *if* `images?` stays optional

Same logic as Stage 1's recommendation — but recommend the bump anyway so first dashboard load post-deploy populates the new data immediately.

---

## Estimated scope (revised post-Stage-2)

Same as Stage 1's estimate (~100-120 LOC + ADR + recon doc), with these adjustments:

- **Filter clause expands** from 3 field_types to 6 (AD_IMAGE + LANDSCAPE_LOGO + BUSINESS_LOGO + 3 MARKETING_IMAGE variants for forward-compat)
- **Render layer** likely needs the type-discriminator field per Option C above (~10 extra LOC in the TS type + ~15 in the render)
- **Integer-drift defensive coding**: M8's per-type fetcher should follow the M-PMax `readAssetFieldType(resourceName, fieldTypeInt)` precedent — read suffix first, fall back to integer map

---

---

## Stage 3 — campaign-wide image inventory (Q10)

Re-walked Q2's original 40-row result across all 4 Brand Search campaigns with **resource_name suffix decoding** instead of integer-to-string mapping (per Stage 2's finding that the integer map is unreliable).

### Per-campaign image inventory

| Campaign | AD_IMAGE | BUSINESS_LOGO | LANDSCAPE_LOGO | Total |
|---|---:|---:|---:|---:|
| `Sales-Search \| Brand \| KSA` | 9 | 1 | 0 | 10 |
| `Sales-Search \| Brand \| QATAR` | 9 | 1 | 0 | 10 |
| `Sales-Search \| Brand \| UAE` | 9 | 1 | 0 | 10 |
| `Sales-Search \| perfumes \| KSA` | 9 | 1 | 0 | 10 |
| **TOTAL** | **36** | **4** | **0** | **40** |

### Findings

- ✓ **No unexpected `field_type` suffixes** — every row resolves to either AD_IMAGE or BUSINESS_LOGO.
- ✓ **100% coverage** — every Search campaign has 9 AD_IMAGE entries (no gaps).
- ⚠ **Stage 2 LANDSCAPE_LOGO listing was speculative** — on imaa, this suffix appears in **zero** ENABLED rows across the entire account. The Stage 2 recon doc's recommendation to filter `IN ('AD_IMAGE', 'BUSINESS_LOGO', 'LANDSCAPE_LOGO')` should stay (forward-compat for other accounts) but **imaa as a verification target only exercises AD_IMAGE + BUSINESS_LOGO**.
- ✓ **Same 9 AD_IMAGE assets shared across all 4 campaigns** — asset.ids identical row-by-row. imaa configures one image set and links it to each campaign. Implication: cache key + dedup logic in the M8 implementation should handle this (e.g., asset_id is the dedup key, not the linkage resource_name).
- ✓ **Same BUSINESS_LOGO** (asset.id `142477531293`) inherited from `customer_asset` to each campaign — already documented in Stage 2 (Q7).

### AD_IMAGE asset.ids (for UI spot-check)

The same 9 assets appear on all 4 campaigns:

```
323690114690, 323690136074, 323690169347, 323690177465,
323766925150, 323766961147, 323820078666, 323820153066,
323820154098
```

Pair this list against the Google Ads UI's "Add images to your campaign" panel on any of the 4 Brand campaigns — every asset.id in this list should appear; the panel's "9/20" counter should match list length.

### Implications for ADR-014

1. **Filter clause confirmed final** for M8 v1:

   ```sql
   WHERE asset.type = 'IMAGE'
     AND campaign_asset.field_type IN (
       'AD_IMAGE',          -- the marketing-image extension (imaa: 36 rows)
       'BUSINESS_LOGO',     -- brand logo (imaa: 4 rows)
       'LANDSCAPE_LOGO',    -- wide brand logo (forward-compat; imaa: 0 rows)
       'MARKETING_IMAGE',   -- forward-compat for accounts using the proto-name field
       'SQUARE_MARKETING_IMAGE',
       'PORTRAIT_MARKETING_IMAGE'
     )
     AND campaign_asset.status = 'ENABLED'
     AND campaign.status = 'ENABLED'
   ```

2. **Per-entry `fieldType` discriminator (Option C, approved)** maps directly to the resource_name suffix. The shape:

   ```typescript
   extensions: {
     images?: Array<{
       url: string;
       fieldType: "AD_IMAGE" | "BUSINESS_LOGO" | "LANDSCAPE_LOGO" |
                  "MARKETING_IMAGE" | "SQUARE_MARKETING_IMAGE" |
                  "PORTRAIT_MARKETING_IMAGE" | string; // string = forward-compat catch-all
       assetId: string; // for dedup + spot-checking
     }>;
   }
   ```

3. **Cache key dedup recommendation**: the per-type fetcher should dedup by `asset.id` (or `asset.resource_name`) before issuing the `fetchAssetUrls` round-trip — imaa proves the same 9 assets repeat across 4 campaigns; without dedup we'd issue 36 lookups for 9 unique URLs. The existing M5 [fetchAssetUrls](../../src/lib/google-ads/assets.ts) already does `Array.from(new Set(resourceNames))` so this is free if M8 reuses it.

4. **Verification target post-deploy**: load arabiadash.com/dashboard/reports on a Brand campaign and confirm exactly 9 AD_IMAGE entries render per ad (plus the 1 BUSINESS_LOGO if logos are visually distinguished by the render layer).

---

## Open questions (revised after Stage 3)

1. ~~Render split — Option A/B/C?~~ **Resolved: Option C, approved by user.**
2. ~~Cache bump v7 → v8?~~ **Resolved: approved with mandatory pre-deploy Google+Meta fresh-fetch verification per Memory #28.**
3. ~~Re-walk Q2 across all 4 Brand campaigns?~~ **Resolved: ran as Q10, results above.**
4. **Field-isolation probe** before adding `asset.image_asset.file_size` / `.mime_type` / `.width_pixels` to production SELECT. Confirms the Q1 trap. Not blocking ADR draft if we omit those subfields from v1.
5. **Integer-drift memory update** — `AssetLinkStatus` order-swap (REMOVED=3, PAUSED=4 vs the standard 2/3/4) + `AssetFieldType` integer-vs-name divergence (26→AD_IMAGE not LANDSCAPE_LOGO) — both worth capturing as project memory entries.

**Status: data complete. Awaiting your authorization to draft ADR-014.**
