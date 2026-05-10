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
  presetToCustomRange,
} from "@/lib/ads/types";
export type { DateRange, TimeIncrement, CustomDateRange, DateRangeInput };
export { isCustomRange };

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

const INSIGHTS_FIELDS =
  "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,date_start,date_stop,campaign_id,campaign_name";

function formatLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Splits a date range into chunks of `chunkDays` (max 30 by default).
 * Meta's Insights endpoint silently truncates daily breakdowns over long
 * ranges, so we issue one request per chunk and merge the results.
 */
function chunkDateRange(
  since: string,
  until: string,
  chunkDays: number = 30
): Array<{ since: string; until: string }> {
  const chunks: Array<{ since: string; until: string }> = [];
  const startDate = new Date(since);
  const endDate = new Date(until);

  let currentStart = new Date(startDate);

  while (currentStart <= endDate) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentStart.getDate() + chunkDays - 1);

    const effectiveEnd = currentEnd > endDate ? endDate : currentEnd;

    chunks.push({
      since: formatLocalISO(currentStart),
      until: formatLocalISO(effectiveEnd),
    });

    currentStart = new Date(effectiveEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }

  return chunks;
}

/**
 * Resolve a DateRangeInput to an explicit since/until pair.
 * Returns null for 'lifetime' (caller should use date_preset=maximum instead).
 *
 * Delegates non-lifetime preset → since/until conversion to presetToCustomRange
 * (single source of truth in @/lib/ads/types).
 */
function resolveRangeToDates(
  range: DateRangeInput
): { since: string; until: string } | null {
  if (isCustomRange(range)) {
    return { since: range.since, until: range.until };
  }
  if (range === "lifetime") return null;

  const customRange = presetToCustomRange(range);
  return { since: customRange.since, until: customRange.until };
}

/**
 * Internal fetcher used by both getAccountInsights and getCampaignInsights.
 * Handles range resolution, lifetime fast-path, and chunked daily breakdown.
 */
async function fetchInsightsChunked(
  accessToken: string,
  accountId: string,
  range: DateRangeInput,
  timeIncrement: TimeIncrement | undefined,
  level: "account" | "campaign"
): Promise<MetaInsight[]> {
  const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights`;

  // Lifetime: don't chunk — let Meta return its `maximum` aggregate.
  if (!isCustomRange(range) && range === "lifetime") {
    const params = new URLSearchParams({
      fields: INSIGHTS_FIELDS,
      access_token: accessToken,
      date_preset: "maximum",
      limit: "500",
    });
    if (level === "campaign") params.set("level", "campaign");
    if (timeIncrement) params.set("time_increment", String(timeIncrement));

    const response = await fetch(`${baseUrl}?${params.toString()}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch insights (lifetime): ${response.status} ${errorText}`
      );
    }
    const result = (await response.json()) as InsightsResponse;
    return result.data ?? [];
  }

  const dates = resolveRangeToDates(range);
  if (!dates) {
    // Should be unreachable (lifetime handled above), but be safe.
    return [];
  }

  // Daily breakdown → chunk; aggregate → single request for the whole range.
  const chunks =
    timeIncrement === 1
      ? chunkDateRange(dates.since, dates.until, 30)
      : [{ since: dates.since, until: dates.until }];

  const fetchPromises = chunks.map(async (chunk) => {
    const params = new URLSearchParams({
      fields: INSIGHTS_FIELDS,
      access_token: accessToken,
      time_range: JSON.stringify({
        since: chunk.since,
        until: chunk.until,
      }),
      limit: "500",
    });
    if (level === "campaign") params.set("level", "campaign");
    if (timeIncrement) params.set("time_increment", String(timeIncrement));

    const response = await fetch(`${baseUrl}?${params.toString()}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch insights chunk ${chunk.since}-${chunk.until}: ${response.status} ${errorText}`
      );
    }
    const result = (await response.json()) as InsightsResponse;
    return Array.isArray(result.data) ? result.data : [];
  });

  const results = await Promise.all(fetchPromises);
  const allInsights = results.flat();
  allInsights.sort((a, b) =>
    (a.date_start || "").localeCompare(b.date_start || "")
  );

  return allInsights;
}

export async function getAccountInsights(
  accessToken: string,
  accountId: string,
  range: DateRangeInput = "30d",
  timeIncrement?: TimeIncrement
): Promise<MetaInsight[]> {
  return fetchInsightsChunked(
    accessToken,
    accountId,
    range,
    timeIncrement,
    "account"
  );
}

export async function getCampaignInsights(
  accessToken: string,
  accountId: string,
  range: DateRangeInput = "30d",
  timeIncrement?: TimeIncrement
): Promise<MetaInsight[]> {
  return fetchInsightsChunked(
    accessToken,
    accountId,
    range,
    timeIncrement,
    "campaign"
  );
}
