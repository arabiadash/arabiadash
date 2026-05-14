import {
  type AdProviderAdapter,
  type UnifiedCampaign,
  type UnifiedInsight,
  type UnifiedAccount,
  type UnifiedAd,
  type DateRangeInput,
  type TimeIncrement,
  isCustomRange,
  presetToCustomRange,
} from "../types";
import { fetchCampaigns, type CampaignRow } from "@/lib/google-ads/campaigns";
import { fetchAds, type AdRow } from "@/lib/google-ads/ads";
import {
  fetchTimeSeries,
  type TimeSeriesPoint,
} from "@/lib/google-ads/timeseries";

/**
 * GoogleAdsAdapter wraps the Google Ads-specific fetchers and normalizes
 * their output to the Unified shapes consumed by /api/ads/* endpoints.
 */
export class GoogleAdsAdapter implements AdProviderAdapter {
  readonly provider = "google" as const;

  /**
   * @param refreshToken Long-lived OAuth refresh token (stored as
   *   access_token in the connections table — the column name is
   *   provider-agnostic).
   * @param customerId 10-digit Google Ads customer ID (no dashes).
   * @param accountInfo name/currency/timezone for getAccount() and for
   *   building UnifiedAccount responses.
   * @param loginCustomerId MCC ID for accounts linked under a manager.
   *   Pass undefined for standalone accounts. Determined at sync time and
   *   stored in connections.metadata.manager_customer_id.
   */
  constructor(
    private refreshToken: string,
    private customerId: string,
    private accountInfo: {
      name: string;
      currency: string;
      timezone: string;
    },
    private loginCustomerId?: string
  ) {}

  async getAccount(): Promise<UnifiedAccount> {
    return {
      id: this.customerId,
      provider: "google",
      name: this.accountInfo.name,
      currency: this.accountInfo.currency,
      timezone: this.accountInfo.timezone,
      status: "active",
    };
  }

  async getCampaigns(): Promise<UnifiedCampaign[]> {
    // Default to last 30 days for status + recent performance discovery.
    // Google's campaign resource has no spend/budget without a date range,
    // so this fetcher returns metadata + last-30d metrics combined.
    const { dateFrom, dateTo } = this.resolveDateRange("30d");
    const result = await fetchCampaigns({
      customerId: this.customerId,
      refreshToken: this.refreshToken,
      dateFrom,
      dateTo,
      loginCustomerId: this.loginCustomerId,
    });

    if (!result) return [];

    return result.campaigns.map((c) => this.normalizeCampaign(c));
  }

  async getAccountInsights(
    range: DateRangeInput,
    timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]> {
    const { dateFrom, dateTo } = this.resolveDateRange(range);

    // Daily breakdown → use the time-series fetcher (one row per day).
    if (timeIncrement === 1) {
      const series = await fetchTimeSeries({
        customerId: this.customerId,
        refreshToken: this.refreshToken,
        dateFrom,
        dateTo,
        loginCustomerId: this.loginCustomerId,
      });

      if (!series) return [];
      return series.map((p) => this.normalizeTimeSeriesPoint(p));
    }

    // Aggregate over the whole range → use campaigns fetcher's totals.
    // fetchCampaigns aggregates across all campaigns, so its `totals` are
    // exactly the account-level numbers we'd otherwise compute separately.
    const result = await fetchCampaigns({
      customerId: this.customerId,
      refreshToken: this.refreshToken,
      dateFrom,
      dateTo,
      loginCustomerId: this.loginCustomerId,
    });

    if (!result) return [];

    return [this.normalizeTotalsToInsight(result.totals, dateFrom, dateTo)];
  }

  async getCampaignInsights(
    range: DateRangeInput,
    _timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]> {
    // timeIncrement intentionally ignored — per-campaign daily series
    // needs a different GAQL query (segments.date on campaign-level). Add
    // when the UI surfaces that view.
    void _timeIncrement;
    const { dateFrom, dateTo } = this.resolveDateRange(range);

    const result = await fetchCampaigns({
      customerId: this.customerId,
      refreshToken: this.refreshToken,
      dateFrom,
      dateTo,
      loginCustomerId: this.loginCustomerId,
    });

    if (!result) return [];

    return result.campaigns.map((c) =>
      this.normalizeCampaignToInsight(c, dateFrom, dateTo)
    );
  }

  async getAds(range: DateRangeInput): Promise<UnifiedAd[]> {
    const { dateFrom, dateTo } = this.resolveDateRange(range);

    const result = await fetchAds({
      customerId: this.customerId,
      refreshToken: this.refreshToken,
      dateFrom,
      dateTo,
      loginCustomerId: this.loginCustomerId,
    });

    if (!result) return [];

    // Drop ads with zero activity in the period — matches Meta behavior.
    return result.ads
      .filter((ad) => ad.spend > 0 || ad.impressions > 0)
      .map((ad) => this.normalizeAd(ad));
  }

  // ───────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────

  /**
   * Resolve any DateRangeInput → concrete YYYY-MM-DD strings.
   * Google has no "lifetime" concept, so we cap it at 3 years back.
   */
  private resolveDateRange(range: DateRangeInput): {
    dateFrom: string;
    dateTo: string;
  } {
    if (isCustomRange(range)) {
      return { dateFrom: range.since, dateTo: range.until };
    }

    if (range === "lifetime") {
      const formatISO = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${dd}`;
      };

      const today = new Date();
      const threeYearsAgo = new Date(today);
      threeYearsAgo.setFullYear(today.getFullYear() - 3);

      return {
        dateFrom: formatISO(threeYearsAgo),
        dateTo: formatISO(today),
      };
    }

    const { since, until } = presetToCustomRange(range);
    return { dateFrom: since, dateTo: until };
  }

  /**
   * Google's CampaignRow → UnifiedCampaign. Budget/objective/dates aren't
   * exposed by our GAQL query, so they're left unset (createdTime/updatedTime
   * are required fields, set to empty string until we add a separate metadata
   * query).
   */
  private normalizeCampaign = (c: CampaignRow): UnifiedCampaign => ({
    id: c.id,
    provider: "google",
    name: c.name,
    status: this.normalizeCampaignStatus(c.status),
    objective: c.type, // Google's advertising_channel_type is the closest match
    createdTime: "",
    updatedTime: "",
  });

  private normalizeCampaignStatus(
    googleStatus: string
  ): UnifiedCampaign["status"] {
    switch (googleStatus) {
      case "ENABLED":
        return "ACTIVE";
      case "PAUSED":
        return "PAUSED";
      case "REMOVED":
        return "DELETED";
      default:
        return "ARCHIVED";
    }
  }

  /**
   * Daily time-series point → UnifiedInsight.
   * Google returns CTR as a raw ratio (0.0945 = 9.45%); Meta returns it as
   * a percentage already (0.52984 = 0.53%). We follow Meta convention so
   * downstream UI doesn't branch on provider — multiply by 100.
   */
  private normalizeTimeSeriesPoint = (
    p: TimeSeriesPoint
  ): UnifiedInsight => ({
    provider: "google",
    spend: p.spend,
    impressions: p.impressions,
    clicks: p.clicks,
    reach: 0, // Not available in Google
    frequency: 0,
    ctr: p.ctr * 100, // ratio → percentage
    cpc: p.cpc,
    cpm: p.impressions > 0 ? (p.spend / p.impressions) * 1000 : 0,
    purchases: p.conversions,
    revenue: p.revenue,
    roas: p.roas,
    addToCart: 0, // Meta-specific (Custom Conversions)
    initiateCheckout: 0,
    leads: 0,
    costPerPurchase: p.conversions > 0 ? p.spend / p.conversions : 0,
    costPerLead: 0,
    dateStart: p.date,
    dateStop: p.date, // Same day
  });

  /**
   * Totals from fetchCampaigns → single account-level UnifiedInsight.
   * Used for non-daily aggregated views (range total, no time_increment).
   */
  private normalizeTotalsToInsight = (
    totals: {
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      revenue: number;
      ctr: number;
      cpc: number;
      roas: number;
    },
    dateFrom: string,
    dateTo: string
  ): UnifiedInsight => ({
    provider: "google",
    spend: totals.spend,
    impressions: totals.impressions,
    clicks: totals.clicks,
    reach: 0,
    frequency: 0,
    ctr: totals.ctr * 100,
    cpc: totals.cpc,
    cpm:
      totals.impressions > 0
        ? (totals.spend / totals.impressions) * 1000
        : 0,
    purchases: totals.conversions,
    revenue: totals.revenue,
    roas: totals.roas,
    addToCart: 0,
    initiateCheckout: 0,
    leads: 0,
    costPerPurchase:
      totals.conversions > 0 ? totals.spend / totals.conversions : 0,
    costPerLead: 0,
    dateStart: dateFrom,
    dateStop: dateTo,
  });

  /**
   * Single Campaign → UnifiedInsight at campaign level.
   */
  private normalizeCampaignToInsight = (
    c: CampaignRow,
    dateFrom: string,
    dateTo: string
  ): UnifiedInsight => ({
    campaignId: c.id,
    campaignName: c.name,
    provider: "google",
    spend: c.spend,
    impressions: c.impressions,
    clicks: c.clicks,
    reach: 0,
    frequency: 0,
    ctr: c.ctr * 100,
    cpc: c.cpc,
    cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
    purchases: c.conversions,
    revenue: c.revenue,
    roas: c.roas,
    addToCart: 0,
    initiateCheckout: 0,
    leads: 0,
    costPerPurchase: c.conversions > 0 ? c.spend / c.conversions : 0,
    costPerLead: 0,
    dateStart: dateFrom,
    dateStop: dateTo,
  });

  /**
   * AdRow → UnifiedAd. Composite name from campaign + ad group since Google
   * ads lack a user-friendly name field. Creative content (headlines, images,
   * video assets) is NOT included — Google has 35+ ad types with wildly
   * different schemas; surfacing them needs a separate fetcher.
   */
  private normalizeAd = (ad: AdRow): UnifiedAd => ({
    id: ad.id,
    name: `${ad.campaign_name} — ${ad.ad_group_name}`,
    status: this.normalizeAdStatus(ad.status),
    campaignId: ad.campaign_id,
    campaignName: ad.campaign_name,
    adsetId: ad.ad_group_id,
    adsetName: ad.ad_group_name,
    creativeId: undefined,
    imageUrl: undefined,
    thumbnailUrl: undefined,
    videoId: undefined,
    creativeType: this.adTypeToCreativeType(ad.type),
    previewLink: ad.final_url ?? undefined,
    spend: ad.spend,
    revenue: ad.revenue,
    roas: ad.roas,
    purchases: ad.conversions,
    impressions: ad.impressions,
    clicks: ad.clicks,
    ctr: ad.ctr * 100,
    cpc: ad.cpc,
    provider: "google",
  });

  private normalizeAdStatus(googleStatus: string): UnifiedAd["status"] {
    if (googleStatus === "ENABLED") return "ACTIVE";
    if (googleStatus === "REMOVED") return "DELETED";
    return "PAUSED";
  }

  /**
   * Best-effort mapping from Google's ad type strings → Unified creativeType.
   * Google has 35+ ad types; we collapse to image/video/unknown.
   */
  private adTypeToCreativeType(googleType: string): UnifiedAd["creativeType"] {
    if (googleType.includes("VIDEO")) return "video";
    if (
      googleType.includes("IMAGE") ||
      googleType === "RESPONSIVE_DISPLAY_AD" ||
      googleType === "LEGACY_RESPONSIVE_DISPLAY_AD"
    ) {
      return "image";
    }
    // Search ads, App ads, Shopping ads — text or app-store-driven.
    return "unknown";
  }
}
