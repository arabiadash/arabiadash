# TikTok creative-probe findings (2026-05-31)

**Status**: untracked local-only working notes. Source of truth for the §12 amendment to ADR-020 that will be written at the start of next session, before Session 2 Commit 2 implementation.

**Author**: Empirical probes against IMAA (advertiser_id `7327982125339328514`, ~201 ads sampled, 10.4M impressions / 89k clicks over 30 days) — the richest active TikTok account on the testing apparatus. All findings reproducible by re-running `scripts/_tiktok-spark-creative.mjs` + `scripts/_tiktok-final-shapes.mjs` against the same advertiser with the persisted `TIKTOK_ACCESS_TOKEN`.

---

## 1. Three creative paths — detection + state

| Path | Detection rule | State | Endpoint |
|------|----------------|:-----:|----------|
| **A — Direct video upload** | `video_id` populated AND `identity_type=BC_AUTH_TT` (UUID identity_id) | ✓ FULLY RESOLVED | `/file/video/ad/info/` |
| **B — Spark Ad (boosted organic post)** | `tiktok_item_id` populated AND `video_id=null` AND `identity_type=AUTH_CODE` (numeric identity_id) | ✓ FULLY RESOLVED | `/identity/video/info/` |
| **C — Pure image ad** | `image_ids` populated AND `video_id=null` AND `tiktok_item_id=null` | ⚠️ DEFERRED to v2 follow-up | `/file/image/ad/info/` |

`identity_type` is the canonical discriminator. Observed values in v1.3 on Saudi accounts:

- `AUTH_CODE` — Spark Ad authorization (organic-post boosting). Numeric `identity_id`. `tiktok_item_id` populated.
- `BC_AUTH_TT` — Business Center authorized TikTok account (direct ad uploads). UUID `identity_id`. `video_id` populated.
- (Other documented values not yet observed: `TT_USER`, `CUSTOMIZED_USER` — handle defensively in normalize.ts)

### Empirical share (one account, but characteristic of Saudi ecommerce)

IMAA page 1 of 50 ads:
- 21 ads with `video_id` (direct uploads — path A)
- 21 ads with `image_ids` populated (overlapping with video — image is video poster, not standalone)
- 29 ads with `tiktok_item_id` (Spark Ads — path B)
- **Zero ads with image_ids populated AND video_id null AND tiktok_item_id null** across 201 ads scanned (path C did not appear in this account)

Implication: Saudi ecommerce TikTok activity is overwhelmingly video (direct + Spark). Paths A + B are first-class; path C is rare-but-possible (e.g. shopping catalog single-image creatives).

---

## 2. Endpoint shapes verbatim

### Path A — `/file/video/ad/info/`

**Request**:
```
GET https://business-api.tiktok.com/open_api/v1.3/file/video/ad/info/
  ?advertiser_id=<id>
  &video_ids=<JSON-encoded array, e.g. ["v10033g50000d66molnog65lb89kf900"]>
Header: Access-Token: <access_token>
```

**Response** (verbatim probe output, code 0):
```json
{
  "code": 0,
  "message": "OK",
  "data": {
    "list": [
      {
        "video_id": "v10033g50000d66molnog65lb89kf900",
        "video_cover_url": "http://p16-common-sign.tiktokcdn.com/tos-alisg-p-0051c001-sg/...~tplv-noop.image?...&x-expires=1780228611&x-signature=...",
        "preview_url": "https://v16-tt4b.tiktokcdn.com/.../?...&vvpl=1&l=...&btag=e000b0000&vid=v10033g50000d66molnog65lb89kf900",
        "preview_url_expire_time": "2026-05-31 11:56:41",
        "duration": 10.033,
        "format": "mp4",
        "width": 1080,
        "height": 1920,
        "size": 11521562,
        "bit_rate": 9186627,
        "material_id": "7605854325056585746",
        "signature": "5f1f081ec9f2a41b9199bb9d4e62520e",
        "file_name": "20260208_034903460_iOS_9QtVxPbr.MP4",
        "create_time": "2026-02-12T06:01:33Z",
        "modify_time": "2026-02-12T06:01:33Z",
        "allow_download": true,
        "displayable": true,
        "allowed_placements": ["PLACEMENT_TOPBUZZ", "PLACEMENT_TIKTOK", "PLACEMENT_HELO", "PLACEMENT_PANGLE", "PLACEMENT_GLOBAL_APP_BUNDLE"],
        "fix_task_id": null,
        "flaw_types": null
      }
    ]
  }
}
```

**Critical URL fields**:
- `data.list[].video_cover_url` — JPG poster, signed (`x-signature` + `x-expires`)
- `data.list[].preview_url` — playable MP4, signed + has explicit `preview_url_expire_time` field

### Path B — `/identity/video/info/`

**Request**:
```
GET https://business-api.tiktok.com/open_api/v1.3/identity/video/info/
  ?advertiser_id=<id>
  &identity_type=AUTH_CODE
  &identity_id=<numeric, e.g. 6605542994630721542>
  &item_id=<numeric, e.g. 7638941401274764565>
Header: Access-Token: <access_token>
```

**Response** (verbatim probe output, code 0):
```json
{
  "code": 0,
  "message": "OK",
  "data": {
    "video_detail": {
      "item_id": "7638941401274764565",
      "item_type": "VIDEO",
      "status": "ITEM_STATUS_HESITATE_RECOMMEND",
      "text": "٧ عطور ب ١٨٩ ريال + كود خصم KA26 ... @IMAA | ايما #صيف_ايما ...",
      "video_info": {
        "url": "https://v19-tt4b.tiktokcdn.com/.../?...&vvpl=1&l=...&btag=e000b8000",
        "poster_url": "https://p16-common-sign.tiktokcdn.com/tos-alisg-p-0037/...~tplv-noop.image?...&x-expires=1780293914&x-signature=...",
        "duration": 14.722,
        "bit_rate": 7943006,
        "format": "mp4",
        "width": 1080,
        "height": 1920,
        "size": 14617117,
        "signature": "c11dcf64adb413488646f39d6475ac00"
      },
      "auth_info": {
        "ad_auth_status": "AUTHORIZED",
        "auth_start_time": "2026-05-24T07:09:07Z",
        "auth_end_time": "2026-06-23T07:09:07Z",
        "invite_start_time": "2026-05-24T07:09:07Z"
      },
      "carousel_info": {
        "image_info": [],
        "music_info": {}
      },
      "anchor_list": [{"Id": "7643355811640576007", "status": "CheckSuccess", "title": "", "url": ""}]
    },
    "video_details": []
  }
}
```

**Critical URL fields**:
- `data.video_detail.video_info.poster_url` — JPG poster, signed (different nesting from path A; same expiry pattern)
- `data.video_detail.video_info.url` — playable MP4, signed (no explicit `_expire_time` field — must parse `x-expires` from URL or just re-fetch)

**Bonus fields beyond path A**:
- `data.video_detail.text` — full post caption (Arabic, hashtags, mentions) — richer than path A's `file_name`
- `data.video_detail.auth_info` — authorization window (could power a v2 "expires in N days" UX)
- `data.video_detail.carousel_info` — populated when `item_type=CAROUSEL` (carousel Spark Ad handling — not yet probed empirically)
- `data.video_detail.anchor_list` — TikTok anchor attachments (product links, etc.)

### Path C — `/file/image/ad/info/` (deferred)

**Endpoint shape verified** (request format):
```
GET https://business-api.tiktok.com/open_api/v1.3/file/image/ad/info/
  ?advertiser_id=<id>
  &image_ids=<JSON-encoded array>
Header: Access-Token: <access_token>
```

Notes:
- JSON-encoded `image_ids` form is CORRECT (multi format `?image_ids=A&image_ids=B` rejected with code 40002 `"error unmarshaling parameter"`)
- This contradicts the SDK Python source's `collection_formats['image_ids'] = 'multi'` — the SDK is outdated; the API only accepts JSON arrays
- Response shape UNCONFIRMED — IMAA has no pure-image ads to probe against; the only image_id available was a video poster which returned code 40001 `"Insufficient permissions"` (ACL surface differs for video-cover vs creative images)

---

## 3. Field-name comparison — TWO endpoints, TWO shapes

| Concern | Path A — `/file/video/ad/info/` | Path B — `/identity/video/info/` |
|---------|----------------------------------|-----------------------------------|
| Response root | `data.list[]` (array) | `data.video_detail` (single object) |
| Cover/poster | `data.list[].video_cover_url` | `data.video_detail.video_info.poster_url` |
| Playable video | `data.list[].preview_url` | `data.video_detail.video_info.url` |
| Caption/title | `data.list[].file_name` (filename only) | `data.video_detail.text` (full post caption) |
| Duration | `data.list[].duration` (float seconds) | `data.video_detail.video_info.duration` (float seconds) |
| Dimensions | `data.list[].{width,height}` (numbers) | `data.video_detail.video_info.{width,height}` (numbers) |
| Carousel handling | (not applicable — single video) | `data.video_detail.carousel_info.image_info` (array) |
| Authorization metadata | (not present) | `data.video_detail.auth_info` (auth window) |

---

## 4. URL expiry — cache IDs only, re-fetch on render

**Both** path A and path B return signed URLs with explicit expiry:
- Path A `preview_url_expire_time`: returned as datetime string (`"2026-05-31 11:56:41"`)
- Path A `video_cover_url`: signed with `x-expires` + `x-signature` query params (hours-scale)
- Path B `poster_url` + `url`: same signing pattern (`x-expires=1780293914` ≈ short TTL)

**Architectural implication**: the `creatives_cache` table cannot store these URLs as-is. After SWR stale-30min, the cached URLs will 403.

**Pattern for Session 2 Commit 2** (recommended):

1. `creatives_cache` stores only the **IDs** + ad metadata (no URLs):
   - For path A: `video_id`
   - For path B: `tiktok_item_id` + `identity_type` + `identity_id`
   - For path C (when implemented): `image_id`
2. TikTokCreativeCard renders trigger a SECOND call (server route → corresponding video/info endpoint) to resolve URLs fresh
3. This adds 1 API call per card render but eliminates the signed-URL-expiry footgun

Alternative (rejected): server-side proxy that re-fetches when expired. More complex; defer to v2 if request volume becomes a concern.

---

## 5. Two-mapper requirement for normalize.ts

`src/lib/tiktok/normalize.ts` must implement TWO video-info mapping functions (one per endpoint):

```typescript
// Path A — direct video upload
function normalizeFileVideoAdInfoToCreative(
  row: FileVideoAdInfoRow  // from data.list[]
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
  detail: IdentityVideoDetail  // from data.video_detail
): TikTokCreativeUrls {
  return {
    posterUrl: detail.video_info.poster_url,
    playableUrl: detail.video_info.url,
    expiresAt: parseExpiresFromXExpiresQueryParam(detail.video_info.url),
    duration: detail.video_info.duration,
    width: detail.video_info.width,
    height: detail.video_info.height,
    caption: detail.text,             // bonus field — only available for path B
    itemType: detail.item_type,       // "VIDEO" | "CAROUSEL"
    authStatus: detail.auth_info?.ad_auth_status,
  };
}
```

Both produce the same `TikTokCreativeUrls` shape (UI-facing); paths into the response differ. The adapter (`src/lib/ads/providers/tiktok.ts`) routes each ad to the correct mapper based on `identity_type`.

---

## 6. Path C deferral — reasoning + defensive fallback

**Why deferred**:
- Zero empirical evidence on the test account (IMAA = 201 ads, none match path C detection rule)
- Endpoint exists + JSON-array request shape verified; response shape unverifiable without a real direct-uploaded image creative
- Building path C blind risks the same misclassifications that Session 1 hit (cf. ADR-020 §15c) — wait for real data

**Defensive fallback in v1**:

When `normalize.ts` detects an ad matching path C (image_ids populated, no video, no tiktok_item_id), `TikTokCreativeCard`:
1. Renders an image-placeholder block (e.g. neutral background + camera icon) instead of a real preview
2. Shows ad metadata (ad_name, ad_text, landing_page_url) as usual
3. Adds a footer note: "صورة الإعلان غير متوفرة في المعاينة" (Arabic: "Ad image not available in preview")
4. NO "View on TikTok" link (image ads don't have a tiktok.com public URL)
5. Logs `[tiktok-creative] path C ad encountered, image rendering deferred: ${ad_id}` to Vercel logs

**Promotion path to first-class**:
- When a customer account presents real path C ads (Vercel logs surface it), run the throwaway image probe (`scripts/_tiktok-final-shapes.mjs`-style) against THAT customer's image_ids
- That probe will return code 0 (vs the 40001 we hit on a video-cover image_id), revealing the actual response shape
- Add a third mapper + update TikTokCreativeCard to render the resolved image URL
- ADR-020 amendment at that time

---

## 7. Next-session checklist (write ADR-020 §12 amendment FIRST, then Commit 2)

Before any code in Session 2 Commit 2:

1. Read this file
2. Append a §12-replacement amendment to `docs/decisions/020-tiktok-adapter-v1.md` covering items 1-6 above. Cite this recon doc as the source.
3. Confirm the amendment is committed + pushed before any normalize.ts / TiktokAdapter fetcher code lands
4. THEN start Commit 2: probe results → `normalize.ts` (two mappers) → `TiktokAdapter` (fetchers + identity_type routing) → `TikTokCreativeCard` (3-path render: A direct, B spark with embed-iframe fallback, C placeholder) → ReportsClient tab wiring → cache_v13→v14 bump → Memory #28 pre-push gate

The amendment unlocks the implementation. Without it, the implementation will re-discover today's findings the hard way (or get them wrong by skipping the path B endpoint entirely, since session2-plan §1.5 only documented path A).

---

## 8. Probe scripts left untracked (Session 3 chore cleanup)

These probes will be either preserved (per ADR-020 §18 disposition-B / M7/M7.5/M9 precedent) or selectively deleted in the Session 3 `chore(scripts)` commit:

| Script | Purpose | Disposition recommendation |
|--------|---------|---------------------------|
| `_tiktok-oauth-probe.mjs` | OAuth roundtrip + token persistence | PRESERVE (Session 1 probe 1) |
| `_tiktok-discover-probe.mjs` | `/oauth2/advertiser/get/` + `/advertiser/info/` shapes | PRESERVE (Session 1 probe 2) |
| `_tiktok-report-shape.mjs` | `/report/integrated/get/` minimal + unverified metrics | PRESERVE (Session 2 probe) |
| `_tiktok-creative-probe.mjs` | `/ad/get/` + `/file/video/ad/info/` shapes | PRESERVE (Session 2 probe) |
| `_tiktok-report-q2b.mjs` | metric name disambiguation (purchase + CTR) | PRESERVE (Q2b findings load-bearing for normalize.ts) |
| `_tiktok-report-active.mjs` | active-advertiser scan + K2/K5 resolution | PRESERVE (K2 CTR-scale verification reusable for future drift checks) |
| `_tiktok-video-metrics.mjs` | engagement metric enumeration (v2 surface) | PRESERVE (load-bearing for v2 engagement work) |
| `_tiktok-spark-creative.mjs` | Spark Ad confirmation + video_id hunt | PRESERVE (multi-identity_type detection logic reusable) |
| `_tiktok-final-shapes.mjs` | `/identity/video/info/` + `/file/image/ad/info/` | PRESERVE (path B + C shape evidence — load-bearing for normalize.ts mappers) |
| `_tiktok-shape-test.mjs` | one-shot header-auth verification | DELETE (purpose served; merged into discover probe pattern) |

This `tiktok-creative-findings-2026-05-31.md` recon doc itself: PRESERVE or fold into the ADR-020 §12 amendment (the amendment is the canonical destination; recon doc can be deleted post-amendment-merge OR moved to `docs/recon/archive/`).
