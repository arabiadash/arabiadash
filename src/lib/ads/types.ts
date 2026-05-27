import type { AdProvider } from "./cache";

// =================================================================
// Unified Campaign (works for any ad platform)
// =================================================================
export interface UnifiedCampaign {
  id: string;
  provider: AdProvider;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  objective: string;

  // Budget (optional - some platforms don't expose it)
  dailyBudget?: number;
  lifetimeBudget?: number;

  // Dates
  startTime?: string;
  stopTime?: string;
  createdTime: string;
  updatedTime: string;
}

// =================================================================
// Unified Insight (works for any ad platform)
// =================================================================
export interface UnifiedInsight {
  // Identifiers
  campaignId?: string;
  campaignName?: string;
  provider: AdProvider;

  /**
   * Source ad account ID. Stamped by multi-account hooks
   * (`useProviderInsights`) when concatenating responses so per-account
   * groupings (e.g. accounts-breakdown tables) survive the merge. Single-
   * account hooks (`useInsights`) leave it undefined. Backward-compatible
   * with cached rows from before this field was introduced.
   */
  accountId?: string;

  /**
   * Source currency from the originating ad account. Set by the adapter
   * from accountInfo.currency. NO fallback — raw value (USD, SAR, AED,
   * EGP, etc.). Callers handle conversion/display.
   *
   * Optional for backward compatibility: rows cached before this field
   * was introduced lack it. Consumers fall back to "USD" when missing.
   */
  currency?: string;

  // Performance metrics (all numbers, not strings)
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;

  // Calculated rates
  ctr: number; // %
  cpc: number;
  cpm: number;

  // Conversion metrics
  /**
   * Counts of real e-commerce purchases. NULL when the platform cannot
   * yet determine this (e.g. Google account whose conversion_action
   * cache has not yet been populated by sync-accounts). See ADR-011
   * and the hasConversionData flag below.
   */
  purchases: number | null;
  /**
   * Total purchase revenue. NULL under the same conditions as purchases.
   * Filtered to purchase-action conversions on Google (#15 fix); Meta
   * uses omni_purchase action_value natively.
   */
  revenue: number | null;
  /**
   * Return on ad spend. NULL when revenue is NULL OR when spend is 0
   * (to avoid divide-by-zero). Computed as revenue / spend.
   */
  roas: number | null;

  // Funnel metrics (for advanced analysis)
  addToCart: number;
  initiateCheckout: number;
  leads: number;

  // Cost per
  /**
   * Cost per purchase. NULL when purchases is NULL OR when purchases
   * is 0 (to avoid divide-by-zero). Computed as spend / purchases.
   */
  costPerPurchase: number | null;
  costPerLead: number;

  // ===============================
  // Conversion data availability
  // ===============================
  /**
   * Whether the platform has populated conversion tracking data for
   * this row. FALSE means purchases/revenue/roas/costPerPurchase will
   * be NULL — the platform recognized the account but cannot yet
   * resolve which conversion actions count as purchases. TRUE means
   * the values are authoritative (may still be 0 for legitimate zero
   * activity).
   *
   * Meta always sets TRUE (omni_purchase is platform-native).
   * Google sets TRUE once google_conversion_actions sync has populated
   * the user's purchase action IDs (see ADR-011).
   *
   * Consumers MUST treat undefined as false (defensive — old cache
   * rows pre-Commit 4+5 lack this field; the 15-min fresh-TTL handles
   * rollover within a deploy window).
   */
  hasConversionData: boolean;

  /**
   * Campaign status — populated ONLY when this insight is at level=campaign.
   * Undefined for account-level insights and day-level insights.
   * Phase 4.8 M4 Commit 2 — enables status filtering on per-campaign tables.
   */
  status?: UnifiedCampaign["status"];

  // Date range
  dateStart: string;
  dateStop: string;
}

// =================================================================
// Keywords (Google Search-only). Per ADR-015 (M7).
// =================================================================
/**
 * Keyword match type. Enum verified clean via M7 recon Q1 2026-05-26 —
 * standard 2/3/4 = EXACT/PHRASE/BROAD pattern, no integer drift.
 */
export type KeywordMatchType = "EXACT" | "PHRASE" | "BROAD";

/**
 * Status filter for the keywords fetch. Triggers different GAQL WHERE
 * clauses (strict ENABLED vs include PAUSED). REMOVED always excluded.
 */
export type KeywordStatusFilter = "enabled" | "all";

/**
 * Quality info enum label (3 of the 4 quality_info subfields use it).
 * Most low-traffic keywords return undefined — render as "—" in UI.
 */
export type KeywordQualityLabel =
  | "BELOW_AVERAGE"
  | "AVERAGE"
  | "ABOVE_AVERAGE";

/**
 * One keyword row per ADR-015 §Decision 1 (M7 scope: list + filter + sort
 * + match-type breakdown; conversion metrics deferred to M7.5).
 */
export interface UnifiedAdKeyword {
  /** ad_group_criterion.criterion_id (stringified for consistency with other IDs). */
  id: string;
  /** ad_group_criterion.keyword.text — the actual search term. */
  text: string;
  matchType: KeywordMatchType;
  status: "ENABLED" | "PAUSED" | "REMOVED";

  // Performance metrics for the active date range (from FROM keyword_view)
  spend: number;
  impressions: number;
  clicks: number;
  /** CTR as percentage (0-100), already normalized from Google's 0-1 ratio. */
  ctr: number;
  /** Average CPC in account currency (cost_micros / 1M / clicks aggregated by Google). */
  cpc: number;

  // Conversion attribution (M7.5 / ADR-016) — populated via the
  // ADR-011-family fetchPurchaseKeywordTotals two-query merge.
  //
  // null = hasConversionData is false (cache miss / no purchase actions
  //   configured / API failure) — UI renders "—" with tooltip
  // number = real value (may be 0 — legitimate "tracking configured,
  //   zero purchases attributed to this keyword") — UI renders "0 ر.س" / "0"
  purchases?: number | null;
  revenue?: number | null;
  /** revenue / spend when both defined and spend > 0. Null otherwise. */
  roas?: number | null;
  /**
   * Mirrors UnifiedAdCommon.hasConversionData semantic. False when the
   * purchaseActionIds cache is missing / empty / API failed, so the
   * "0 vs —" distinction in the UI matches the M-PMax convention.
   */
  hasConversionData?: boolean;

  // Quality info — undefined when Google lacks enough data to compute.
  // UI must render "—" not "0" for these.
  qualityScore?: number; // 1-10 integer
  creativeQualityScore?: KeywordQualityLabel;
  postClickQualityScore?: KeywordQualityLabel;
  searchPredictedCtr?: KeywordQualityLabel;
}

// =================================================================
// Search Terms (Google Search-only). Per ADR-018 (M9).
// =================================================================
/**
 * Status of an actual user search query relative to the account's
 * configured keyword list. Standard SearchTermStatusEnum mapping per
 * recon Q1 2026-05-28 — no integer drift.
 *
 * - ADDED: term exactly matches an enabled positive keyword
 * - NONE:  term triggered via broad/phrase expansion of a different
 *          keyword — the "goldmine" for keyword optimization
 * - EXCLUDED: term matched a negative keyword (didn't serve)
 * - ADDED_EXCLUDED: rare edge state (both positive AND negative match)
 * - UNKNOWN: enum 0/1 — defensive fallback for future SDK additions
 */
export type SearchTermStatus =
  | "ADDED"
  | "NONE"
  | "EXCLUDED"
  | "ADDED_EXCLUDED"
  | "UNKNOWN";

/**
 * One actual user search query that triggered an ad in the date range.
 * Per ADR-018 §Decision 1 — Path B (8th sibling of the ADR-011 merger
 * family). Conversion attribution via fetchPurchaseSearchTermTotals
 * with composite-key Map (${adGroupId}${searchTerm}) per
 * recon Q4 (9% cross-ad_group collision rate on imaa).
 */
export interface UnifiedAdSearchTerm {
  /** The actual user-typed query string. */
  text: string;
  /** Effective status relative to account's keyword configuration. */
  status: SearchTermStatus;
  /** Match type of the triggering keyword (the keyword the user's query expanded into). */
  matchType: KeywordMatchType;
  /** The triggering keyword text, when known (Google may not always populate). */
  triggeredByKeywordText?: string;

  // Performance metrics for the active date range (from search_term_view)
  spend: number;
  impressions: number;
  clicks: number;
  /** CTR as percentage (0-100), normalized from Google's 0-1 ratio. */
  ctr: number;
  /** Average CPC in account currency. */
  cpc: number;

  // Conversion attribution (ADR-018 §Decision 1) — populated via the
  // ADR-011-family fetchPurchaseSearchTermTotals two-query merge.
  // Same null/number semantics as UnifiedAdKeyword purchases/revenue.
  purchases?: number | null;
  revenue?: number | null;
  /** revenue / spend when both defined and spend > 0. */
  roas?: number | null;
  /** Mirrors UnifiedAdCommon.hasConversionData. */
  hasConversionData?: boolean;
}

// =================================================================
// Asset Extensions (Google-only). Per ADR-012 + ADR-014 (images).
// =================================================================
/**
 * Image asset field_type discriminator (M8 / ADR-014 §Decision 1).
 *
 * Six explicit string literals cover the on-the-wire universe verified
 * via Q9/Q10 recon (AD_IMAGE + BUSINESS_LOGO observed on imaa;
 * LANDSCAPE_LOGO + MARKETING_IMAGE family added for forward-compat).
 *
 * The `(string & {})` catch-all preserves IDE autocomplete on the
 * known literals while still accepting unknown labels at runtime —
 * required because the resource_name suffix walk per ADR-014 §Decision 7
 * may return labels Google adds in future API versions before we update
 * this union. Defensive per integer-drift discipline.
 */
export type ImageAssetFieldType =
  | "AD_IMAGE"
  | "BUSINESS_LOGO"
  | "LANDSCAPE_LOGO"
  | "MARKETING_IMAGE"
  | "SQUARE_MARKETING_IMAGE"
  | "PORTRAIT_MARKETING_IMAGE"
  | (string & {});

/**
 * Asset Extensions surfaced on Google ads.
 * Per ADR-012 (M6 text extensions) + ADR-014 (M8 image extensions).
 *
 * v1 scope (M6): SITELINK + CALLOUT + STRUCTURED_SNIPPET.
 * v2 scope (M8): + image extensions (AD_IMAGE family + LOGO variants).
 * Future: PROMOTION, PRICE, CALL, LEAD_FORM, LOCATION.
 *
 * All fields optional + array-typed for graceful degradation.
 * Meta-side adapters never populate this field (extensions = Google concept).
 */
export interface UnifiedAdExtensions {
  /**
   * Sitelink extensions — additional links shown under the main ad.
   * Most common extension type in Search ads.
   * Note: description fields exist on sitelink_asset but are not
   * SELECTable via GAQL (query_error 32 at runtime in v23 SDK).
   * v1 surfaces just text + finalUrl.
   */
  sitelinks?: Array<{
    text: string;
    finalUrl?: string;
  }>;

  /**
   * Callout extensions — short text snippets ("Free shipping", "24/7 support").
   */
  callouts?: string[];

  /**
   * Structured snippet extensions — categorized lists ("Brands: A, B, C").
   */
  structuredSnippets?: Array<{
    header: string;
    values: string[];
  }>;

  /**
   * Image extensions on Search ads (M8 / ADR-014).
   *
   * Single array with per-entry `fieldType` discriminator (Option C from
   * ADR-014 §Decision 1). UI splits at render time:
   *  - AD_IMAGE / MARKETING_IMAGE family → prominent image grid
   *    (primary creative content)
   *  - BUSINESS_LOGO / LANDSCAPE_LOGO → small inline badge next to the
   *    advertiser/campaign name (mirrors Google Search visual)
   *
   * Filtered server-side to status='ENABLED' on both campaign_asset
   * AND campaign (ADR-014 §Decision 3 — strict "currently serving").
   * This is a deliberate departure from M6's `!= 'REMOVED'` filter
   * which includes PAUSED rows; M6 retrofit deferred per
   * ADR-014 §Open Items §1.
   *
   * Deduped by `assetId` server-side (same asset can attach to multiple
   * campaign_asset rows that inherit to the same ad — imaa's Brand
   * campaign family shares 9 AD_IMAGE assets across 4 campaigns).
   */
  images?: Array<{
    url: string;
    fieldType: ImageAssetFieldType;
    assetId: string;
    widthPx?: number;
    heightPx?: number;
  }>;
}

// =================================================================
// Unified Ad — discriminated union (Phase 4.8 M-PMax / ADR-013)
// =================================================================
//
// Locked decisions:
//  - `ad_type` is the SOLE structural discriminator. No overlapping
//    render-hint fields (previous `creativeType` removed; Meta sub-types
//    moved into META_AD's `type_data.subType`).
//  - Common metrics + identity stay as top-level fields (indexable for
//    future cross-ad-type aggregation queries).
//  - Variant-specific data lives in `type_data` — future ad types add new
//    union variants with their own `type_data` shape (zero schema sprawl).
//
// Phase 7+ extension path: TikTok / Snap / Salla / Zid each add their own
// `ad_type` literal + their own `type_data` shape. No new columns, no
// migrations.

/**
 * Top-level structural discriminator. Every variant has exactly one of these.
 *
 *  - RSA: Google Responsive Search Ad (text-only with headlines/descriptions)
 *  - RDA: Google Responsive Display Ad (text + asset-resolved images)
 *  - IMAGE_AD: Google legacy Image Ad (image-only; SDK currently can't surface
 *    the image URL — placeholder for v2 when SDK supports it)
 *  - META_AD: All Meta ad types (image/video/carousel/catalog disambiguated
 *    via `type_data.subType`)
 *  - PMAX_ASSET_GROUP: Google Performance Max asset_group (M-PMax)
 *  - UNKNOWN_GOOGLE: Google ad types not yet specifically modeled (Shopping,
 *    App, Call, Smart Campaign, Demand Gen, etc.) — render falls through to
 *    placeholder; type kept for diagnostic visibility
 */
export type AdType =
  | "RSA"
  | "RDA"
  | "IMAGE_AD"
  | "META_AD"
  | "PMAX_ASSET_GROUP"
  | "TIKTOK_AD"
  | "UNKNOWN_GOOGLE";

/**
 * Fields common to every UnifiedAd variant. Always populated, never optional
 * unless explicitly marked. Performance metrics are uniform across ad types
 * so they live at the common level (indexable in any future analytics table).
 */
export interface UnifiedAdCommon {
  // Identity
  id: string;
  name: string;
  ad_type: AdType;

  /**
   * Source ad account ID. Stamped by multi-account hooks (`useProviderAds`).
   * Optional — single-account hooks (`useAds`) leave it undefined.
   */
  accountId?: string;

  /**
   * Account currency (ISO 4217 — "SAR", "USD", "AED", etc.) at fetch time.
   * Optional for backward compatibility with pre-M5-Commit-1B cached rows.
   * Per Phase 4.8 M5 Commit 1B — enables per-ad currency conversion for
   * multi-account workspaces with mixed currencies.
   */
  currency?: string;

  /**
   * Normalized status. Every non-ACTIVE / non-DELETED state (PAUSED,
   * ARCHIVED, CAMPAIGN_PAUSED, ADSET_PAUSED, IN_PROCESS, WITH_ISSUES, …)
   * collapses to PAUSED — users only care if the ad is currently running.
   */
  status: "ACTIVE" | "PAUSED" | "DELETED";

  // Hierarchy (optional — varies by ad type / platform)
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;

  // Performance metrics — uniform shape across all ad types
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;

  /**
   * Counts of real e-commerce purchases attributable to the ad.
   * NULL when the platform cannot yet determine purchase attribution
   * (e.g. Google ad whose row has no campaign-level purchase merger
   * yet, or PMax asset_group before Commit 5 wires its merger).
   * See ADR-011 + ADR-013 Decision 3 + `hasConversionData` below.
   */
  purchases: number | null;
  /**
   * Total purchase revenue attributable to the ad. NULL under the
   * same conditions as `purchases`.
   */
  revenue: number | null;
  /**
   * Return on ad spend. NULL when revenue is NULL OR when spend is 0
   * (to avoid divide-by-zero). Computed as revenue / spend.
   */
  roas: number | null;
  /**
   * Whether the platform has populated purchase-attribution data for
   * this ad. FALSE means purchases/revenue/roas will be NULL — the
   * platform recognized the ad but cannot yet resolve which conversion
   * actions count as purchases (Google needs `purchaseActionIds`
   * cache; PMax asset_group needs Commit 5 merger). TRUE means the
   * values are authoritative (may still be 0 for legitimate zero
   * activity).
   *
   * Meta always sets TRUE — `omni_purchase` action_type is platform-
   * native, no cache map dependency. Google's ad-level rows currently
   * set FALSE (ad-level purchase merger not yet wired); PMax asset_
   * group rows set FALSE pre-Commit-5 and TRUE post-Commit-5.
   *
   * Mirrors the same flag on UnifiedInsight (per ADR-011) so UI
   * components can share the "configured vs zero" gating logic.
   */
  hasConversionData: boolean;

  /**
   * Asset Extensions (Google-only currently). Per ADR-012.
   * Lives at common level — applies across Google ad types (RSA/RDA/etc.)
   * regardless of variant; Meta variants leave it undefined.
   */
  extensions?: UnifiedAdExtensions;

  // ADR-019 (M9.1) — keywords + searchTerms REMOVED from eager payload.
  // Both are per-ad_group scoped (all ads in the same group share the
  // same arrays in-memory) and JSON serialization duplicated them N
  // times where N = ads sharing the group, causing 17 MB payloads on
  // imaa. Now fetched lazily on modal open via /api/ads/keywords +
  // /api/ads/search-terms (the latter takes ad_group_id + date_range
  // and returns per-ad_group data). UnifiedAdKeyword +
  // UnifiedAdSearchTerm types remain (used by those endpoints).

  provider: AdProvider;
}

/**
 * RSA — Google Responsive Search Ad.
 * Text-only; headlines + descriptions arrays surfaced from GAQL
 * responsive_search_ad fields (Phase 4.8 M5 Commit 1).
 */
export interface UnifiedAdRsa extends UnifiedAdCommon {
  ad_type: "RSA";
  type_data: {
    headlines: string[];
    descriptions: string[];
    /** First final_url from the ad's final_urls list. */
    finalUrl?: string;
  };
}

/**
 * RDA — Google Responsive Display Ad.
 * Text + asset-resolved marketing images. Phase 4.8 M5 Commit 1 (text) +
 * Commit 2 (marketing_images → asset URL resolution).
 */
export interface UnifiedAdRda extends UnifiedAdCommon {
  ad_type: "RDA";
  type_data: {
    headlines: string[];
    descriptions: string[];
    /** Resolved CDN URLs for marketing_images asset references. */
    marketingImages?: string[];
    /** First final_url from the ad's final_urls list. */
    finalUrl?: string;
  };
}

/**
 * IMAGE_AD — Google legacy Image Ad.
 * SDK currently rejects `image_ad.image_asset` SELECT (query_error 23,
 * confirmed in M5). Variant kept for forward-compat — `imageUrl` will be
 * populated when SDK supports the field. Today renders as placeholder.
 */
export interface UnifiedAdImageAd extends UnifiedAdCommon {
  ad_type: "IMAGE_AD";
  type_data: {
    imageUrl?: string;
    finalUrl?: string;
  };
}

/**
 * META_AD — all Meta ad types (image / video / carousel / catalog).
 * `subType` is the Meta-internal sub-discriminator (replaces the old
 * top-level `creativeType` field, which was conflated with Google's
 * `creativeType` — now structurally separated per ADR-013).
 */
export interface UnifiedAdMeta extends UnifiedAdCommon {
  ad_type: "META_AD";
  type_data: {
    /** Meta-internal sub-type. Drives the CreativeCard render branch. */
    subType: "image" | "video" | "carousel" | "catalog" | "unknown";
    creativeId?: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    /** Meta video ID (for previewing in modal). */
    videoId?: string;
    /** Creative text fields (Meta-specific). */
    title?: string;
    body?: string;
    callToAction?: string;
    /** Catalog ad — product set linkage. */
    productSetId?: string;
    /** Resolved top products for catalog ads (post-batch enrichment). */
    catalogProducts?: Array<{
      id: string;
      name?: string;
      imageUrl?: string;
    }>;
    /** Carousel images (resolved URLs). Present when subType === "carousel". */
    carouselImages?: string[];
    /**
     * Intermediate: image hashes from asset_feed_spec.images pending
     * resolution to URLs via /act_{id}/adimages. Removed after the batch
     * resolution pass completes (see MetaAdapter.getAds).
     */
    carouselImageHashes?: string[];
    /** Always-available shareable link to the ad preview on Facebook. */
    previewLink?: string;
  };
}

/**
 * PMAX_ASSET_GROUP — Google Performance Max asset_group.
 * Phase 4.8 M-PMax. Asset_group is the row-level entity in PMax (replaces
 * the ad_group_ad-shaped row in Search/Display campaigns).
 *
 * `performance_label` per-asset categorical badge is DEFERRED to M-PMax v2
 * (SDK currently rejects the field). When SDK supports it, add to
 * `assets[i].performanceLabel` — zero migration cost per JSONB shape.
 */
export interface UnifiedAdPmaxAssetGroup extends UnifiedAdCommon {
  ad_type: "PMAX_ASSET_GROUP";
  type_data: {
    /**
     * Mapped from Google's integer enum via AD_STRENGTH_MAP in
     * `providers/google.ts`. Full enum surface per the Google Ads proto
     * definitions (verified against ad_strength_pb2). UI palette colors
     * EXCELLENT/GOOD/AVERAGE/POOR/NO_ADS; UNSPECIFIED/UNKNOWN/PENDING
     * collapse to a neutral fallback badge.
     */
    adStrength:
      | "UNSPECIFIED"
      | "UNKNOWN"
      | "PENDING"
      | "NO_ADS"
      | "POOR"
      | "AVERAGE"
      | "GOOD"
      | "EXCELLENT";
    /**
     * Mapped from Google's integer enum via PRIMARY_STATUS_MAP in
     * `providers/google.ts`. Full enum surface per asset_group_primary_status_pb2.
     * The narrower common-level `status` field collapses these into
     * ACTIVE/PAUSED/DELETED via `normalizeAssetGroupStatus`; this raw value
     * is preserved here for richer UI access (e.g. distinguishing LIMITED
     * from PAUSED in a tooltip).
     */
    primaryStatus:
      | "UNSPECIFIED"
      | "UNKNOWN"
      | "ELIGIBLE"
      | "PAUSED"
      | "REMOVED"
      | "NOT_ELIGIBLE"
      | "LIMITED"
      | "PENDING";
    /**
     * Assets bundled under this asset_group. Each asset surfaces its raw
     * Google field_type (HEADLINE / DESCRIPTION / MARKETING_IMAGE / etc.)
     * plus the resolved value (text or image URL).
     */
    assets: Array<{
      fieldType: string;
      assetType: string;
      primaryStatus?: string;
      text?: string;
      imageUrl?: string;
      youtubeVideoId?: string;
      // performanceLabel?: string; — deferred to M-PMax v2
    }>;
  };
}

/**
 * UNKNOWN_GOOGLE — fallback for Google ad types not yet specifically modeled
 * (Shopping, App, Call, Smart Campaign, Demand Gen, Video, etc.). Renders as
 * "بدون صورة" placeholder; type kept for diagnostic visibility (the raw
 * Google type string is preserved in `googleAdType`).
 */
export interface UnifiedAdUnknownGoogle extends UnifiedAdCommon {
  ad_type: "UNKNOWN_GOOGLE";
  type_data: {
    /** Original Google ad type string for diagnostic / future surfacing. */
    googleAdType: string;
    finalUrl?: string;
  };
}

/**
 * TikTok ad variant — Phase 7 (ADR-020).
 *
 * TikTok creative is video-first. Per ADR-020 §Decision 11, v1 uses
 * static poster + external "View on TikTok" link (NOT embedded iframe)
 * — embed would couple our UI to TikTok player breaking changes.
 *
 * Per ADR-020 §Decision 12, v1 carries a single TikTok-native metric
 * (`videoViews` — meaningfully different from impressions in TikTok's
 * autoplay-by-default UX). Engagement metrics (2s/6s view rate,
 * completion percentage, engaged_view) deferred to v2.
 */
export interface UnifiedAdTiktok extends UnifiedAdCommon {
  ad_type: "TIKTOK_AD";
  type_data: {
    /** From /file/video/ad/info/ — poster image for the video card. */
    posterUrl?: string;
    /** TikTok-internal video_id; used for /file/video/ad/info/ lookups. */
    videoId?: string;
    /** Public share URL for "View on TikTok" external link. */
    tiktokVideoUrl?: string;
    /**
     * TikTok ad objective_type (CONVERSIONS / TRAFFIC / VIDEO_VIEWS /
     * ENGAGEMENT / REACH / APP_PROMOTION). Surfaced in modal for
     * context — different objectives expect different success metrics.
     */
    objective_type: string;
    /** Call-to-action label (SHOP_NOW / LEARN_MORE / DOWNLOAD / etc.). */
    callToAction?: string;
    /**
     * TikTok-native total view count (autoplay views included).
     * Differs from `impressions` (impressions = times rendered in
     * feed; videoViews = times actually started playing).
     */
    videoViews?: number;
  };
}

/**
 * Discriminated union — every `UnifiedAd` is exactly one of these variants.
 * Narrow via `ad.ad_type === "..."` to access variant-specific `type_data`.
 *
 * Adding a new ad type: add a new variant interface above, append to this
 * union. Zero schema migration; cache version bump triggers reread.
 */
export type UnifiedAd =
  | UnifiedAdRsa
  | UnifiedAdRda
  | UnifiedAdImageAd
  | UnifiedAdMeta
  | UnifiedAdPmaxAssetGroup
  | UnifiedAdTiktok
  | UnifiedAdUnknownGoogle;

// =================================================================
// Unified Account Info
// =================================================================
export interface UnifiedAccount {
  id: string;
  provider: AdProvider;
  name: string;
  currency: string;
  timezone: string;
  status?: "active" | "inactive" | "unknown";
}

// =================================================================
// Date Range
// =================================================================
export type DateRange =
  | "today"
  | "yesterday"
  | "7d"
  | "14d"
  | "this_month"
  | "last_month"
  | "30d"
  | "90d"
  | "lifetime";

// Custom range with arbitrary start/end dates (ISO YYYY-MM-DD strings)
export interface CustomDateRange {
  since: string;
  until: string;
}

// Union of preset or custom range
export type DateRangeInput = DateRange | CustomDateRange;

// Type guard: true if input is a CustomDateRange object (not a preset string)
export function isCustomRange(
  range: DateRangeInput
): range is CustomDateRange {
  return (
    typeof range === "object" && "since" in range && "until" in range
  );
}

// Tagged union used by UI components (DateRangePicker) to describe the
// current selection. Distinct from DateRangeInput so UI state stays explicit.
export type DateRangeValue =
  | { type: "preset"; preset: DateRange }
  | { type: "custom"; since: string; until: string };

const ARABIC_DAY_NAMES = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

/**
 * Format a chart x-axis label: combines day name + short date for short ranges,
 * or date only for longer ranges (saves horizontal space).
 *
 * - daysCount ≤ 14 → "الأحد 27/4"
 * - daysCount > 14 → "27/4"
 */
export function formatChartDayLabel(
  dateStr: string,
  daysCount: number
): string {
  const date = new Date(dateStr);
  const dayShort = `${date.getDate()}/${date.getMonth() + 1}`;
  if (daysCount <= 14) {
    return `${ARABIC_DAY_NAMES[date.getDay()]} ${dayShort}`;
  }
  return dayShort;
}

/**
 * Format a chart tooltip label: always shows day name + short date.
 * Example: "الإثنين 23/4"
 */
export function formatChartTooltipLabel(dateStr: string): string {
  const date = new Date(dateStr);
  return `${ARABIC_DAY_NAMES[date.getDay()]} ${date.getDate()}/${
    date.getMonth() + 1
  }`;
}

/**
 * Convert a non-lifetime preset to actual since/until dates.
 * - today / yesterday → single-day range
 * - 7d/14d/30d/90d   → rolling window ending today (inclusive)
 * - this_month       → first of month → today
 * - last_month       → first to last of previous month
 *
 * Why: Meta's `last_30d` preset excludes today's data. Explicit dates avoid
 * that and allow more meaningful presets like "this_month".
 */
export function presetToCustomRange(
  preset: Exclude<DateRange, "lifetime">
): CustomDateRange {
  const formatISO = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  const today = new Date();

  if (preset === "today") {
    const todayStr = formatISO(today);
    return { since: todayStr, until: todayStr };
  }

  if (preset === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yStr = formatISO(yesterday);
    return { since: yStr, until: yStr };
  }

  if (preset === "this_month") {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    return { since: formatISO(firstDay), until: formatISO(today) };
  }

  if (preset === "last_month") {
    const firstDayLastMonth = new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      1
    );
    // Day 0 of current month = last day of previous month.
    const lastDayLastMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      0
    );
    return {
      since: formatISO(firstDayLastMonth),
      until: formatISO(lastDayLastMonth),
    };
  }

  // Rolling-window presets
  const daysMap: Record<"7d" | "14d" | "30d" | "90d", number> = {
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90,
  };
  const days = daysMap[preset];
  const sinceDate = new Date(today);
  sinceDate.setDate(today.getDate() - (days - 1));

  return { since: formatISO(sinceDate), until: formatISO(today) };
}

export type TimeIncrement = 1 | 7 | "all_days";

export type InsightLevel = "account" | "campaign" | "adset" | "ad";

// =================================================================
// Provider Adapter Interface
// =================================================================
export interface AdProviderAdapter {
  readonly provider: AdProvider;

  // Get all campaigns for the account
  getCampaigns(): Promise<UnifiedCampaign[]>;

  // Get insights aggregated at account level
  getAccountInsights(
    range: DateRangeInput,
    timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]>;

  // Get insights broken down by campaign
  getCampaignInsights(
    range: DateRangeInput,
    timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]>;

  // Get account information
  getAccount(): Promise<UnifiedAccount>;

  // Get ads with creative + performance for a date range
  getAds(range: DateRangeInput): Promise<UnifiedAd[]>;

  // ADR-019 (M9.1) — per-ad_group lazy fetches. Optional because only
  // Google has ad_group-scoped search terms / keywords in the same
  // sense; Meta surfaces different concepts (audiences, placements)
  // that would warrant a separate per-platform endpoint if surfaced.
  // Callers must guard with `if (adapter.getSearchTermsForAdGroup)`
  // or narrow via `provider === "google"`.
  getSearchTermsForAdGroup?(
    adGroupId: string,
    range: DateRangeInput
  ): Promise<UnifiedAdSearchTerm[]>;

  getKeywordsForAdGroup?(
    adGroupId: string,
    range: DateRangeInput
  ): Promise<UnifiedAdKeyword[]>;
}
