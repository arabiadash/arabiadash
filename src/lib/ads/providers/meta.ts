import {
  type AdProviderAdapter,
  type UnifiedCampaign,
  type UnifiedInsight,
  type UnifiedAccount,
  type DateRangeInput,
  type TimeIncrement,
} from "../types";
import {
  getCampaigns as fetchMetaCampaigns,
  getAccountInsights as fetchMetaAccountInsights,
  getCampaignInsights as fetchMetaCampaignInsights,
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
  });
}
