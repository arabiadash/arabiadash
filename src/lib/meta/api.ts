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

// DateRange, TimeIncrement, CustomDateRange, DateRangeInput are defined in
// @/lib/ads/types. Re-exported here for backward compatibility.
import {
  type DateRange,
  type TimeIncrement,
  type CustomDateRange,
  type DateRangeInput,
  isCustomRange,
} from "@/lib/ads/types";
export type { DateRange, TimeIncrement, CustomDateRange, DateRangeInput };
export { isCustomRange };

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

// Apply either date_preset (for preset DateRange) or time_range (for CustomDateRange)
// to the given URLSearchParams, in the format Meta's Marketing API expects.
function applyRangeToParams(
  params: URLSearchParams,
  range: DateRangeInput
): void {
  if (isCustomRange(range)) {
    params.set(
      "time_range",
      JSON.stringify({ since: range.since, until: range.until })
    );
  } else {
    params.set("date_preset", DATE_PRESETS[range]);
  }
}

export async function getAccountInsights(
  accessToken: string,
  accountId: string,
  range: DateRangeInput = "30d",
  timeIncrement?: TimeIncrement
): Promise<MetaInsight[]> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights`;
  const params = new URLSearchParams({
    fields:
      "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values",
    access_token: accessToken,
  });

  applyRangeToParams(params, range);

  if (timeIncrement) {
    params.set("time_increment", String(timeIncrement));
  }

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
  range: DateRangeInput = "30d",
  timeIncrement?: TimeIncrement
): Promise<MetaInsight[]> {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights`;
  const params = new URLSearchParams({
    fields:
      "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values",
    level: "campaign",
    access_token: accessToken,
  });

  applyRangeToParams(params, range);

  if (timeIncrement) {
    params.set("time_increment", String(timeIncrement));
  }

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
