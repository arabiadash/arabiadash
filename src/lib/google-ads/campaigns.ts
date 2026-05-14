import { GoogleAdsApi } from "google-ads-api";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

// google-ads-api@23 returns enum fields as integer protobuf values rather
// than string names. We translate to the standard string names the rest of
// the app expects.
// Ref: https://developers.google.com/google-ads/api/reference/rpc/v18/CampaignStatusEnum.CampaignStatus
const CAMPAIGN_STATUS_MAP: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "ENABLED",
  3: "PAUSED",
  4: "REMOVED",
};

const CAMPAIGN_TYPE_MAP: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "SEARCH",
  3: "DISPLAY",
  4: "SHOPPING",
  5: "HOTEL",
  6: "VIDEO",
  7: "MULTI_CHANNEL",
  8: "LOCAL",
  9: "SMART",
  10: "PERFORMANCE_MAX",
  11: "LOCAL_SERVICES",
  12: "DISCOVERY",
  13: "TRAVEL",
};

function mapCampaignStatus(value: unknown): string {
  const num = Number(value);
  return CAMPAIGN_STATUS_MAP[num] ?? "UNKNOWN";
}

function mapCampaignType(value: unknown): string {
  const num = Number(value);
  return CAMPAIGN_TYPE_MAP[num] ?? "UNKNOWN";
}

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  type: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  cpc: number;
  roas: number;
}

export interface CampaignTotals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  cpc: number;
  roas: number;
}

export interface FetchCampaignsResult {
  campaigns: CampaignRow[];
  totals: CampaignTotals;
}

export interface FetchCampaignsOptions {
  customerId: string;
  refreshToken: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  /**
   * If the account is linked to our MCC, pass it here as login_customer_id.
   * If standalone (manager_customer_id is null in DB), omit this option.
   */
  loginCustomerId?: string;
}

/**
 * Fetch campaign-level performance for a Google Ads account over a date
 * window. Returns aggregated totals alongside per-campaign rows. Returns
 * null on auth/permission errors so the caller can treat the account as
 * "not accessible right now" rather than failing the whole batch.
 *
 * Date inputs must already be validated as YYYY-MM-DD before reaching here
 * — they're interpolated into the GAQL query and not escaped.
 */
export async function fetchCampaigns(
  options: FetchCampaignsOptions
): Promise<FetchCampaignsResult | null> {
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

  // GAQL doesn't support OR / parentheses in WHERE, so we can't express
  // "keep REMOVED rows that still spent in the window". Drop all REMOVED
  // campaigns here; if we need historical reporting for removed-with-spend
  // later, filter client-side after a separate query.
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${options.dateFrom}' AND '${options.dateTo}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `;

  try {
    const rows = await customer.query(query);

    const campaigns: CampaignRow[] = rows.map((row) => {
      const spend = Number(row.metrics?.cost_micros ?? 0) / 1_000_000;
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const conversions = Number(row.metrics?.conversions ?? 0);
      const revenue = Number(row.metrics?.conversions_value ?? 0);
      const ctr = Number(row.metrics?.ctr ?? 0);
      const cpc = Number(row.metrics?.average_cpc ?? 0) / 1_000_000;
      const roas = spend > 0 ? revenue / spend : 0;

      return {
        id: String(row.campaign?.id ?? ""),
        name: String(row.campaign?.name ?? ""),
        status: mapCampaignStatus(row.campaign?.status),
        type: mapCampaignType(row.campaign?.advertising_channel_type),
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
    const totals: CampaignTotals = campaigns.reduce(
      (acc, c) => ({
        spend: acc.spend + c.spend,
        impressions: acc.impressions + c.impressions,
        clicks: acc.clicks + c.clicks,
        conversions: acc.conversions + c.conversions,
        revenue: acc.revenue + c.revenue,
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

    return { campaigns, totals };
  } catch {
    return null;
  }
}
