import { GoogleAdsApi } from "google-ads-api";
import { classifyGoogleAdsError } from "@/lib/google-ads/errors";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

// google-ads-api@23 returns enum fields as integer protobuf values.
// Ref: AdTypeEnum.AdType in the Google Ads API protos.
const AD_TYPE_MAP: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "TEXT_AD",
  3: "EXPANDED_TEXT_AD",
  6: "EXPANDED_DYNAMIC_SEARCH_AD",
  7: "HOTEL_AD",
  8: "SHOPPING_SMART_AD",
  9: "SHOPPING_PRODUCT_AD",
  10: "VIDEO_AD",
  12: "GMAIL_AD",
  13: "IMAGE_AD",
  14: "RESPONSIVE_SEARCH_AD",
  15: "LEGACY_RESPONSIVE_DISPLAY_AD",
  16: "APP_AD",
  17: "LEGACY_APP_INSTALL_AD",
  18: "RESPONSIVE_DISPLAY_AD",
  19: "LOCAL_AD",
  20: "HTML5_UPLOAD_AD",
  21: "DYNAMIC_HTML5_AD",
  22: "APP_ENGAGEMENT_AD",
  23: "SHOPPING_COMPARISON_LISTING_AD",
  24: "VIDEO_BUMPER_AD",
  25: "VIDEO_NON_SKIPPABLE_IN_STREAM_AD",
  26: "VIDEO_OUTSTREAM_AD",
  27: "VIDEO_TRUEVIEW_IN_STREAM_AD",
  29: "VIDEO_RESPONSIVE_AD",
  30: "SMART_CAMPAIGN_AD",
  31: "CALL_AD",
  32: "APP_PRE_REGISTRATION_AD",
  33: "IN_FEED_VIDEO_AD",
  34: "DEMAND_GEN_MULTI_ASSET_AD",
  35: "DEMAND_GEN_CAROUSEL_AD",
  36: "TRAVEL_AD",
  39: "DEMAND_GEN_VIDEO_RESPONSIVE_AD",
  40: "DEMAND_GEN_PRODUCT_AD",
};

const AD_STATUS_MAP: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "ENABLED",
  3: "PAUSED",
  4: "REMOVED",
};

// CampaignStatus and AdGroupStatus share the same {0..4} integer encoding
// as AdGroupAdStatus today, but Google defines them as distinct enums
// (CampaignStatusEnum, AdGroupStatusEnum, AdGroupAdStatusEnum). Separate
// maps keep us safe if Google ever diverges them in a future version —
// 9th instance of the documented integer-drift pattern. Used by
// computeEffectiveAdStatus in providers/google.ts to derive the
// effective ad serving status from the (campaign, ad_group, ad)
// status rollup. See feedback_google_ads_sdk_field_index.md.
const CAMPAIGN_STATUS_MAP: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "ENABLED",
  3: "PAUSED",
  4: "REMOVED",
};

const AD_GROUP_STATUS_MAP: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "ENABLED",
  3: "PAUSED",
  4: "REMOVED",
};

function mapAdType(value: unknown): string {
  const num = Number(value);
  return AD_TYPE_MAP[num] ?? `UNKNOWN_${num}`;
}

function mapAdStatus(value: unknown): string {
  const num = Number(value);
  return AD_STATUS_MAP[num] ?? "UNKNOWN";
}

function mapCampaignStatus(rawStatus: unknown): string {
  if (typeof rawStatus === "number") {
    return CAMPAIGN_STATUS_MAP[rawStatus] ?? "UNKNOWN";
  }
  if (typeof rawStatus === "string") return rawStatus;
  return "UNKNOWN";
}

function mapAdGroupStatus(rawStatus: unknown): string {
  if (typeof rawStatus === "number") {
    return AD_GROUP_STATUS_MAP[rawStatus] ?? "UNKNOWN";
  }
  if (typeof rawStatus === "string") return rawStatus;
  return "UNKNOWN";
}

export interface AdRow {
  id: string;
  type: string;
  status: string;
  /**
   * Parent ad_group's status as ENABLED / PAUSED / REMOVED / UNKNOWN
   * (mapped from the integer enum). Used by computeEffectiveAdStatus
   * in providers/google.ts to roll up the effective serving status.
   */
  ad_group_status: string;
  ad_group_id: string;
  ad_group_name: string;
  /**
   * Parent campaign's status — same enum shape as ad_group_status.
   * Surfaced for the effective-status rollup; a PAUSED campaign blocks
   * all child ad_groups + ads from serving regardless of their own
   * status fields.
   */
  campaign_status: string;
  campaign_id: string;
  campaign_name: string;
  final_url: string | null;
  /**
   * RSA/RDA headlines. Empty arrays are coerced to undefined so consumers
   * can use truthy checks. Phase 4.8 M5 Commit 1.
   */
  headlines?: string[];
  /**
   * RSA/RDA descriptions. Same shape as headlines.
   */
  descriptions?: string[];
  /**
   * Asset resource names collected from RDA marketing_images.
   * Resolved to URLs in the adapter via fetchAssetUrls (assets.ts).
   * Phase 4.8 M5 Commit 2.
   */
  imageAssetResourceNames?: string[];
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  cpc: number;
  roas: number;
}

export interface AdTotals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  cpc: number;
  roas: number;
}

export interface FetchAdsResult {
  ads: AdRow[];
  totals: AdTotals;
}

export interface FetchAdsOptions {
  customerId: string;
  refreshToken: string;
  dateFrom: string; // YYYY-MM-DD — caller MUST validate format
  dateTo: string; // YYYY-MM-DD — caller MUST validate format
  /** Pass MCC ID for accounts linked to our manager. Omit for standalone. */
  loginCustomerId?: string;
}

/**
 * Fetch ad-level performance for a Google Ads account.
 *
 * Schema is intentionally minimal — metrics + identifiers + final URL only.
 * Creative details (headlines, descriptions, images, video assets) are NOT
 * included here; those vary wildly across ad types and warrant a separate
 * fetcher if/when we need to display them.
 *
 * Caller MUST validate dateFrom/dateTo as YYYY-MM-DD before invoking — the
 * values are interpolated into GAQL and not escaped.
 *
 * Returns null on auth/permission errors so the caller can treat the
 * account as "not accessible right now" rather than failing the batch.
 */
export async function fetchAds(
  options: FetchAdsOptions
): Promise<FetchAdsResult | null> {
  const clientId = requireEnv("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_ADS_CLIENT_SECRET");
  const developerToken = requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN");

  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const customer = api.Customer({
    customer_id: options.customerId,
    refresh_token: options.refreshToken,
    ...(options.loginCustomerId
      ? { login_customer_id: options.loginCustomerId }
      : {}),
  });

  // GAQL: no OR / parentheses in WHERE, so the only status filter we can
  // express is a flat `!= REMOVED`. LIMIT 500 is the MVP ceiling; we'll
  // page later if accounts exceed it.
  const query = `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_display_ad.headlines,
      ad_group_ad.ad.responsive_display_ad.descriptions,
      ad_group_ad.ad.responsive_display_ad.marketing_images,
      ad_group_ad.status,
      ad_group.id,
      ad_group.name,
      ad_group.status,
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${options.dateFrom}' AND '${options.dateTo}'
      AND ad_group_ad.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 500
  `;

  try {
    const rows = await customer.query(query);

    const ads: AdRow[] = rows.map((row) => {
      const spend = Number(row.metrics?.cost_micros ?? 0) / 1_000_000;
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const conversions = Number(row.metrics?.conversions ?? 0);
      const revenue = Number(row.metrics?.conversions_value ?? 0);
      const ctr = Number(row.metrics?.ctr ?? 0);
      const cpc = Number(row.metrics?.average_cpc ?? 0) / 1_000_000;
      const roas = spend > 0 ? revenue / spend : 0;

      // final_urls is an array; pick the first non-empty value.
      const ad = row.ad_group_ad?.ad;
      const finalUrls = Array.isArray(ad?.final_urls) ? ad.final_urls : [];
      const finalUrl =
        finalUrls.find(
          (u): u is string => typeof u === "string" && u.length > 0
        ) ?? null;

      // RSA/RDA text content. The Google Ads SDK returns these as arrays of
      // { text, pinned_field? } — we want just the strings, dropping empties.
      // RSA fields populated for RESPONSIVE_SEARCH_AD; RDA for RESPONSIVE_
      // DISPLAY_AD. Only one of the two will be populated per row; we union
      // them with RSA taking precedence (no overlap expected anyway).
      const extractTexts = (
        assets: unknown
      ): string[] | undefined => {
        if (!Array.isArray(assets)) return undefined;
        const out: string[] = [];
        for (const a of assets) {
          if (a && typeof a === "object" && "text" in a) {
            const t = (a as { text?: unknown }).text;
            if (typeof t === "string" && t.length > 0) out.push(t);
          }
        }
        return out.length > 0 ? out : undefined;
      };

      const rsaHeadlines = extractTexts(ad?.responsive_search_ad?.headlines);
      const rdaHeadlines = extractTexts(ad?.responsive_display_ad?.headlines);
      const headlines = rsaHeadlines ?? rdaHeadlines;

      const rsaDescriptions = extractTexts(
        ad?.responsive_search_ad?.descriptions
      );
      const rdaDescriptions = extractTexts(
        ad?.responsive_display_ad?.descriptions
      );
      const descriptions = rsaDescriptions ?? rdaDescriptions;

      // Asset resource names: RDA's marketing_images array (each entry:
      // { asset: "customers/X/assets/Y" }). Resolved to URLs in the adapter
      // via fetchAssetUrls (single batched query).
      //
      // Note: ad_group_ad.ad.image_ad.image_asset was tried but rejected by
      // Google Ads API (query_error 23, INVALID_FIELD_IN_SELECT_CLAUSE) —
      // the field exists in older API versions but is not accepted via this
      // path in the current SDK. IMAGE_AD coverage deferred; rare in practice
      // (mostly replaced by RDA in modern accounts).
      const collectedAssets: string[] = [];
      const rdaMarketingImages: unknown =
        ad?.responsive_display_ad?.marketing_images;
      if (Array.isArray(rdaMarketingImages)) {
        for (const m of rdaMarketingImages) {
          const assetRef =
            m && typeof m === "object" && "asset" in m
              ? (m as { asset?: unknown }).asset
              : undefined;
          if (typeof assetRef === "string" && assetRef.length > 0) {
            collectedAssets.push(assetRef);
          }
        }
      }
      const imageAssetResourceNames =
        collectedAssets.length > 0 ? collectedAssets : undefined;

      return {
        id: String(ad?.id ?? ""),
        type: mapAdType(ad?.type),
        status: mapAdStatus(row.ad_group_ad?.status),
        ad_group_status: mapAdGroupStatus(row.ad_group?.status),
        ad_group_id: String(row.ad_group?.id ?? ""),
        ad_group_name: String(row.ad_group?.name ?? ""),
        campaign_status: mapCampaignStatus(row.campaign?.status),
        campaign_id: String(row.campaign?.id ?? ""),
        campaign_name: String(row.campaign?.name ?? ""),
        final_url: finalUrl,
        headlines,
        descriptions,
        imageAssetResourceNames,
        spend,
        impressions,
        clicks,
        conversions,
        revenue,
        ctr,
        cpc,
        roas,
      };
    });

    // Aggregate raw counters; ratios filled in below.
    const totals: AdTotals = ads.reduce(
      (acc, a) => ({
        spend: acc.spend + a.spend,
        impressions: acc.impressions + a.impressions,
        clicks: acc.clicks + a.clicks,
        conversions: acc.conversions + a.conversions,
        revenue: acc.revenue + a.revenue,
        ctr: 0,
        cpc: 0,
        roas: 0,
      }),
      {
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        ctr: 0,
        cpc: 0,
        roas: 0,
      }
    );

    totals.ctr =
      totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
    totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

    return { ads, totals };
  } catch (error) {
    // ADR-017: bubble reauth-class errors (invalid_grant /
    // consent_revoked / token_expired) so the existing withReauthMapping
    // wrapper in GoogleAdsAdapter.getAds catches → ReauthRequiredError →
    // the /api/ads/creatives route reauth-CTA path (route.ts:283-296)
    // fires the Arabic "انتهت صلاحية ربط حساب Google" banner.
    //
    // Non-reauth errors (sub-resource permission, GAQL field rejections,
    // transient 5xx, network) keep the graceful null-degradation per
    // the original contract — caller treats the account as "not
    // accessible right now" rather than failing the whole batch.
    //
    // This swallow was the root cause of the OBS 3 Google range-
    // regression (2026-06-01): an expired Google refresh token caused
    // 30d custom-range fetches to return data:[] silently while
    // lifetime served stale cache — user saw no reauth banner, just
    // misleading "no ads in this period" copy. Diagnosed via the
    // 9b6b946 TEMP DIAGNOSTIC console.logs which surfaced the
    // [google-ads/ads] fetch failed: invalid_grant line.
    const reauth = classifyGoogleAdsError(error);
    if (reauth) throw reauth;

    // Brief production-safe log — the silent return null was masking M5
    // GAQL field rejections during the regression investigation. Surface
    // just enough to debug from production logs without leaking tokens.
    console.error(
      "[google-ads/ads] fetch failed:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}
