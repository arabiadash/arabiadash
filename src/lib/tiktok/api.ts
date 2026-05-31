/**
 * Thin HTTP layer for TikTok Marketing API v1.3.
 *
 * Per ADR-020 §Decision 1 + §Decision 6 + §Decision 7: this is the
 * single file that owns ALL v1.3 endpoint details. When v1.4 ships,
 * bump TIKTOK_API_VERSION + patch any field paths here. Everything
 * downstream (normalize.ts + providers/tiktok.ts) is insulated.
 *
 * Returns TikTok-native response shapes — does NOT return UnifiedAd
 * or other normalized types. Shape mapping lives in normalize.ts.
 *
 * Pattern mirrors src/lib/meta/api.ts (also direct fetch() against
 * an external advertising API with no SDK). Auth header is the
 * `Access-Token` request header, not query param — TikTok diverges
 * from Meta + Google here.
 *
 * All metric names + field names + endpoint shapes empirically
 * verified via the Session 2 probe suite (2026-05-30 / 2026-05-31).
 * See docs/decisions/020-tiktok-adapter-v1.md §Report-Shape Empirical
 * Findings + §12c for the source-of-truth amendments.
 */

import {
  type DateRangeInput,
  isCustomRange,
  presetToCustomRange,
} from "@/lib/ads/types";

// ───────────────────────────────────────────────────────────────────
// Version pin per ADR-020 §Decision 7 — single source of truth.
// When TikTok deprecates v1.3 → v1.4, this is the ONLY constant
// to update (plus any field-path adjustments downstream in normalize).
// ───────────────────────────────────────────────────────────────────
export const TIKTOK_API_VERSION = "v1.3";
export const TIKTOK_BASE_URL = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;
export const TIKTOK_AUTH_BASE_URL = "https://business-api.tiktok.com";

// ───────────────────────────────────────────────────────────────────
// Common envelope: TikTok wraps every response in { code, message,
// data, request_id }. code=0 = success; non-zero throws via api.ts.
// ───────────────────────────────────────────────────────────────────
interface TiktokEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

/**
 * Centralized GET helper. Sets the Access-Token header + Content-Type,
 * unwraps the envelope, throws on non-zero `code` with a structured
 * error message that classifyTiktokError can pattern-match.
 *
 * Per ADR-020 §Decision 15: every TikTok call lands here so timing
 * instrumentation can be added in one place during Session 3's perf
 * gate.
 */
async function tiktokGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${TIKTOK_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TikTok API HTTP ${response.status} on ${path}: ${text}`
    );
  }

  const json = (await response.json()) as TiktokEnvelope<T>;
  if (json.code !== 0) {
    throw new Error(
      `TikTok API error ${json.code} on ${path}: ${json.message}`
    );
  }
  return json.data;
}

// ───────────────────────────────────────────────────────────────────
// /oauth2/advertiser/get/ — discover advertiser_ids the user
// authorized during OAuth. Required for the account selector.
//
// Per TikTok docs, response shape:
// {
//   "list": [
//     { "advertiser_id": "...", "advertiser_name": "..." },
//     ...
//   ]
// }
// ───────────────────────────────────────────────────────────────────
export interface TiktokAccessibleAdvertiser {
  advertiser_id: string;
  advertiser_name: string;
}

interface AdvertiserGetResponse {
  list: TiktokAccessibleAdvertiser[];
}

export async function getAccessibleAdvertisers(
  accessToken: string,
  appId: string,
  secret: string
): Promise<TiktokAccessibleAdvertiser[]> {
  // Wire shape per official TikTok SDK (authoritative source — empirically
  // confirmed 2026-05-30 via _tiktok-shape-test.mjs probe):
  //   GET /open_api/v1.3/oauth2/advertiser/get/?app_id=X&secret=Y
  //   Header: Access-Token: <access_token>
  //
  // app_id + secret are query params; access_token goes in the
  // Access-Token header. The sibling /oauth2/access_token/ and
  // /oauth2/refresh_token/ endpoints are POST+body, but this one
  // breaks the namespace pattern.
  //
  // Source: github.com/tiktok/tiktok-business-api-sdk
  //   python_sdk/business_api_client/api/authentication_api.py
  //
  // Latent bug from Session 1 — the original query-param shape
  // (access_token=... in URL) returned envelope code 40104
  // "The access_token is empty." and never actually worked. Caught
  // by the first live probe run after Session 2 Commit 1.
  const url = new URL(`${TIKTOK_BASE_URL}/oauth2/advertiser/get/`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("secret", secret);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TikTok API HTTP ${response.status} on advertiser/get: ${text}`
    );
  }

  const json = (await response.json()) as TiktokEnvelope<AdvertiserGetResponse>;
  if (json.code !== 0) {
    throw new Error(
      `TikTok API error ${json.code} on advertiser/get: ${json.message}`
    );
  }
  return json.data.list ?? [];
}

// ───────────────────────────────────────────────────────────────────
// /advertiser/info/ — fetch enrichment fields (currency, timezone,
// display_name) for a specific advertiser_id. Used to populate
// connections.metadata at select-accounts time.
//
// Per TikTok docs:
// {
//   "list": [{
//     "advertiser_id": "...",
//     "name": "...",
//     "currency": "USD" | "SAR" | ...,
//     "timezone": "Asia/Riyadh",
//     "country": "SA",
//     "status": "STATUS_ENABLE" | "STATUS_FROZEN" | ...,
//     ...
//   }]
// }
// ───────────────────────────────────────────────────────────────────
export interface TiktokAdvertiserInfo {
  advertiser_id: string;
  name: string;
  currency: string;
  timezone: string;
  country?: string;
  status: string;
}

interface AdvertiserInfoResponse {
  list: TiktokAdvertiserInfo[];
}

export async function getAdvertiserInfo(
  accessToken: string,
  advertiserIds: string[]
): Promise<TiktokAdvertiserInfo[]> {
  if (advertiserIds.length === 0) return [];
  return (
    await tiktokGet<AdvertiserInfoResponse>(
      "/advertiser/info/",
      accessToken,
      {
        advertiser_ids: JSON.stringify(advertiserIds),
      }
    )
  ).list ?? [];
}

// ═══════════════════════════════════════════════════════════════════
// Date-range helper — converts DateRangeInput (preset/custom/lifetime)
// to the YYYY-MM-DD strings TikTok expects. Mirrors the Meta precedent
// (src/lib/meta/api.ts:resolveRangeToDates). Local because it returns
// strings in TikTok's format, not Meta's.
// ═══════════════════════════════════════════════════════════════════

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Resolve a DateRangeInput to explicit YYYY-MM-DD strings.
 * "lifetime" → 2-year lookback (TikTok has no date_preset=maximum
 * equivalent; pick a wide window that's well beyond typical campaign
 * histories on this customer profile).
 */
function resolveRangeToDates(
  range: DateRangeInput
): { since: string; until: string } {
  if (isCustomRange(range)) {
    return { since: range.since, until: range.until };
  }
  if (range === "lifetime") {
    const today = new Date();
    const twoYearsAgo = new Date(
      today.getTime() - 730 * 24 * 60 * 60 * 1000
    );
    return { since: toYmd(twoYearsAgo), until: toYmd(today) };
  }
  const customRange = presetToCustomRange(range);
  return { since: customRange.since, until: customRange.until };
}

// ═══════════════════════════════════════════════════════════════════
// Common shapes — page_info echoed by /report/integrated/get/,
// /ad/get/, /campaign/get/ alike (all integers despite TikTok's
// metric-strings convention).
// ═══════════════════════════════════════════════════════════════════

export interface TiktokPageInfo {
  page: number;
  page_size: number;
  total_page: number;
  total_number: number;
}

// ═══════════════════════════════════════════════════════════════════
// /report/integrated/get/ — performance reporting endpoint.
//
// Wire shape per Session 2 probes (verified 2026-05-31):
//   GET /open_api/v1.3/report/integrated/get/
//   Header: Access-Token
//   Query: advertiser_id, report_type=BASIC, data_level, dimensions
//          (JSON-array), metrics (JSON-array), start_date, end_date,
//          page, page_size
//
// data_level uses AUCTION_* prefix (NOT AUC_* as session2-plan v1
// originally documented — corrected via SDK source + empirical probe).
// ═══════════════════════════════════════════════════════════════════

export type TiktokDataLevel =
  | "AUCTION_ADVERTISER"
  | "AUCTION_CAMPAIGN"
  | "AUCTION_ADGROUP"
  | "AUCTION_AD";

/**
 * One row from /report/integrated/get/. Metrics are STRINGS (per
 * empirical K1 finding — TikTok returns all metrics as strings;
 * normalize.ts coerces via parseInt / parseFloat). Dimensions echo
 * back the dimension values requested (e.g. {advertiser_id: "..."}
 * or {ad_id: "..."}).
 */
export interface TiktokReportRow {
  metrics: Record<string, string>;
  dimensions: Record<string, string>;
}

export interface TiktokReportResponse {
  list: TiktokReportRow[];
  page_info: TiktokPageInfo;
}

/**
 * Account-level metric set (AUCTION_ADVERTISER + AUCTION_CAMPAIGN).
 * All 11 names empirically verified valid in v1.3 via Session 2 probes
 * (_tiktok-report-shape.mjs, _tiktok-report-q2b.mjs,
 * _tiktok-report-active.mjs, _tiktok-metric-validity.mjs).
 *
 * `complete_payment` family is the v1 purchase-attribution choice
 * per ADR-020 §Decision 2 + Report-Shape Findings §4. vta_purchase /
 * cta_purchase split deferred to a v2 TikTok-specific surface.
 *
 * CTR is 0-100 percentage scale (K2 verified). normalize.ts passes
 * through with parseFloat — no scale conversion.
 */
const INSIGHTS_METRICS_ACCOUNT: readonly string[] = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "reach",
  "frequency",
  "complete_payment",
  "total_purchase_value",
  "complete_payment_roas",
] as const;

/**
 * Campaign-level metrics — same set as account level. TikTok's report
 * surface returns the same metrics regardless of data_level (verified
 * empirically across AUCTION_ADVERTISER + AUCTION_AD; AUCTION_CAMPAIGN
 * follows by API design).
 */
const INSIGHTS_METRICS_CAMPAIGN: readonly string[] = INSIGHTS_METRICS_ACCOUNT;

/**
 * Per-ad metrics (AUCTION_AD) — account set + video_play_actions.
 *
 * `video_play_actions` is TikTok's canonical view count (maps
 * internally to `total_play` per the SDK YAML). Powers the
 * TikTokCreativeCard footer's "N views" display per ADR-020 §12
 * (the original §Decision 12 + session2-plan reference to
 * `video_views` was wrong — that name is rejected with 40002 at
 * every data_level; see Report-Shape Findings §1).
 */
const INSIGHTS_METRICS_AD: readonly string[] = [
  ...INSIGHTS_METRICS_ACCOUNT,
  "video_play_actions",
] as const;

/**
 * Centralized report fetcher. Single call, no chunking — TikTok has
 * no Meta-style 30-day daily-breakdown truncation. page_size=1000
 * (TikTok's documented max) covers any realistic v1 row count;
 * pagination loop deferred to a future enhancement if any real
 * account exceeds it.
 */
export async function getReportInsights(
  accessToken: string,
  advertiserId: string,
  dataLevel: TiktokDataLevel,
  dimensions: string[],
  metrics: readonly string[],
  range: DateRangeInput
): Promise<TiktokReportRow[]> {
  const { since, until } = resolveRangeToDates(range);
  const response = await tiktokGet<TiktokReportResponse>(
    "/report/integrated/get/",
    accessToken,
    {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: dataLevel,
      dimensions: JSON.stringify(dimensions),
      metrics: JSON.stringify([...metrics]),
      start_date: since,
      end_date: until,
      page: 1,
      page_size: 1000,
    }
  );
  return response.list ?? [];
}

/**
 * Account-level insights (totals across the whole advertiser).
 * Used by TiktokAdapter.getAccountInsights for the KPI strip.
 */
export async function getAccountInsights(
  accessToken: string,
  advertiserId: string,
  range: DateRangeInput
): Promise<TiktokReportRow[]> {
  return getReportInsights(
    accessToken,
    advertiserId,
    "AUCTION_ADVERTISER",
    ["advertiser_id"],
    INSIGHTS_METRICS_ACCOUNT,
    range
  );
}

/**
 * Per-campaign insights. dimensions include campaign_id; rows are
 * joined to campaign metadata (from getCampaigns) in normalize.ts.
 */
export async function getCampaignInsights(
  accessToken: string,
  advertiserId: string,
  range: DateRangeInput
): Promise<TiktokReportRow[]> {
  return getReportInsights(
    accessToken,
    advertiserId,
    "AUCTION_CAMPAIGN",
    ["campaign_id"],
    INSIGHTS_METRICS_CAMPAIGN,
    range
  );
}

/**
 * Per-ad insights. Includes video_play_actions for TikTokCreativeCard
 * footer. Adapter joins these by ad_id with getAds rows + (lazily)
 * URL-resolves via getFileVideoAdInfo / getIdentityVideoInfo per §12c.
 */
export async function getAdInsights(
  accessToken: string,
  advertiserId: string,
  range: DateRangeInput
): Promise<TiktokReportRow[]> {
  return getReportInsights(
    accessToken,
    advertiserId,
    "AUCTION_AD",
    ["ad_id"],
    INSIGHTS_METRICS_AD,
    range
  );
}

// ═══════════════════════════════════════════════════════════════════
// /ad/get/ — ad metadata + creative-routing discriminators.
//
// Per ADR-020 §12c §4: ALL fields are optional (silently-dropped mode
// 3 is real on Spark Ads). normalize.ts uses `?.` + nullish-coalesce
// on every read.
//
// AD_FIELDS excludes the 5 silently-dropped fields (ad_format,
// call_to_action, call_to_action_id, creative_type, image_mode).
// They're in TikTok's allowed-fields list but absent from the
// response on AUTH_CODE (Spark Ad) rows. Excluded to avoid the
// "valid field name, missing value" anti-pattern; can be re-added
// later when normalize.ts has a real consumer for them.
// ═══════════════════════════════════════════════════════════════════

/**
 * Per-ad row from /ad/get/. ALL fields optional per §12c §4
 * defensive-field rule. `video_id: string | null` because TikTok
 * explicitly returns null (not absent) on non-video ads — distinct
 * from "field missing entirely".
 */
export interface TiktokAdRow {
  ad_id?: string;
  ad_name?: string;
  ad_text?: string;
  display_name?: string;
  secondary_status?: string;
  operation_status?: string;
  campaign_id?: string;
  adgroup_id?: string;
  // Creative path discriminators per ADR-020 §12c §1
  video_id?: string | null;       // path A: direct upload (BC_AUTH_TT)
  image_ids?: string[];           // path C: pure image (DEFERRED)
  tiktok_item_id?: string;        // path B: Spark Ad (AUTH_CODE)
  identity_type?: string;         // AUTH_CODE | BC_AUTH_TT | TT_USER | CUSTOMIZED_USER
  identity_id?: string;           // path B URL resolution dependency
  landing_page_url?: string;
  create_time?: string;
  modify_time?: string;
}

export interface TiktokAdsResponse {
  list: TiktokAdRow[];
  page_info: TiktokPageInfo;
}

/**
 * The 16 verified-safe /ad/get/ fields. Excludes the 5 silently-
 * dropped fields per §12c §4. If future normalize.ts work needs
 * additional fields, validate against TikTok's allowed-list (returned
 * verbatim in 40002 error messages) before adding.
 */
const AD_FIELDS: readonly string[] = [
  "ad_id",
  "ad_name",
  "ad_text",
  "display_name",
  "secondary_status",
  "operation_status",
  "campaign_id",
  "adgroup_id",
  "video_id",
  "image_ids",
  "tiktok_item_id",
  "identity_type",
  "identity_id",
  "landing_page_url",
  "create_time",
  "modify_time",
] as const;

const ADS_PAGE_SIZE = 100;
const MAX_AD_PAGES = 20;

/**
 * List ads for an advertiser. Pagination loop via page+page_size
 * (TikTok uses 1-indexed page numbers, NOT Meta's paging.next cursor).
 * MAX_AD_PAGES safety cap (20 pages × 100 = 2000 ads max) mirrors
 * Meta's getAds convention.
 *
 * NO embedded insights — TikTok's /ad/get/ returns metadata only.
 * Adapter joins with getAdInsights by ad_id (NOT date-filtered at
 * this layer; range param reserved for future use if TikTok adds
 * activity-window filtering).
 */
export async function getAds(
  accessToken: string,
  advertiserId: string,
  range: DateRangeInput
): Promise<TiktokAdRow[]> {
  // range currently unused at this layer — adapter date-filters via
  // getAdInsights and joins by ad_id. Parameter kept for API
  // consistency + future-proofing if a filter is needed here.
  void range;

  const allAds: TiktokAdRow[] = [];
  let page = 1;
  while (page <= MAX_AD_PAGES) {
    const response = await tiktokGet<TiktokAdsResponse>(
      "/ad/get/",
      accessToken,
      {
        advertiser_id: advertiserId,
        fields: JSON.stringify([...AD_FIELDS]),
        page,
        page_size: ADS_PAGE_SIZE,
      }
    );
    const list = response.list ?? [];
    allAds.push(...list);
    if (list.length === 0) break;
    const totalPages = response.page_info?.total_page ?? 0;
    if (page >= totalPages) break;
    page++;
  }
  return allAds;
}

// ═══════════════════════════════════════════════════════════════════
// /campaign/get/ — campaign metadata.
//
// CAMPAIGN_FIELDS minimal set: identifiers + objective + status.
// UNCERTAIN — /campaign/get/'s allowed-fields list is not yet
// empirically verified (no Session 2 probe ran against this
// endpoint). Mirrors /ad/get/'s status-field naming convention
// (operation_status + secondary_status). If 40002 fires during 2b
// integration testing, the error message will name the bad field
// and we patch.
// ═══════════════════════════════════════════════════════════════════

export interface TiktokCampaignRow {
  campaign_id?: string;
  campaign_name?: string;
  objective_type?: string;
  operation_status?: string;
  secondary_status?: string;
}

export interface TiktokCampaignsResponse {
  list: TiktokCampaignRow[];
  page_info: TiktokPageInfo;
}

const CAMPAIGN_FIELDS: readonly string[] = [
  "campaign_id",
  "campaign_name",
  "objective_type",
  "operation_status",
  "secondary_status",
] as const;

const CAMPAIGNS_PAGE_SIZE = 100;
const MAX_CAMPAIGN_PAGES = 20;

export async function getCampaigns(
  accessToken: string,
  advertiserId: string
): Promise<TiktokCampaignRow[]> {
  const allCampaigns: TiktokCampaignRow[] = [];
  let page = 1;
  while (page <= MAX_CAMPAIGN_PAGES) {
    const response = await tiktokGet<TiktokCampaignsResponse>(
      "/campaign/get/",
      accessToken,
      {
        advertiser_id: advertiserId,
        fields: JSON.stringify([...CAMPAIGN_FIELDS]),
        page,
        page_size: CAMPAIGNS_PAGE_SIZE,
      }
    );
    const list = response.list ?? [];
    allCampaigns.push(...list);
    if (list.length === 0) break;
    const totalPages = response.page_info?.total_page ?? 0;
    if (page >= totalPages) break;
    page++;
  }
  return allCampaigns;
}

// ═══════════════════════════════════════════════════════════════════
// /file/video/ad/info/ — path A URL resolver per ADR-020 §12c §1.
//
// Fetches signed CDN URLs for direct-upload (BC_AUTH_TT) video ads.
// URLs expire in hours (preview_url_expire_time field + x-expires
// query params on video_cover_url). CACHE ONLY IDs in creatives_cache;
// re-resolve URLs at render time via this endpoint (per §12c §2).
// ═══════════════════════════════════════════════════════════════════

/**
 * Per-video metadata row from /file/video/ad/info/. Empirically
 * verified shape (probe 2026-05-31) — all listed fields present in
 * the response when envelope code === 0.
 */
export interface TiktokFileVideoInfoRow {
  video_id: string;
  video_cover_url: string;
  preview_url: string;
  preview_url_expire_time: string;
  duration: number;
  width: number;
  height: number;
  format: string;
  size: number;
  bit_rate: number;
  material_id: string;
  signature: string;
  file_name: string;
  create_time: string;
  modify_time: string;
  allow_download: boolean;
  displayable: boolean;
  allowed_placements: string[];
  fix_task_id: string | null;
  flaw_types: string | null;
}

export interface TiktokFileVideoInfoResponse {
  list: TiktokFileVideoInfoRow[];
}

/**
 * Resolve video URLs for one or more video_ids. Empty input returns
 * empty array (no API call). video_ids passed as JSON-encoded array
 * (the SDK Python "multi" collection_format is wrong; empirically
 * verified that JSON encoding is what TikTok accepts).
 */
export async function getFileVideoAdInfo(
  accessToken: string,
  advertiserId: string,
  videoIds: string[]
): Promise<TiktokFileVideoInfoRow[]> {
  if (videoIds.length === 0) return [];
  const response = await tiktokGet<TiktokFileVideoInfoResponse>(
    "/file/video/ad/info/",
    accessToken,
    {
      advertiser_id: advertiserId,
      video_ids: JSON.stringify(videoIds),
    }
  );
  return response.list ?? [];
}

// ═══════════════════════════════════════════════════════════════════
// /identity/video/info/ — path B URL resolver per ADR-020 §12c §1.
//
// Fetches signed CDN URLs for Spark Ad (AUTH_CODE / TT_USER /
// BC_AUTH_TT-with-organic-source) creatives. Returns a single
// `video_detail` object (NOT a `list` array — diverges from
// /file/video/ad/info/). Same hours-scale URL expiry.
// ═══════════════════════════════════════════════════════════════════

export interface TiktokIdentityVideoInfo {
  url: string;          // playable MP4 (signed, expiring)
  poster_url: string;   // cover image (signed, expiring)
  duration: number;
  bit_rate: number;
  format: string;
  width: number;
  height: number;
  size: number;
  signature: string;
}

export interface TiktokIdentityAuthInfo {
  ad_auth_status: string;
  auth_start_time: string;
  auth_end_time: string;
  invite_start_time: string;
}

export interface TiktokIdentityAnchor {
  Id: string;
  status: string;
  title: string;
  url: string;
}

/**
 * Empirically verified shape (probe 2026-05-31) against a real IMAA
 * Spark Ad. The auth_info / anchor_list / carousel_info fields are
 * present-but-empty for VIDEO item_type; the carousel_info.image_info
 * array populates when item_type === "CAROUSEL" (not yet probed
 * against a real CAROUSEL Spark Ad).
 */
export interface TiktokIdentityVideoDetail {
  item_id: string;
  item_type: string;           // "VIDEO" | "CAROUSEL" | ...
  status: string;
  text: string;                // full post caption (Arabic content on Saudi accounts)
  video_info: TiktokIdentityVideoInfo;
  auth_info?: TiktokIdentityAuthInfo;
  carousel_info?: {
    image_info: unknown[];     // populates when item_type === "CAROUSEL" — shape unverified
    music_info: Record<string, unknown>;
  };
  anchor_list?: TiktokIdentityAnchor[];
}

export interface TiktokIdentityVideoInfoResponse {
  video_detail: TiktokIdentityVideoDetail;
  video_details: unknown[];    // empty array in probe — purpose unknown
}

/**
 * Resolve URLs + metadata for a Spark Ad's source organic post.
 * Returns null if the response lacks video_detail (defensive — the
 * endpoint may return code 0 with empty data on certain identity
 * states; not yet observed empirically).
 */
export async function getIdentityVideoInfo(
  accessToken: string,
  advertiserId: string,
  identityType: string,
  identityId: string,
  itemId: string
): Promise<TiktokIdentityVideoDetail | null> {
  const response = await tiktokGet<TiktokIdentityVideoInfoResponse>(
    "/identity/video/info/",
    accessToken,
    {
      advertiser_id: advertiserId,
      identity_type: identityType,
      identity_id: identityId,
      item_id: itemId,
    }
  );
  return response.video_detail ?? null;
}
