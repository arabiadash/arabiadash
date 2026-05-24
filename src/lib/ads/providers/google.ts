import { GoogleAdsApi, errors } from "google-ads-api";
import {
  type AdProviderAdapter,
  type UnifiedCampaign,
  type UnifiedInsight,
  type UnifiedAccount,
  type UnifiedAd,
  type UnifiedAdExtensions,
  type DateRangeInput,
  type TimeIncrement,
  isCustomRange,
  presetToCustomRange,
} from "../types";
import { fetchCampaigns, type CampaignRow } from "@/lib/google-ads/campaigns";
import { fetchAds, type AdRow } from "@/lib/google-ads/ads";
import { fetchAssetUrls } from "@/lib/google-ads/assets";
import { fetchAdExtensions } from "@/lib/google-ads/extensions";
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
    private loginCustomerId?: string,
    /**
     * Set of conversion_action IDs to treat as real purchases.
     *
     * - null = the conversion_actions cache hasn't been populated for
     *   this user/customer yet. Adapter degrades all four nullable
     *   fields (purchases/revenue/roas/costPerPurchase) to null and
     *   sets hasConversionData: false.
     * - Set (possibly empty) = cache populated. Empty set means the
     *   account has zero PURCHASE/STORE_SALE-categorized actions —
     *   purchases legitimately becomes 0 (not null) and hasConversionData
     *   stays true.
     *
     * Loaded by the factory before adapter construction. See ADR-011.
     */
    private purchaseActionIds: Set<string> | null = null
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
      const [series, purchaseSeries] = await Promise.all([
        fetchTimeSeries({
          customerId: this.customerId,
          refreshToken: this.refreshToken,
          dateFrom,
          dateTo,
          loginCustomerId: this.loginCustomerId,
        }),
        this.fetchPurchaseTimeSeriesTotals(dateFrom, dateTo),
      ]);

      if (!series) return [];
      return series.map((p) =>
        this.normalizeTimeSeriesPoint(p, purchaseSeries)
      );
    }

    // Aggregate over the whole range → use campaigns fetcher's totals.
    // fetchCampaigns aggregates across all campaigns, so its `totals` are
    // exactly the account-level numbers we'd otherwise compute separately.
    const [result, purchaseCampaigns] = await Promise.all([
      fetchCampaigns({
        customerId: this.customerId,
        refreshToken: this.refreshToken,
        dateFrom,
        dateTo,
        loginCustomerId: this.loginCustomerId,
      }),
      this.fetchPurchaseCampaignTotals(dateFrom, dateTo),
    ]);

    if (!result) return [];

    return [
      this.normalizeTotalsToInsight(
        result.totals,
        dateFrom,
        dateTo,
        purchaseCampaigns
      ),
    ];
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

    const [result, purchaseCampaigns] = await Promise.all([
      fetchCampaigns({
        customerId: this.customerId,
        refreshToken: this.refreshToken,
        dateFrom,
        dateTo,
        loginCustomerId: this.loginCustomerId,
      }),
      this.fetchPurchaseCampaignTotals(dateFrom, dateTo),
    ]);

    if (!result) return [];

    return result.campaigns.map((c) =>
      this.normalizeCampaignToInsight(c, dateFrom, dateTo, purchaseCampaigns)
    );
  }

  async getAds(range: DateRangeInput): Promise<UnifiedAd[]> {
    const { dateFrom, dateTo } = this.resolveDateRange(range);

    // Pass 1: fetch ad rows (now includes imageAssetResourceNames)
    const result = await fetchAds({
      customerId: this.customerId,
      refreshToken: this.refreshToken,
      dateFrom,
      dateTo,
      loginCustomerId: this.loginCustomerId,
    });

    if (!result) return [];

    // Drop ads with zero activity in the period — matches Meta behavior.
    const activeAds = result.ads.filter(
      (ad) => ad.spend > 0 || ad.impressions > 0
    );

    // Pass 2: collect unique asset resource names across all active ads
    const allResourceNames = new Set<string>();
    for (const ad of activeAds) {
      if (ad.imageAssetResourceNames) {
        for (const rn of ad.imageAssetResourceNames) {
          allResourceNames.add(rn);
        }
      }
    }

    // Pass 3 + 4: parallel — image URLs AND asset extensions.
    // Both reach Google Ads API independently; running in parallel keeps
    // wall time = max(image URL latency, extensions latency) instead of sum.
    // Empty image-set short-circuits without firing a request.
    const [urlMap, extensionsMap] = await Promise.all([
      allResourceNames.size > 0
        ? fetchAssetUrls({
            customerId: this.customerId,
            refreshToken: this.refreshToken,
            loginCustomerId: this.loginCustomerId,
            resourceNames: Array.from(allResourceNames),
          })
        : Promise.resolve(new Map<string, string>()),
      // Phase 4.8 M6 — Asset Extensions per ADR-012
      fetchAdExtensions({
        customerId: this.customerId,
        refreshToken: this.refreshToken,
        loginCustomerId: this.loginCustomerId,
        dateFrom,
        dateTo,
        adIdToCampaignId: new Map(
          activeAds.map((ad) => [ad.id, ad.campaign_id])
        ),
      }),
    ]);

    // Pass 5: normalize with URL lookups + extensions baked in.
    return activeAds.map((ad) =>
      this.normalizeAd(ad, urlMap, extensionsMap)
    );
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
   * Segmented Q2 query for purchase conversions per campaign.
   *
   * GAQL constraint: segments.conversion_action cannot be combined
   * with metrics.cost_micros / metrics.clicks / metrics.impressions
   * in a single query (error code 53, PROHIBITED_SEGMENT_WITH_METRIC_
   * IN_SELECT_OR_WHERE_CLAUSE — verified empirically pre-commit). So
   * we run this as a separate query alongside fetchCampaigns and merge
   * the results in normalizeCampaignToInsight + normalizeTotalsToInsight.
   *
   * Returns null when:
   * - purchaseActionIds is null (cache not populated for this account)
   * - the Google API call fails (auth, quota, transient — caught here)
   * Both null cases trigger purchases=null + hasConversionData=false in
   * the normalize functions, per ADR-011 / ADR-008.
   *
   * Returned map: campaign.id (string) -> { purchases, revenue } summed
   * across ONLY the action IDs in purchaseActionIds.
   *
   * Builds its own GoogleAdsApi + Customer instance internally — mirrors
   * the helper-layer convention (refresh-token-in, SDK-internal) used
   * by syncConversionActionsForCustomer in Commit 3. Costs one extra
   * auth handshake per insights fetch; acceptable per locked decision
   * "Defer Q2 caching" in ADR-011.
   */
  private async fetchPurchaseCampaignTotals(
    dateFrom: string,
    dateTo: string
  ): Promise<Map<string, { purchases: number; revenue: number }> | null> {
    if (this.purchaseActionIds === null) return null;

    try {
      const api = new GoogleAdsApi({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
        developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      });

      const customer = api.Customer({
        customer_id: this.customerId,
        refresh_token: this.refreshToken,
        ...(this.loginCustomerId
          ? { login_customer_id: this.loginCustomerId }
          : {}),
      });

      const query = `
        SELECT
          campaign.id,
          segments.conversion_action,
          metrics.conversions,
          metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      `;

      const rows = await customer.query(query);

      const byCampaign = new Map<
        string,
        { purchases: number; revenue: number }
      >();

      for (const row of rows) {
        // segments.conversion_action is the full resource_name path:
        // "customers/{cid}/conversionActions/{action_id}"
        const resourcePath = String(row.segments?.conversion_action ?? "");
        const actionId = resourcePath.split("/").pop() ?? "";

        if (!this.purchaseActionIds.has(actionId)) continue;

        const campaignId = String(row.campaign?.id ?? "");
        if (!campaignId) continue;

        const conversions = Number(row.metrics?.conversions ?? 0);
        const conversionsValue = Number(row.metrics?.conversions_value ?? 0);

        const existing = byCampaign.get(campaignId) ?? {
          purchases: 0,
          revenue: 0,
        };
        existing.purchases += conversions;
        existing.revenue += conversionsValue;
        byCampaign.set(campaignId, existing);
      }

      return byCampaign;
    } catch (err) {
      const message =
        err instanceof errors.GoogleAdsFailure
          ? err.errors?.map((e) => e.message).join("; ") ??
            "GoogleAdsFailure (no detail)"
          : err instanceof Error
          ? err.message
          : String(err);
      console.warn(
        `[GoogleAdsAdapter] fetchPurchaseCampaignTotals failed for ${this.customerId}: ${message}. Degrading purchases to null.`
      );
      return null;
    }
  }

  /**
   * Segmented Q2 query for purchase conversions per day.
   *
   * Time-series companion to fetchPurchaseCampaignTotals. Same GAQL
   * constraint, same filter logic. Returns a map keyed by ISO date
   * (YYYY-MM-DD).
   *
   * FROM customer (not FROM campaign) to match fetchTimeSeries's
   * account-level aggregation. Errors and null-cases handled identically
   * to fetchPurchaseCampaignTotals — see that method's docblock.
   */
  private async fetchPurchaseTimeSeriesTotals(
    dateFrom: string,
    dateTo: string
  ): Promise<Map<string, { purchases: number; revenue: number }> | null> {
    if (this.purchaseActionIds === null) return null;

    try {
      const api = new GoogleAdsApi({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
        developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      });

      const customer = api.Customer({
        customer_id: this.customerId,
        refresh_token: this.refreshToken,
        ...(this.loginCustomerId
          ? { login_customer_id: this.loginCustomerId }
          : {}),
      });

      const query = `
        SELECT
          segments.date,
          segments.conversion_action,
          metrics.conversions,
          metrics.conversions_value
        FROM customer
        WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      `;

      const rows = await customer.query(query);

      const byDate = new Map<
        string,
        { purchases: number; revenue: number }
      >();

      for (const row of rows) {
        const resourcePath = String(row.segments?.conversion_action ?? "");
        const actionId = resourcePath.split("/").pop() ?? "";

        if (!this.purchaseActionIds.has(actionId)) continue;

        const date = String(row.segments?.date ?? "");
        if (!date) continue;

        const conversions = Number(row.metrics?.conversions ?? 0);
        const conversionsValue = Number(row.metrics?.conversions_value ?? 0);

        const existing = byDate.get(date) ?? { purchases: 0, revenue: 0 };
        existing.purchases += conversions;
        existing.revenue += conversionsValue;
        byDate.set(date, existing);
      }

      return byDate;
    } catch (err) {
      const message =
        err instanceof errors.GoogleAdsFailure
          ? err.errors?.map((e) => e.message).join("; ") ??
            "GoogleAdsFailure (no detail)"
          : err instanceof Error
          ? err.message
          : String(err);
      console.warn(
        `[GoogleAdsAdapter] fetchPurchaseTimeSeriesTotals failed for ${this.customerId}: ${message}. Degrading purchases to null.`
      );
      return null;
    }
  }

  /**
   * Daily time-series point → UnifiedInsight.
   * Google returns CTR as a raw ratio (0.0945 = 9.45%); Meta returns it as
   * a percentage already (0.52984 = 0.53%). We follow Meta convention so
   * downstream UI doesn't branch on provider — multiply by 100.
   */
  private normalizeTimeSeriesPoint = (
    p: TimeSeriesPoint,
    purchaseSeries: Map<string, { purchases: number; revenue: number }> | null
  ): UnifiedInsight => {
    // Purchase-filtered metrics — see ADR-011, #15.
    // null purchaseSeries = Q2 unavailable (empty cache or Q2 failure).
    const hasConversionData = purchaseSeries !== null;
    const purchaseTotals = purchaseSeries?.get(p.date) ?? null;

    const purchases: number | null = hasConversionData
      ? purchaseTotals?.purchases ?? 0
      : null;
    const revenue: number | null = hasConversionData
      ? purchaseTotals?.revenue ?? 0
      : null;
    const roas: number | null =
      revenue !== null && p.spend > 0 ? revenue / p.spend : null;
    const costPerPurchase: number | null =
      purchases !== null && purchases > 0 ? p.spend / purchases : null;

    return {
      provider: "google",
      currency: this.accountInfo.currency,
      spend: p.spend,
      impressions: p.impressions,
      clicks: p.clicks,
      reach: 0, // Not available in Google
      frequency: 0,
      ctr: p.ctr * 100, // ratio → percentage
      cpc: p.cpc,
      cpm: p.impressions > 0 ? (p.spend / p.impressions) * 1000 : 0,
      purchases,
      revenue,
      roas,
      addToCart: 0, // Meta-specific (Custom Conversions)
      initiateCheckout: 0,
      leads: 0,
      costPerPurchase,
      costPerLead: 0,
      dateStart: p.date,
      dateStop: p.date, // Same day
      hasConversionData,
    };
  };

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
    dateTo: string,
    purchaseCampaigns: Map<
      string,
      { purchases: number; revenue: number }
    > | null
  ): UnifiedInsight => {
    // Aggregate filtered totals across all campaigns. See ADR-011, #15.
    const hasConversionData = purchaseCampaigns !== null;

    let aggregatedPurchases: number | null = null;
    let aggregatedRevenue: number | null = null;
    if (purchaseCampaigns !== null) {
      aggregatedPurchases = 0;
      aggregatedRevenue = 0;
      for (const entry of purchaseCampaigns.values()) {
        aggregatedPurchases += entry.purchases;
        aggregatedRevenue += entry.revenue;
      }
    }

    const purchases = aggregatedPurchases;
    const revenue = aggregatedRevenue;
    const roas: number | null =
      revenue !== null && totals.spend > 0 ? revenue / totals.spend : null;
    const costPerPurchase: number | null =
      purchases !== null && purchases > 0 ? totals.spend / purchases : null;

    return {
      provider: "google",
      currency: this.accountInfo.currency,
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
      purchases,
      revenue,
      roas,
      addToCart: 0,
      initiateCheckout: 0,
      leads: 0,
      costPerPurchase,
      costPerLead: 0,
      dateStart: dateFrom,
      dateStop: dateTo,
      hasConversionData,
    };
  };

  /**
   * Single Campaign → UnifiedInsight at campaign level.
   */
  private normalizeCampaignToInsight = (
    c: CampaignRow,
    dateFrom: string,
    dateTo: string,
    purchaseCampaigns: Map<
      string,
      { purchases: number; revenue: number }
    > | null
  ): UnifiedInsight => {
    const hasConversionData = purchaseCampaigns !== null;
    const entry = purchaseCampaigns?.get(String(c.id)) ?? null;

    const purchases: number | null = hasConversionData
      ? entry?.purchases ?? 0
      : null;
    const revenue: number | null = hasConversionData
      ? entry?.revenue ?? 0
      : null;
    const roas: number | null =
      revenue !== null && c.spend > 0 ? revenue / c.spend : null;
    const costPerPurchase: number | null =
      purchases !== null && purchases > 0 ? c.spend / purchases : null;

    return {
      campaignId: c.id,
      campaignName: c.name,
      provider: "google",
      currency: this.accountInfo.currency,
      spend: c.spend,
      impressions: c.impressions,
      clicks: c.clicks,
      reach: 0,
      frequency: 0,
      ctr: c.ctr * 100,
      cpc: c.cpc,
      cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
      purchases,
      revenue,
      roas,
      addToCart: 0,
      initiateCheckout: 0,
      leads: 0,
      costPerPurchase,
      costPerLead: 0,
      status: this.normalizeCampaignStatus(c.status),
      dateStart: dateFrom,
      dateStop: dateTo,
      hasConversionData,
    };
  };

  /**
   * AdRow → UnifiedAd discriminated variant. Branches on Google's internal
   * ad type, returns one of: RSA, RDA, IMAGE_AD, UNKNOWN_GOOGLE (Phase 4.8
   * M-PMax / ADR-013).
   *
   * Composite name from campaign + ad group since Google ads lack a
   * user-friendly name field.
   */
  private normalizeAd = (
    ad: AdRow,
    urlMap?: Map<string, string>,
    extensionsMap?: Map<string, UnifiedAdExtensions>
  ): UnifiedAd => {
    // Resolve collected asset resource names to URLs via the batched map.
    const resolvedUrls: string[] = [];
    if (ad.imageAssetResourceNames && urlMap) {
      for (const rn of ad.imageAssetResourceNames) {
        const url = urlMap.get(rn);
        if (url) resolvedUrls.push(url);
      }
    }

    // Phase 4.8 M6 — attach extensions if any (Google-only; undefined when
    // the ad has no extensions or fetchAdExtensions returned empty).
    const extensions = extensionsMap?.get(ad.id);

    // Common fields shared across all Google variants.
    const common = {
      id: ad.id,
      name: `${ad.campaign_name} — ${ad.ad_group_name}`,
      currency: this.accountInfo.currency,
      status: this.normalizeAdStatus(ad.status),
      campaignId: ad.campaign_id,
      campaignName: ad.campaign_name,
      adsetId: ad.ad_group_id,
      adsetName: ad.ad_group_name,
      spend: ad.spend,
      revenue: ad.revenue,
      roas: ad.roas,
      purchases: ad.conversions,
      impressions: ad.impressions,
      clicks: ad.clicks,
      ctr: ad.ctr * 100,
      cpc: ad.cpc,
      extensions,
      provider: "google" as const,
    };

    const finalUrl = ad.final_url ?? undefined;
    const headlines = ad.headlines ?? [];
    const descriptions = ad.descriptions ?? [];

    // Branch by Google's internal ad type → discriminated variant.
    switch (ad.type) {
      case "RESPONSIVE_SEARCH_AD":
      case "EXPANDED_TEXT_AD":
        return {
          ...common,
          ad_type: "RSA",
          type_data: {
            headlines,
            descriptions,
            finalUrl,
          },
        };

      case "RESPONSIVE_DISPLAY_AD":
      case "LEGACY_RESPONSIVE_DISPLAY_AD":
        return {
          ...common,
          ad_type: "RDA",
          type_data: {
            headlines,
            descriptions,
            marketingImages:
              resolvedUrls.length > 0 ? resolvedUrls : undefined,
            finalUrl,
          },
        };

      case "IMAGE_AD":
        return {
          ...common,
          ad_type: "IMAGE_AD",
          type_data: {
            // SDK currently rejects image_ad.image_asset SELECT (M5); this
            // stays undefined until SDK supports the field. Variant kept
            // for forward-compat per ADR-013.
            imageUrl: resolvedUrls.length > 0 ? resolvedUrls[0] : undefined,
            finalUrl,
          },
        };

      default:
        // Shopping, App, Call, Smart Campaigns, Demand Gen, Video, etc.
        // No specific render branch in v1 — falls through to placeholder.
        // Original Google type preserved in type_data.googleAdType for
        // diagnostic visibility.
        return {
          ...common,
          ad_type: "UNKNOWN_GOOGLE",
          type_data: {
            googleAdType: ad.type,
            finalUrl,
          },
        };
    }
  };

  private normalizeAdStatus(googleStatus: string): UnifiedAd["status"] {
    if (googleStatus === "ENABLED") return "ACTIVE";
    if (googleStatus === "REMOVED") return "DELETED";
    return "PAUSED";
  }
}
