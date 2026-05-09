import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getAccountInsights,
  getCampaignInsights,
  type DateRange,
  type MetaInsight,
} from "@/lib/meta/api";
import { getCachedData, setCachedData } from "@/lib/meta/cache";

const VALID_RANGES: readonly DateRange[] = [
  "7d",
  "14d",
  "30d",
  "90d",
  "lifetime",
] as const;

type InsightLevel = "account" | "campaign";

export async function GET(request: NextRequest) {
  try {
    const rangeParam = request.nextUrl.searchParams.get("range");
    const levelParam = request.nextUrl.searchParams.get("level");

    const range: DateRange =
      rangeParam && VALID_RANGES.includes(rangeParam as DateRange)
        ? (rangeParam as DateRange)
        : "30d";

    const level: InsightLevel =
      levelParam === "campaign" ? "campaign" : "account";

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: connection, error: connError } = await supabase
      .from("connections")
      .select("id, account_id, access_token")
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .eq("status", "active")
      .single();

    if (connError || !connection) {
      return NextResponse.json(
        { error: "no_meta_connection" },
        { status: 404 }
      );
    }

    const cacheKey = `insights:${level}:${range}`;

    const cached = await getCachedData<MetaInsight[]>(connection.id, cacheKey);
    if (cached) {
      return NextResponse.json({
        data: cached,
        cached: true,
        range,
        level,
      });
    }

    const insights =
      level === "campaign"
        ? await getCampaignInsights(
            connection.access_token,
            connection.account_id,
            range
          )
        : await getAccountInsights(
            connection.access_token,
            connection.account_id,
            range
          );

    await setCachedData(connection.id, cacheKey, insights);

    return NextResponse.json({
      data: insights,
      cached: false,
      range,
      level,
    });
  } catch (err) {
    console.error("[meta/insights] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
