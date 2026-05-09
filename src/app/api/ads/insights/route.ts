import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdapterForProvider } from "@/lib/ads/factory";
import {
  getCachedData,
  setCachedData,
  type AdProvider,
} from "@/lib/ads/cache";
import type {
  DateRange,
  DateRangeInput,
  TimeIncrement,
  InsightLevel,
  UnifiedInsight,
} from "@/lib/ads/types";

const VALID_RANGES: readonly DateRange[] = [
  "7d",
  "14d",
  "30d",
  "90d",
  "lifetime",
] as const;

const VALID_PROVIDERS: readonly AdProvider[] = [
  "meta",
  "google",
  "tiktok",
  "snapchat",
] as const;

export async function GET(request: NextRequest) {
  try {
    const provider = (request.nextUrl.searchParams.get("provider") ||
      "meta") as AdProvider;
    const rangeParam = request.nextUrl.searchParams.get("range");
    const levelParam = request.nextUrl.searchParams.get("level");
    const timeIncrementParam =
      request.nextUrl.searchParams.get("time_increment");
    const sinceParam = request.nextUrl.searchParams.get("since");
    const untilParam = request.nextUrl.searchParams.get("until");

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: "invalid_provider", supported: VALID_PROVIDERS },
        { status: 400 }
      );
    }

    // Parse range: custom (since/until) takes precedence over preset (range)
    const isValidISODate = (s: string): boolean =>
      /^\d{4}-\d{2}-\d{2}$/.test(s);

    let range: DateRangeInput;
    let cacheKeyRangePart: string;

    if (sinceParam && untilParam) {
      if (!isValidISODate(sinceParam) || !isValidISODate(untilParam)) {
        return NextResponse.json(
          { error: "invalid_date_format", message: "Use YYYY-MM-DD" },
          { status: 400 }
        );
      }

      if (sinceParam > untilParam) {
        return NextResponse.json(
          { error: "invalid_date_range", message: "since must be <= until" },
          { status: 400 }
        );
      }

      const sinceDate = new Date(sinceParam);
      const untilDate = new Date(untilParam);
      const monthsDiff =
        (untilDate.getTime() - sinceDate.getTime()) /
        (1000 * 60 * 60 * 24 * 30);
      if (monthsDiff > 37) {
        return NextResponse.json(
          { error: "date_range_too_long", message: "Max range is 37 months" },
          { status: 400 }
        );
      }

      range = { since: sinceParam, until: untilParam };
      cacheKeyRangePart = `custom:${sinceParam}:${untilParam}`;
    } else {
      const presetRange: DateRange =
        rangeParam && VALID_RANGES.includes(rangeParam as DateRange)
          ? (rangeParam as DateRange)
          : "30d";
      range = presetRange;
      cacheKeyRangePart = presetRange;
    }

    const level: InsightLevel =
      levelParam === "campaign"
        ? "campaign"
        : levelParam === "adset"
          ? "adset"
          : levelParam === "ad"
            ? "ad"
            : "account";

    const timeIncrement: TimeIncrement | undefined =
      timeIncrementParam === "1"
        ? 1
        : timeIncrementParam === "7"
          ? 7
          : timeIncrementParam === "all_days"
            ? "all_days"
            : undefined;

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const adapter = await getAdapterForProvider(user.id, provider);
    if (!adapter) {
      return NextResponse.json(
        { error: "no_connection", provider },
        { status: 404 }
      );
    }

    const { data: connection } = await supabase
      .from("connections")
      .select("id")
      .eq("user_id", user.id)
      .eq("platform", provider)
      .eq("status", "active")
      .maybeSingle();

    if (!connection) {
      return NextResponse.json({ error: "no_connection" }, { status: 404 });
    }

    const cacheKey = `insights:${level}:${cacheKeyRangePart}${
      timeIncrement ? `:t${timeIncrement}` : ""
    }`;

    const cached = await getCachedData<UnifiedInsight[]>(
      connection.id,
      provider,
      cacheKey
    );
    if (cached) {
      return NextResponse.json({
        data: cached,
        cached: true,
        range,
        level,
        provider,
      });
    }

    let insights: UnifiedInsight[];
    if (level === "campaign") {
      insights = await adapter.getCampaignInsights(range, timeIncrement);
    } else {
      insights = await adapter.getAccountInsights(range, timeIncrement);
    }

    await setCachedData(connection.id, provider, cacheKey, insights);

    return NextResponse.json({
      data: insights,
      cached: false,
      range,
      level,
      provider,
    });
  } catch (err) {
    console.error("[ads/insights] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
