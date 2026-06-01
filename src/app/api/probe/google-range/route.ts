import { NextResponse } from "next/server";
import { GoogleAdsApi } from "google-ads-api";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getRefreshTokenForUser } from "@/lib/google-ads/credentials";
import { presetToCustomRange } from "@/lib/ads/types";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/**
 * THROWAWAY — Google adapter range-regression diagnostic.
 *
 * Mirrors fetchAds (google-ads/ads.ts:193-246) but runs the GAQL query
 * for 7d + 30d + 90d + lifetime in parallel against the IMAA Google
 * account (5473228670) and returns all values needed to triangulate the
 * data-loss point: query strings, row counts, first-row metric values +
 * their JS types.
 *
 * Hardcoded account_id 5473228670 = IMAA Google account confirmed by
 * the user to have 49,827.66 SAR spend in the last 30 days (Google Ads
 * Manager ground truth, 2026-06-01) yet our dashboard returns data:[]
 * for the 30d window. Lifetime returns data correctly.
 *
 * Auth: standard Supabase SSR. User hits this from their authenticated
 * dashboard session (cookies carry).
 *
 * DELETE after the Google range-regression root cause is identified +
 * fixed. Same throwaway lifecycle as the deleted /api/probe/oembed
 * route (commit 958441e).
 */

const TARGET_CUSTOMER_ID = "5473228670"; // IMAA Google account

const FULL_GAQL_FIELDS = `
  SELECT
    ad_group_ad.ad.id,
    ad_group_ad.ad.type,
    ad_group_ad.status,
    ad_group.id,
    ad_group.name,
    campaign.id,
    campaign.name,
    campaign.status,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions,
    metrics.conversions_value,
    metrics.ctr,
    metrics.average_cpc
`;

const buildQuery = (dateFrom: string, dateTo: string): string =>
  `${FULL_GAQL_FIELDS}
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      AND ad_group_ad.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 10`
    .replace(/\s+/g, " ")
    .trim();

const formatISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// google-ads-api can return BigInt-shaped values for cost_micros on some
// builds; NextResponse.json() chokes on BigInt. Convert defensively.
const safeStringify = (v: unknown): unknown => {
  if (typeof v === "bigint") return v.toString();
  if (v === null || v === undefined) return v;
  if (typeof v === "object") {
    return JSON.parse(
      JSON.stringify(v, (_, val) =>
        typeof val === "bigint" ? val.toString() : val
      )
    );
  }
  return v;
};

const sampleRow = (row: Record<string, unknown>) => {
  const metrics = (row.metrics ?? {}) as Record<string, unknown>;
  const adGroupAd = row.ad_group_ad as
    | { ad?: { id?: unknown } }
    | undefined;
  return {
    ad_id: safeStringify(adGroupAd?.ad?.id ?? null),
    cost_micros_raw: safeStringify(metrics.cost_micros),
    cost_micros_type: typeof metrics.cost_micros,
    impressions_raw: safeStringify(metrics.impressions),
    impressions_type: typeof metrics.impressions,
    clicks_raw: safeStringify(metrics.clicks),
  };
};

interface RangeScenario {
  label: string;
  dateFrom: string;
  dateTo: string;
  query: string;
}

export async function GET() {
  // 1. Supabase SSR auth — user must be logged in to dashboard
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Resolve Google connection + credentials for the HARDCODED IMAA
  //    customer_id (not auto-picked — we're diagnosing this specific
  //    account that has 49,827 SAR of confirmed real spend).
  const adminClient = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: connection } = await adminClient
    .from("connections")
    .select("account_id, metadata")
    .eq("user_id", user.id)
    .eq("platform", "google")
    .eq("account_id", TARGET_CUSTOMER_ID)
    .eq("status", "active")
    .maybeSingle();

  if (!connection) {
    return NextResponse.json(
      {
        error: "no_connection_for_target",
        target_customer_id: TARGET_CUSTOMER_ID,
        message:
          "No active Google connection for the hardcoded IMAA customer_id under this user.",
      },
      { status: 404 }
    );
  }

  const refreshToken = await getRefreshTokenForUser(adminClient, user.id, "google");
  if (!refreshToken) {
    return NextResponse.json({ error: "no_refresh_token" }, { status: 404 });
  }

  const customerId = connection.account_id as string;
  const loginCustomerId = (connection.metadata as Record<string, unknown> | null)
    ?.login_customer_id as string | undefined;

  // 3. Init Google Ads client (same shape as fetchAds at google-ads/ads.ts:200-212)
  const api = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });
  const customer = api.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
  });

  // 4. Build 4 scenarios: 7d, 30d, 90d, lifetime
  const today = new Date();
  const threeYearsAgo = new Date(today);
  threeYearsAgo.setFullYear(today.getFullYear() - 3);

  const range7d = presetToCustomRange("7d");
  const range30d = presetToCustomRange("30d");
  const range90d = presetToCustomRange("90d");

  const scenarios: RangeScenario[] = [
    {
      label: "7d",
      dateFrom: range7d.since,
      dateTo: range7d.until,
      query: buildQuery(range7d.since, range7d.until),
    },
    {
      label: "30d",
      dateFrom: range30d.since,
      dateTo: range30d.until,
      query: buildQuery(range30d.since, range30d.until),
    },
    {
      label: "90d",
      dateFrom: range90d.since,
      dateTo: range90d.until,
      query: buildQuery(range90d.since, range90d.until),
    },
    {
      label: "lifetime",
      dateFrom: formatISO(threeYearsAgo),
      dateTo: formatISO(today),
      query: buildQuery(formatISO(threeYearsAgo), formatISO(today)),
    },
  ];

  // 5. Execute all 4 in parallel
  type Outcome = {
    rows: Record<string, unknown>[] | null;
    error: string | null;
  };
  const runQuery = async (q: string): Promise<Outcome> => {
    try {
      const rows = await customer.query(q);
      return {
        rows: rows as unknown as Record<string, unknown>[],
        error: null,
      };
    } catch (err) {
      return {
        rows: null,
        error: err instanceof Error ? err.message.slice(0, 400) : String(err),
      };
    }
  };

  const outcomes = await Promise.all(scenarios.map((s) => runQuery(s.query)));

  // 6. Compose structured diagnostic JSON
  const results = scenarios.map((s, i) => {
    const o = outcomes[i];
    return {
      label: s.label,
      dateFrom: s.dateFrom,
      dateTo: s.dateTo,
      query: s.query,
      rowsReturned: o.rows?.length ?? null,
      firstRows: o.rows?.slice(0, 3).map(sampleRow) ?? null,
      error: o.error,
    };
  });

  return NextResponse.json({
    customerId,
    loginCustomerId: loginCustomerId ?? null,
    today: formatISO(today),
    scenarios: results,
  });
}
