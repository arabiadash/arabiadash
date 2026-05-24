import { META_API_VERSION, type MetaAdAccount } from "./oauth";
import { getRevenue, getPurchaseCount } from "./metrics";
import type { UnifiedAd } from "@/lib/ads/types";

interface AdAccountsResponse {
  data: MetaAdAccount[];
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
  };
}

export async function getAdAccounts(
  accessToken: string
): Promise<MetaAdAccount[]> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts`;
  const params = new URLSearchParams({
    fields: "id,name,account_status,currency,timezone_name",
    access_token: accessToken,
    limit: "100",
  });

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch ad accounts: ${response.status} ${errorText}`
    );
  }

  const result = (await response.json()) as AdAccountsResponse;
  return result.data;
}

export async function getMetaUserInfo(
  accessToken: string
): Promise<{ id: string; name: string }> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/me`;
  const params = new URLSearchParams({
    fields: "id,name",
    access_token: accessToken,
  });

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch user info: ${response.status} ${errorText}`
    );
  }

  return response.json() as Promise<{ id: string; name: string }>;
}

export interface MetaCampaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  created_time: string;
  updated_time: string;
}

export interface MetaCarouselCard {
  image_url?: string;
  image_hash?: string;
  link?: string;
  name?: string;
  description?: string;
}

export interface MetaAdCreative {
  id: string;
  name?: string;
  image_url?: string;
  thumbnail_url?: string;
  video_id?: string;
  object_type?: string;
  body?: string;
  title?: string;
  call_to_action_type?: string;
  product_set_id?: string;
  object_story_spec?: {
    link_data?: {
      child_attachments?: MetaCarouselCard[];
      picture?: string;
      image_hash?: string;
      message?: string;
      name?: string;
      description?: string;
    };
    video_data?: {
      image_url?: string;
      video_id?: string;
      title?: string;
      message?: string;
    };
  };
  asset_feed_spec?: {
    images?: Array<{ url?: string; hash?: string }>;
    videos?: Array<{ video_id?: string; thumbnail_url?: string }>;
  };
}

export interface MetaCatalogProduct {
  id: string;
  name?: string;
  image_url?: string;
  retailer_id?: string;
}

export interface MetaAd {
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  campaign_id?: string;
  adset_id?: string;
  preview_shareable_link?: string;
  creative?: MetaAdCreative;
  insights?: {
    data: MetaInsight[];
  };
}

export interface MetaInsight {
  campaign_id?: string;
  campaign_name?: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  cpm: string;
  reach?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  date_start: string;
  date_stop: string;
}

// DateRange, TimeIncrement, CustomDateRange, DateRangeInput are defined in
// @/lib/ads/types. Re-exported here for backward compatibility.
import {
  type DateRange,
  type TimeIncrement,
  type CustomDateRange,
  type DateRangeInput,
  isCustomRange,
  presetToCustomRange,
} from "@/lib/ads/types";
export type { DateRange, TimeIncrement, CustomDateRange, DateRangeInput };
export { isCustomRange };

interface CampaignsResponse {
  data: MetaCampaign[];
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
  };
}

interface InsightsResponse {
  data: MetaInsight[];
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
  };
}

export async function getCampaigns(
  accessToken: string,
  accountId: string
): Promise<MetaCampaign[]> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/campaigns`;
  const params = new URLSearchParams({
    fields:
      "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time",
    access_token: accessToken,
    limit: "100",
  });

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch campaigns: ${response.status} ${errorText}`
    );
  }

  const result = (await response.json()) as CampaignsResponse;
  return result.data;
}

const INSIGHTS_FIELDS =
  "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,date_start,date_stop,campaign_id,campaign_name";

function formatLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Splits a date range into chunks of `chunkDays` (max 30 by default).
 * Meta's Insights endpoint silently truncates daily breakdowns over long
 * ranges, so we issue one request per chunk and merge the results.
 */
function chunkDateRange(
  since: string,
  until: string,
  chunkDays: number = 30
): Array<{ since: string; until: string }> {
  const chunks: Array<{ since: string; until: string }> = [];
  const startDate = new Date(since);
  const endDate = new Date(until);

  let currentStart = new Date(startDate);

  while (currentStart <= endDate) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentStart.getDate() + chunkDays - 1);

    const effectiveEnd = currentEnd > endDate ? endDate : currentEnd;

    chunks.push({
      since: formatLocalISO(currentStart),
      until: formatLocalISO(effectiveEnd),
    });

    currentStart = new Date(effectiveEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }

  return chunks;
}

/**
 * Resolve a DateRangeInput to an explicit since/until pair.
 * Returns null for 'lifetime' (caller should use date_preset=maximum instead).
 *
 * Delegates non-lifetime preset → since/until conversion to presetToCustomRange
 * (single source of truth in @/lib/ads/types).
 */
function resolveRangeToDates(
  range: DateRangeInput
): { since: string; until: string } | null {
  if (isCustomRange(range)) {
    return { since: range.since, until: range.until };
  }
  if (range === "lifetime") return null;

  const customRange = presetToCustomRange(range);
  return { since: customRange.since, until: customRange.until };
}

/**
 * Internal fetcher used by both getAccountInsights and getCampaignInsights.
 * Handles range resolution, lifetime fast-path, and chunked daily breakdown.
 */
async function fetchInsightsChunked(
  accessToken: string,
  accountId: string,
  range: DateRangeInput,
  timeIncrement: TimeIncrement | undefined,
  level: "account" | "campaign"
): Promise<MetaInsight[]> {
  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights`;

  // Lifetime: don't chunk — let Meta return its `maximum` aggregate.
  if (!isCustomRange(range) && range === "lifetime") {
    const params = new URLSearchParams({
      fields: INSIGHTS_FIELDS,
      access_token: accessToken,
      date_preset: "maximum",
      limit: "500",
    });
    if (level === "campaign") params.set("level", "campaign");
    if (timeIncrement) params.set("time_increment", String(timeIncrement));

    const response = await fetch(`${baseUrl}?${params.toString()}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch insights (lifetime): ${response.status} ${errorText}`
      );
    }
    const result = (await response.json()) as InsightsResponse;
    return result.data ?? [];
  }

  const dates = resolveRangeToDates(range);
  if (!dates) {
    // Should be unreachable (lifetime handled above), but be safe.
    return [];
  }

  // Daily breakdown → chunk; aggregate → single request for the whole range.
  const chunks =
    timeIncrement === 1
      ? chunkDateRange(dates.since, dates.until, 30)
      : [{ since: dates.since, until: dates.until }];

  const fetchPromises = chunks.map(async (chunk) => {
    const params = new URLSearchParams({
      fields: INSIGHTS_FIELDS,
      access_token: accessToken,
      time_range: JSON.stringify({
        since: chunk.since,
        until: chunk.until,
      }),
      limit: "500",
    });
    if (level === "campaign") params.set("level", "campaign");
    if (timeIncrement) params.set("time_increment", String(timeIncrement));

    const response = await fetch(`${baseUrl}?${params.toString()}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch insights chunk ${chunk.since}-${chunk.until}: ${response.status} ${errorText}`
      );
    }
    const result = (await response.json()) as InsightsResponse;
    return Array.isArray(result.data) ? result.data : [];
  });

  const results = await Promise.all(fetchPromises);
  const allInsights = results.flat();
  allInsights.sort((a, b) =>
    (a.date_start || "").localeCompare(b.date_start || "")
  );

  return allInsights;
}

export async function getAccountInsights(
  accessToken: string,
  accountId: string,
  range: DateRangeInput = "30d",
  timeIncrement?: TimeIncrement
): Promise<MetaInsight[]> {
  return fetchInsightsChunked(
    accessToken,
    accountId,
    range,
    timeIncrement,
    "account"
  );
}

export async function getCampaignInsights(
  accessToken: string,
  accountId: string,
  range: DateRangeInput = "30d",
  timeIncrement?: TimeIncrement
): Promise<MetaInsight[]> {
  return fetchInsightsChunked(
    accessToken,
    accountId,
    range,
    timeIncrement,
    "campaign"
  );
}

/**
 * Build the `fields` parameter for /ads. The insights subfield carries an
 * inline `.time_range(...)` modifier when a date window is provided — Meta
 * then omits the `insights` field entirely for ads with zero activity in
 * that window, which lets us drop them post-fetch.
 *
 * For lifetime (dates === null) we fall back to plain `insights{...}` which
 * Meta resolves against the account's full lifetime.
 */
function buildAdFields(
  dates: { since: string; until: string } | null
): string {
  // Lifetime: Meta defaults nested `insights{...}` to last-30-days, not
  // lifetime — use `.date_preset(maximum)` to force the full account window.
  const insightsField = dates
    ? `insights.time_range({"since":"${dates.since}","until":"${dates.until}"}){spend,impressions,clicks,ctr,cpc,actions,action_values,reach}`
    : `insights.date_preset(maximum){spend,impressions,clicks,ctr,cpc,actions,action_values,reach}`;

  return [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign_id",
    "adset_id",
    "preview_shareable_link",
    "creative{id,name,image_url,thumbnail_url,video_id,object_type,body,title,call_to_action_type,product_set_id," +
      "object_story_spec{link_data{child_attachments{image_url,video_id,name,link,description},picture,image_hash,message,name,description}," +
      "video_data{image_url,video_id,title,message}}," +
      "asset_feed_spec{images{url,hash},videos{video_id,thumbnail_url},bodies{text},titles{text},descriptions{text}}}",
    insightsField,
  ].join(",");
}

// Without explicit filtering, Meta's /ads endpoint silently excludes archived
// statuses, capping results to ACTIVE+PAUSED only. Force all statuses by
// including every effective_status value the platform can return.
const ALL_AD_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "DELETED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "CAMPAIGN_PAUSED",
  "ARCHIVED",
  "ADSET_PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
];

interface AdsResponse {
  data: MetaAd[];
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
  };
}

/**
 * Fetch ads with creative info + nested insights for the period.
 * No time_increment → one aggregate insight row per ad.
 * Follows paging.next to fetch all pages (up to MAX_PAGES safety cap).
 */
export async function getAds(
  accessToken: string,
  accountId: string,
  range: DateRangeInput = "30d"
): Promise<MetaAd[]> {
  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/ads`;
  const dates = resolveRangeToDates(range);

  // Date filtering happens via the `.time_range(...)` modifier on the insights
  // subfield (see buildAdFields). No top-level time_range/date_preset needed —
  // ads with zero activity in the window simply lack an `insights` field, and
  // are dropped by MetaAdapter.getAds.
  const params = new URLSearchParams({
    fields: buildAdFields(dates),
    access_token: accessToken,
    limit: "100",
    filtering: JSON.stringify([
      {
        field: "ad.effective_status",
        operator: "IN",
        value: ALL_AD_STATUSES,
      },
    ]),
  });

  const allAds: MetaAd[] = [];
  let nextUrl: string | null = `${baseUrl}?${params.toString()}`;
  let pageCount = 0;
  const MAX_PAGES = 20;

  while (nextUrl && pageCount < MAX_PAGES) {
    const response: Response = await fetch(nextUrl);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch ads: ${response.status} ${errorText}`
      );
    }
    const result = (await response.json()) as AdsResponse;
    if (Array.isArray(result.data)) {
      allAds.push(...result.data);
    }
    nextUrl = result.paging?.next ?? null;
    pageCount++;
  }

  return allAds;
}

/**
 * Fetch the video source URL for playback + a permalink to the video on
 * Facebook (used as a fallback when source is not available).
 * Meta returns expiring CDN links so we don't cache, resolve on-demand instead.
 */
export async function getVideoSource(
  accessToken: string,
  videoId: string
): Promise<{ source: string | null; permalinkUrl: string | null }> {
  try {
    const url = `https://graph.facebook.com/${META_API_VERSION}/${videoId}`;
    const params = new URLSearchParams({
      fields: "source,permalink_url",
      access_token: accessToken,
    });

    const response = await fetch(`${url}?${params.toString()}`);
    if (!response.ok) {
      console.warn(`[getVideoSource] Failed: ${response.status}`);
      return { source: null, permalinkUrl: null };
    }

    const result = (await response.json()) as {
      source?: string;
      permalink_url?: string;
    };
    return {
      source: result.source ?? null,
      permalinkUrl: result.permalink_url ?? null,
    };
  } catch (error) {
    console.warn("[getVideoSource] Error:", error);
    return { source: null, permalinkUrl: null };
  }
}

/**
 * Fetch top products of a catalog product set. Used to enrich catalog ads
 * with preview thumbnails. Returns empty array on failure (e.g. missing perms).
 */
export async function getCatalogTopProducts(
  accessToken: string,
  productSetId: string,
  limit: number = 4
): Promise<MetaCatalogProduct[]> {
  try {
    const productsUrl = `https://graph.facebook.com/${META_API_VERSION}/${productSetId}/products`;
    const productsParams = new URLSearchParams({
      fields: "id,name,image_url,retailer_id",
      access_token: accessToken,
      limit: String(limit),
    });

    const response = await fetch(`${productsUrl}?${productsParams.toString()}`);
    if (!response.ok) {
      console.warn(
        `[getCatalogTopProducts] Failed for product_set ${productSetId}: ${response.status}`
      );
      return [];
    }

    const result = (await response.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        image_url?: string;
        retailer_id?: string;
      }>;
    };

    if (!Array.isArray(result.data)) return [];
    return result.data.slice(0, limit).map((p) => ({
      id: p.id,
      name: p.name,
      image_url: p.image_url,
      retailer_id: p.retailer_id,
    }));
  } catch (error) {
    console.warn("[getCatalogTopProducts] Error:", error);
    return [];
  }
}

/**
 * Extract carousel image URLs from creative. Tries object_story_spec first
 * (legacy ads), then asset_feed_spec (Advantage+ ads).
 */
function extractCarouselImages(
  creative: MetaAdCreative | undefined
): string[] {
  if (!creative) return [];

  const images: string[] = [];

  // Path 1: legacy ads (object_story_spec.link_data.child_attachments)
  const childAttachments =
    creative.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(childAttachments)) {
    for (const card of childAttachments) {
      if (card.image_url && !images.includes(card.image_url)) {
        images.push(card.image_url);
      }
    }
  }

  // Path 2: Advantage+ ads (asset_feed_spec.images) — merge unique only
  if (Array.isArray(creative.asset_feed_spec?.images)) {
    for (const img of creative.asset_feed_spec!.images!) {
      if (img.url && !images.includes(img.url)) {
        images.push(img.url);
      }
    }
  }

  return images;
}

/**
 * Resolve a batch of image hashes to URLs via /act_{accountId}/adimages.
 * Meta caps `hashes` per request; we chunk by 50 to stay safe. Hashes that
 * fail to resolve are simply absent from the returned Map — callers should
 * treat that as a soft fallback.
 */
export async function resolveImageHashesToUrls(
  accessToken: string,
  accountId: string,
  hashes: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (hashes.length === 0) return out;

  const CHUNK_SIZE = 50;
  for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
    const chunk = hashes.slice(i, i + CHUNK_SIZE);
    try {
      const url =
        `https://graph.facebook.com/${META_API_VERSION}/${accountId}/adimages?` +
        `hashes=${encodeURIComponent(JSON.stringify(chunk))}` +
        `&fields=hash,url,permalink_url` +
        `&access_token=${encodeURIComponent(accessToken)}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(
          `[adimages] Hash batch failed: ${response.status}`,
          await response.text()
        );
        continue;
      }
      const data = (await response.json()) as {
        data?: Array<{ hash?: string; url?: string }>;
      };
      for (const img of data.data ?? []) {
        if (img.hash && img.url) out.set(img.hash, img.url);
      }
    } catch (err) {
      console.warn("[adimages] Failed to fetch hash batch:", err);
    }
  }
  return out;
}

/**
 * Convert a raw MetaAd to the unified shape used across the app.
 * Reuses metric extractors from ./metrics for action_type handling consistency.
 */
export function metaAdToUnified(ad: MetaAd): UnifiedAd {
  const insight = ad.insights?.data?.[0];

  const spend = insight ? parseFloat(insight.spend || "0") : 0;
  const revenue = insight ? getRevenue(insight) : 0;
  const purchases = insight ? getPurchaseCount(insight) : 0;
  const impressions = insight ? parseInt(insight.impressions || "0") : 0;
  const clicks = insight ? parseInt(insight.clicks || "0") : 0;
  const ctr = insight ? parseFloat(insight.ctr || "0") : 0;
  const cpc = insight ? parseFloat(insight.cpc || "0") : 0;

  // Detect creative type. Order matters:
  //   1. catalog: ONLY when product_set_id is set (SHARE alone is too broad)
  //   2. carousel: ≥2 carousel images via extractCarouselImages (legacy + asset_feed_spec)
  //   3. carousel fallback: raw asset_feed_spec.images ≥2 (when extract returned <2)
  //   4. video / image / unknown
  // Note: carousel beats video even when both exist — show all available creatives.
  let carouselImages = extractCarouselImages(ad.creative);

  // Video detection across multiple paths (legacy creative + Advantage+ specs)
  const extractedVideoId =
    ad.creative?.video_id ||
    ad.creative?.object_story_spec?.video_data?.video_id ||
    ad.creative?.asset_feed_spec?.videos?.[0]?.video_id;

  // Sub-type within META_AD (replaces the old top-level `creativeType` —
  // now scoped inside META_AD's type_data per ADR-013 / Memory #27 single-
  // discriminator principle).
  let subType: "image" | "video" | "carousel" | "catalog" | "unknown" =
    "unknown";
  let pendingImageHashes: string[] | undefined;
  if (ad.creative?.product_set_id) {
    subType = "catalog";
  } else if (carouselImages.length > 1) {
    subType = "carousel";
  } else if ((ad.creative?.asset_feed_spec?.images?.length ?? 0) >= 2) {
    // Fallback: extractCarouselImages didn't return ≥2 (e.g. items missing
    // some field), but asset_feed_spec.images itself has ≥2 entries.
    // Meta returns these as {hash} only (no url), and frequently duplicates
    // the same hash 5–10 times for non-Flexible ads — dedupe before deciding.
    const rawImages = ad.creative!.asset_feed_spec!.images ?? [];

    const uniqueHashes = Array.from(
      new Set(
        rawImages
          .map((img) => img.hash)
          .filter((h): h is string => !!h)
      )
    );

    if (uniqueHashes.length >= 2) {
      // Real Flexible Ad. Hashes will be resolved to URLs in a batch call
      // after the per-ad mapping completes (see MetaAdapter.getAds).
      pendingImageHashes = uniqueHashes;
      subType = "carousel";
    } else {
      // Single image duplicated by Meta — treat as a regular image ad.
      subType = "image";
    }
  } else if (extractedVideoId) {
    subType = "video";
  } else if (ad.creative?.image_url) {
    subType = "image";
  }

  // Normalize status: ACTIVE / DELETED kept as-is; everything else
  // (PAUSED, ARCHIVED, CAMPAIGN_PAUSED, ADSET_PAUSED, IN_PROCESS, WITH_ISSUES,
  //  PENDING_REVIEW, DISAPPROVED, …) collapses to PAUSED.
  const rawStatus = ad.effective_status || ad.status;
  let status: UnifiedAd["status"];
  if (rawStatus === "ACTIVE") {
    status = "ACTIVE";
  } else if (rawStatus === "DELETED") {
    status = "DELETED";
  } else {
    status = "PAUSED";
  }

  return {
    ad_type: "META_AD",
    id: ad.id,
    name: ad.name,
    status,
    campaignId: ad.campaign_id,
    adsetId: ad.adset_id,
    spend,
    revenue,
    roas: spend > 0 ? revenue / spend : 0,
    purchases,
    impressions,
    clicks,
    ctr,
    cpc,
    provider: "meta",
    type_data: {
      subType,
      creativeId: ad.creative?.id,
      imageUrl: ad.creative?.image_url,
      thumbnailUrl: ad.creative?.thumbnail_url,
      videoId: extractedVideoId,
      title: ad.creative?.title,
      body: ad.creative?.body,
      callToAction: ad.creative?.call_to_action_type,
      productSetId: ad.creative?.product_set_id,
      carouselImages: carouselImages.length > 0 ? carouselImages : undefined,
      carouselImageHashes: pendingImageHashes,
      previewLink: ad.preview_shareable_link,
    },
  };
}
