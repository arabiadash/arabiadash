import {
  type AdProviderAdapter,
  type UnifiedCampaign,
  type UnifiedInsight,
  type UnifiedAccount,
  type UnifiedAd,
  type DateRangeInput,
  type TimeIncrement,
} from "../types";
import {
  getCampaigns as fetchMetaCampaigns,
  getAccountInsights as fetchMetaAccountInsights,
  getCampaignInsights as fetchMetaCampaignInsights,
  getAds as fetchMetaAds,
  getCatalogTopProducts,
  metaAdToUnified,
  resolveImageHashesToUrls,
  type MetaCampaign,
  type MetaInsight,
} from "@/lib/meta/api";
import {
  getSpend,
  getImpressions,
  getClicks,
  getCTR,
  getCPC,
  getCPM,
  getReach,
  getFrequency,
  getPurchaseCount,
  getRevenue,
  getROAS,
  getAddToCartCount,
  getInitiateCheckoutCount,
  getLeadCount,
  getCostPerPurchase,
} from "@/lib/meta/metrics";

/**
 * MetaAdapter wraps the Meta-specific API and metrics functions
 * to provide a unified interface for the rest of the app.
 */
export class MetaAdapter implements AdProviderAdapter {
  readonly provider = "meta" as const;

  constructor(
    private accessToken: string,
    private accountId: string,
    private accountInfo?: { name: string; currency: string; timezone: string }
  ) {}

  async getCampaigns(): Promise<UnifiedCampaign[]> {
    const metaCampaigns = await fetchMetaCampaigns(
      this.accessToken,
      this.accountId
    );
    return metaCampaigns.map(this.normalizeCampaign);
  }

  async getAccountInsights(
    range: DateRangeInput,
    timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]> {
    const insights = await fetchMetaAccountInsights(
      this.accessToken,
      this.accountId,
      range,
      timeIncrement
    );
    return insights.map((i) => this.normalizeInsight(i));
  }

  async getCampaignInsights(
    range: DateRangeInput,
    timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]> {
    const insights = await fetchMetaCampaignInsights(
      this.accessToken,
      this.accountId,
      range,
      timeIncrement
    );
    return insights.map((i) => this.normalizeInsight(i));
  }

  async getAds(range: DateRangeInput): Promise<UnifiedAd[]> {
    const ads = await fetchMetaAds(this.accessToken, this.accountId, range);
    const unifiedAds = ads.map(metaAdToUnified);

    // Filter out ads that didn't run in the selected period.
    // Meta omits the `insights` field for ads with zero activity in
    // time_range, so metaAdToUnified produced spend/impressions = 0 for
    // those — drop them before any further enrichment to keep the response
    // tight and the cache lean.
    const filteredAds = unifiedAds.filter(
      (ad) => ad.spend > 0 || ad.impressions > 0
    );

    // Resolve carouselImageHashes → URLs in one batched call.
    const allHashes = new Set<string>();
    for (const ad of filteredAds) {
      if (ad.creativeType === "carousel" && ad.carouselImageHashes) {
        ad.carouselImageHashes.forEach((h) => allHashes.add(h));
      }
    }

    if (allHashes.size > 0) {
      const hashToUrl = await resolveImageHashesToUrls(
        this.accessToken,
        this.accountId,
        Array.from(allHashes)
      );

      for (const ad of filteredAds) {
        if (ad.creativeType === "carousel" && ad.carouselImageHashes) {
          const resolved = ad.carouselImageHashes
            .map((h) => hashToUrl.get(h))
            .filter((url): url is string => !!url);

          if (resolved.length >= 2) {
            ad.carouselImages = resolved;
          } else {
            // Couldn't resolve enough URLs — fall back to a regular image ad
            // (image_url from the legacy creative will be used by the UI).
            ad.creativeType = "image";
            ad.carouselImages = undefined;
          }
          delete ad.carouselImageHashes;
        }
      }
    }

    // Enrich catalog ads with their top products (parallel, capped to avoid
    // hitting Meta rate limits on accounts with many catalog ads).
    const catalogAds = filteredAds.filter(
      (ad) => ad.creativeType === "catalog" && ad.productSetId
    );
    // Cap initial eager fetches at 5 (was 10) to keep p95 dashboard loads
    // snappy. Catalog ads beyond this fall back to the smart placeholder; the
    // detail modal can fetch on-demand later if we add that path.
    const catalogAdsToFetch = catalogAds.slice(0, 5);

    const productResults = await Promise.all(
      catalogAdsToFetch.map(async (ad) => {
        if (!ad.productSetId) return { adId: ad.id, products: [] };
        try {
          const products = await getCatalogTopProducts(
            this.accessToken,
            ad.productSetId,
            4
          );
          return { adId: ad.id, products };
        } catch (error) {
          console.warn(
            `[MetaAdapter] Failed to fetch products for ad ${ad.id}`,
            error
          );
          return { adId: ad.id, products: [] };
        }
      })
    );

    const productsByAdId = new Map(
      productResults.map((r) => [r.adId, r.products])
    );

    return filteredAds.map((ad) => {
      if (ad.creativeType === "catalog" && productsByAdId.has(ad.id)) {
        const products = productsByAdId.get(ad.id) ?? [];
        return {
          ...ad,
          catalogProducts: products.map((p) => ({
            id: p.id,
            name: p.name,
            imageUrl: p.image_url,
          })),
        };
      }
      return ad;
    });
  }

  async getAccount(): Promise<UnifiedAccount> {
    if (!this.accountInfo) {
      throw new Error("Meta account info not provided to adapter");
    }
    return {
      id: this.accountId,
      provider: "meta",
      name: this.accountInfo.name,
      currency: this.accountInfo.currency,
      timezone: this.accountInfo.timezone,
      status: "active",
    };
  }

  // Normalize Meta campaign → UnifiedCampaign
  private normalizeCampaign = (campaign: MetaCampaign): UnifiedCampaign => ({
    id: campaign.id,
    provider: "meta",
    name: campaign.name,
    status: campaign.status,
    objective: campaign.objective,
    // Meta returns budgets in cents (smallest currency unit)
    dailyBudget: campaign.daily_budget
      ? parseFloat(campaign.daily_budget) / 100
      : undefined,
    lifetimeBudget: campaign.lifetime_budget
      ? parseFloat(campaign.lifetime_budget) / 100
      : undefined,
    startTime: campaign.start_time,
    stopTime: campaign.stop_time,
    createdTime: campaign.created_time,
    updatedTime: campaign.updated_time,
  });

  // Normalize Meta insight → UnifiedInsight
  private normalizeInsight = (insight: MetaInsight): UnifiedInsight => ({
    campaignId: insight.campaign_id,
    campaignName: insight.campaign_name,
    provider: "meta",
    currency: this.accountInfo?.currency,
    spend: getSpend(insight),
    impressions: getImpressions(insight),
    clicks: getClicks(insight),
    reach: getReach(insight),
    frequency: getFrequency(insight),
    ctr: getCTR(insight),
    cpc: getCPC(insight),
    cpm: getCPM(insight),
    purchases: getPurchaseCount(insight),
    revenue: getRevenue(insight),
    roas: getROAS(insight),
    addToCart: getAddToCartCount(insight),
    initiateCheckout: getInitiateCheckoutCount(insight),
    leads: getLeadCount(insight),
    costPerPurchase: getCostPerPurchase(insight),
    costPerLead: 0, // calculate later if needed
    dateStart: insight.date_start,
    dateStop: insight.date_stop,
    // Meta surfaces purchase counts natively via omni_purchase
    // action_type — no cache map dependency, always authoritative.
    hasConversionData: true,
  });
}
