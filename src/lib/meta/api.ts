import { META_API_VERSION, type MetaAdAccount } from "./oauth";

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

export type DateRange = "7d" | "14d" | "30d" | "90d" | "lifetime";

const DATE_PRESETS: Record<DateRange, string> = {
  "7d": "last_7d",
  "14d": "last_14d",
  "30d": "last_30d",
  "90d": "last_90d",
  lifetime: "maximum",
};

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

export async function getAccountInsights(
  accessToken: string,
  accountId: string,
  dateRange: DateRange = "30d"
): Promise<MetaInsight[]> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights`;
  const params = new URLSearchParams({
    fields:
      "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values",
    date_preset: DATE_PRESETS[dateRange],
    access_token: accessToken,
  });

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch insights: ${response.status} ${errorText}`
    );
  }

  const result = (await response.json()) as InsightsResponse;
  return result.data;
}

export async function getCampaignInsights(
  accessToken: string,
  accountId: string,
  dateRange: DateRange = "30d"
): Promise<MetaInsight[]> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights`;
  const params = new URLSearchParams({
    fields:
      "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values",
    date_preset: DATE_PRESETS[dateRange],
    level: "campaign",
    access_token: accessToken,
  });

  const response = await fetch(`${url}?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch campaign insights: ${response.status} ${errorText}`
    );
  }

  const result = (await response.json()) as InsightsResponse;
  return result.data;
}
