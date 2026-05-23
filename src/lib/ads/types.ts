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
// Unified Ad (with creative + performance, for the Ad Creatives view)
// =================================================================
export interface UnifiedAd {
  // Identity
  id: string;
  name: string;
  // Status: every non-ACTIVE / non-DELETED state from Meta (PAUSED, ARCHIVED,
  // CAMPAIGN_PAUSED, ADSET_PAUSED, IN_PROCESS, WITH_ISSUES, …) is normalized
  // to PAUSED — users only care about whether the ad is currently running.
  status: "ACTIVE" | "PAUSED" | "DELETED";

  // Hierarchy
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;

  // Creative
  creativeId?: string;
  imageUrl?: string; // Image ads
  thumbnailUrl?: string; // Video ad preview
  videoId?: string; // Meta video ID
  creativeType: "image" | "video" | "carousel" | "catalog" | "unknown";

  // Creative content
  title?: string;
  body?: string;
  callToAction?: string;

  // Catalog-specific
  productSetId?: string;
  catalogProducts?: Array<{
    id: string;
    name?: string;
    imageUrl?: string;
  }>;

  // Carousel images (when creativeType === 'carousel')
  carouselImages?: string[];

  // Intermediate: hashes pulled from asset_feed_spec.images that still need
  // resolution to URLs via /act_{id}/adimages. Removed after batch resolution.
  carouselImageHashes?: string[];

  // Always-available shareable link to the ad preview on Facebook
  previewLink?: string;

  // Performance
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;

  provider: AdProvider;
}

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
}
