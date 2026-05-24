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

// ──────────────────────────────────────────────────────────────────
// Performance Max enum maps (ADR-013)
// ──────────────────────────────────────────────────────────────────
// Integer values verified against Google Ads proto definitions
// (ad_strength_pb2 + asset_group_primary_status_pb2). The SDK can
// serialize enum fields as EITHER the integer or the string label
// depending on call site / response shape — the readers below handle
// both modes (see `readAdStrength` / `readPrimaryStatus`).
//
// Trap avoided: an earlier recon note assumed ad_strength=5 meant GOOD.
// Per the proto, 5 = AVERAGE. Always cross-check with proto, not docs.
const AD_STRENGTH_MAP = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "PENDING",
  3: "NO_ADS",
  4: "POOR",
  5: "AVERAGE",
  6: "GOOD",
  7: "EXCELLENT",
} as const;

type AdStrengthLabel = (typeof AD_STRENGTH_MAP)[keyof typeof AD_STRENGTH_MAP];

const PRIMARY_STATUS_MAP = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "ELIGIBLE",
  3: "PAUSED",
  4: "REMOVED",
  5: "NOT_ELIGIBLE",
  6: "LIMITED",
  7: "PENDING",
} as const;

type PrimaryStatusLabel =
  (typeof PRIMARY_STATUS_MAP)[keyof typeof PRIMARY_STATUS_MAP];

function readAdStrength(raw: unknown): AdStrengthLabel {
  if (typeof raw === "number") {
    return AD_STRENGTH_MAP[raw as keyof typeof AD_STRENGTH_MAP] ?? "UNKNOWN";
  }
  if (typeof raw === "string") {
    return (Object.values(AD_STRENGTH_MAP) as string[]).includes(raw)
      ? (raw as AdStrengthLabel)
      : "UNKNOWN";
  }
  return "UNKNOWN";
}

function readPrimaryStatus(raw: unknown): PrimaryStatusLabel {
  if (typeof raw === "number") {
    return (
      PRIMARY_STATUS_MAP[raw as keyof typeof PRIMARY_STATUS_MAP] ?? "UNKNOWN"
    );
  }
  if (typeof raw === "string") {
    return (Object.values(PRIMARY_STATUS_MAP) as string[]).includes(raw)
      ? (raw as PrimaryStatusLabel)
      : "UNKNOWN";
  }
  return "UNKNOWN";
}

/**
 * Collapse asset_group.primary_status into the UnifiedAdCommon 3-value
 * status union. Mirrors `normalizeAdStatus`'s precedent (Google has many
 * statuses; the common-level field stays ACTIVE/PAUSED/DELETED only).
 *
 * The raw primary_status label is preserved in `type_data.primaryStatus`
 * for richer UI (tooltip can distinguish LIMITED from a plain PAUSED).
 */
function normalizeAssetGroupStatus(
  primaryStatus: PrimaryStatusLabel
): "ACTIVE" | "PAUSED" | "DELETED" {
  switch (primaryStatus) {
    case "ELIGIBLE":
      return "ACTIVE";
    case "PAUSED":
      return "PAUSED";
    case "REMOVED":
      return "DELETED";
    case "NOT_ELIGIBLE":
    case "LIMITED":
    case "PENDING":
    case "UNSPECIFIED":
    case "UNKNOWN":
    default:
      return "PAUSED";
  }
}

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
    const normalizedAds = activeAds.map((ad) =>
      this.normalizeAd(ad, urlMap, extensionsMap)
    );

    // Pass 6 (M-PMax / ADR-013): asset_group rows. PMax campaigns return
    // ZERO rows from passes 1-5 (no ad_group_ad), so this pass is the
    // sole surface for Performance Max creative units. assets[] starts
    // empty — populated by fetchAssetGroupAssets in Commit 4.
    const assetGroupRows = await this.fetchAssetGroupRows(dateFrom, dateTo);

    return [...normalizedAds, ...assetGroupRows];
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

  /**
   * Performance Max asset_group rows (ADR-013, Commit 3).
   *
   * One GAQL pass against `FROM asset_group` with 11 confirmed-working
   * fields (Stage 3 recon). PMax campaigns expose no `ad_group_ad`, so this
   * is the sole creative-unit surface for them. Returns UnifiedAd rows of
   * the PMAX_ASSET_GROUP variant; `assets[]` is intentionally empty here
   * and populated by `fetchAssetGroupAssets` in Commit 4.
   *
   * Fields explicitly NOT in the SELECT (per ADR-013 field-isolation
   * discipline):
   *  - `asset_group.asset_coverage` (v19+ field, not Stage-3 tested)
   *  - `asset_group.status` (richer `primary_status` already covers it)
   *  - `asset_group_asset.performance_label` (proven runtime-rejected in
   *    Stage 3 — bundled into the future v2 work)
   *
   * Error handling mirrors `fetchPurchaseCampaignTotals`: a GoogleAdsFailure
   * (or any thrown error) is logged and degrades the result to []. Callers
   * concatenate the result with prior passes, so [] is a safe no-op for
   * accounts without PMax campaigns.
   */
  private async fetchAssetGroupRows(
    dateFrom: string,
    dateTo: string
  ): Promise<UnifiedAd[]> {
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
          campaign.name,
          asset_group.id,
          asset_group.name,
          asset_group.ad_strength,
          asset_group.primary_status,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value
        FROM asset_group
        WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      `;

      const rows = await customer.query(query);

      const out: UnifiedAd[] = [];
      for (const row of rows) {
        const assetGroupId = String(row.asset_group?.id ?? "");
        if (!assetGroupId) continue;

        const impressions = Number(row.metrics?.impressions) || 0;
        const clicks = Number(row.metrics?.clicks) || 0;
        const costMicros = Number(row.metrics?.cost_micros) || 0;
        const spend = costMicros / 1_000_000;

        // Drop zero-activity rows — same convention as fetchAds active filter.
        if (impressions === 0 && spend === 0) continue;

        // CTR computed client-side from clicks/impressions instead of metrics.ctr.
        // Mathematically equivalent (Google's metrics.ctr = clicks/impressions).
        // Choice rationale: minimize GAQL field surface to reduce M5-class
        // field-rejection risk.
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;

        const adStrength = readAdStrength(row.asset_group?.ad_strength);
        const primaryStatus = readPrimaryStatus(
          row.asset_group?.primary_status
        );

        out.push({
          ad_type: "PMAX_ASSET_GROUP",
          id: assetGroupId,
          name: String(row.asset_group?.name ?? ""),
          accountId: this.customerId,
          currency: this.accountInfo.currency,
          status: normalizeAssetGroupStatus(primaryStatus),
          campaignId: String(row.campaign?.id ?? ""),
          campaignName: String(row.campaign?.name ?? ""),
          spend,
          revenue: 0,
          roas: 0,
          purchases: 0,
          impressions,
          clicks,
          ctr,
          cpc,
          provider: "google",
          type_data: {
            adStrength,
            primaryStatus,
            assets: [],
          },
        });
      }

      return out;
    } catch (err) {
      const message =
        err instanceof errors.GoogleAdsFailure
          ? err.errors?.map((e) => e.message).join("; ") ??
            "GoogleAdsFailure (no detail)"
          : err instanceof Error
          ? err.message
          : String(err);
      console.warn(
        `[GoogleAdsAdapter] fetchAssetGroupRows failed for ${this.customerId}: ${message}. Returning [] (no PMax asset_group rows this fetch).`
      );
      return [];
    }
  }
}
