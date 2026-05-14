import { GoogleAdsApi } from "google-ads-api";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  cpc: number;
  roas: number;
}

export interface FetchTimeSeriesOptions {
  customerId: string;
  refreshToken: string;
  dateFrom: string; // YYYY-MM-DD — caller MUST validate
  dateTo: string; // YYYY-MM-DD — caller MUST validate
  /** Pass MCC ID for accounts linked to our manager. Omit for standalone. */
  loginCustomerId?: string;
}

/**
 * Increment a YYYY-MM-DD string by one day. We build the Date in UTC so
 * local-timezone offsets never shift the day. Pure string in / string out.
 */
function nextDay(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Fetch daily account-level performance for a Google Ads customer.
 *
 * Returns one point per day in [dateFrom, dateTo] inclusive. Days with no
 * activity are filled with zero metrics — GAQL omits them, but charts
 * need a continuous series.
 *
 * Caller MUST validate dateFrom/dateTo as YYYY-MM-DD before invoking — the
 * values are interpolated into GAQL and not escaped.
 *
 * Returns null on auth/permission errors so the caller can treat the
 * account as "not accessible right now".
 */
export async function fetchTimeSeries(
  options: FetchTimeSeriesOptions
): Promise<TimeSeriesPoint[] | null> {
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

  // Account-level query — FROM customer means "the account itself",
  // aggregated across all campaigns/ads, segmented by day. For per-campaign
  // or per-ad time series, use a different fetcher.
  const query = `
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${options.dateFrom}' AND '${options.dateTo}'
    ORDER BY segments.date ASC
  `;

  try {
    const rows = await customer.query(query);

    // Index actual data by date for O(1) lookup during gap-fill below.
    const byDate = new Map<string, TimeSeriesPoint>();
    for (const row of rows) {
      const date = String(row.segments?.date ?? "");
      if (!date) continue;

      const spend = Number(row.metrics?.cost_micros ?? 0) / 1_000_000;
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const conversions = Number(row.metrics?.conversions ?? 0);
      const revenue = Number(row.metrics?.conversions_value ?? 0);

      const ctr = impressions > 0 ? clicks / impressions : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      const roas = spend > 0 ? revenue / spend : 0;

      byDate.set(date, {
        date,
        spend,
        impressions,
        clicks,
        conversions,
        revenue,
        ctr,
        cpc,
        roas,
      });
    }

    // Walk every day in [dateFrom, dateTo] and fill missing days with zeros
    // so the consumer can chart a continuous series.
    const series: TimeSeriesPoint[] = [];
    let cursor = options.dateFrom;
    let safety = 0; // belt-and-suspenders against infinite loops in nextDay

    while (cursor <= options.dateTo && safety < 1000) {
      const existing = byDate.get(cursor);
      if (existing) {
        series.push(existing);
      } else {
        series.push({
          date: cursor,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0,
          ctr: 0,
          cpc: 0,
          roas: 0,
        });
      }
      cursor = nextDay(cursor);
      safety++;
    }

    return series;
  } catch {
    return null;
  }
}
