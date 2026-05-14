import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getAdapterForProvider,
  isMultiAccountProvider,
} from "@/lib/ads/factory";
import {
  getCachedDataSWR,
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

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes("80004") ||
    msg.includes("User request limit reached") ||
    msg.includes("rate limit") ||
    msg.includes("Application request limit reached")
  );
}

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
    const accountId =
      request.nextUrl.searchParams.get("account_id") ?? undefined;
    const forceRefresh =
      request.nextUrl.searchParams.get("refresh") === "true";

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: "invalid_provider", supported: VALID_PROVIDERS },
        { status: 400 }
      );
    }

    // Multi-account providers (Google) require account_id explicitly —
    // the user has many active connections and we can't pick one for them.
    if (isMultiAccountProvider(provider) && !accountId) {
      return NextResponse.json(
        {
          error: "account_id_required",
          message: `${provider} requires account_id parameter (the account/customer ID)`,
        },
        { status: 400 }
      );
    }

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

    const adapter = await getAdapterForProvider(user.id, provider, accountId);
    if (!adapter) {
      return NextResponse.json(
        { error: "no_connection", provider },
        { status: 404 }
      );
    }

    let connectionQuery = supabase
      .from("connections")
      .select("id")
      .eq("user_id", user.id)
      .eq("platform", provider)
      .eq("status", "active");

    if (accountId) {
      connectionQuery = connectionQuery.eq("account_id", accountId);
    }

    const { data: connection } = await connectionQuery.maybeSingle();

    if (!connection) {
      return NextResponse.json({ error: "no_connection" }, { status: 404 });
    }

    const cacheKey = `insights:${level}:${cacheKeyRangePart}${
      timeIncrement ? `:t${timeIncrement}` : ""
    }`;

    const fetchInsights = async (): Promise<UnifiedInsight[]> => {
      if (level === "campaign") {
        return adapter.getCampaignInsights(range, timeIncrement);
      }
      return adapter.getAccountInsights(range, timeIncrement);
    };

    // 1. Force refresh.
    if (forceRefresh) {
      try {
        const insights = await fetchInsights();
        await setCachedData(connection.id, provider, cacheKey, insights);
        return NextResponse.json({
          data: insights,
          source: "fresh",
          fetchedAt: new Date().toISOString(),
          revalidating: false,
          range,
          level,
          provider,
        });
      } catch (err) {
        const cached = await getCachedDataSWR<UnifiedInsight[]>(
          connection.id,
          provider,
          cacheKey
        );
        if (cached && isRateLimitError(err)) {
          return NextResponse.json({
            data: cached.data,
            source: "rate-limited",
            fetchedAt: cached.fetchedAt.toISOString(),
            revalidating: false,
            range,
            level,
            provider,
            warning: "rate_limited_serving_cache",
          });
        }
        throw err;
      }
    }

    // 2. Cache lookup.
    const cached = await getCachedDataSWR<UnifiedInsight[]>(
      connection.id,
      provider,
      cacheKey
    );

    // 3. Fresh hit.
    if (cached?.status === "fresh") {
      return NextResponse.json({
        data: cached.data,
        source: "cache-fresh",
        fetchedAt: cached.fetchedAt.toISOString(),
        revalidating: false,
        range,
        level,
        provider,
      });
    }

    // 4. Stale hit — serve stale, refresh in background.
    if (cached?.status === "stale") {
      after(async () => {
        try {
          const insights = await fetchInsights();
          await setCachedData(connection.id, provider, cacheKey, insights);
        } catch (bgErr) {
          console.warn(
            "[ads/insights] Background revalidation failed",
            bgErr
          );
        }
      });

      return NextResponse.json({
        data: cached.data,
        source: "cache-stale",
        fetchedAt: cached.fetchedAt.toISOString(),
        revalidating: true,
        range,
        level,
        provider,
      });
    }

    // 5. Cache miss.
    try {
      const insights = await fetchInsights();
      await setCachedData(connection.id, provider, cacheKey, insights);
      return NextResponse.json({
        data: insights,
        source: "fresh",
        fetchedAt: new Date().toISOString(),
        revalidating: false,
        range,
        level,
        provider,
      });
    } catch (err) {
      // 6. Graceful fallback.
      if (isRateLimitError(err)) {
        return NextResponse.json(
          {
            error: "rate_limited",
            message:
              "Meta API rate limit reached and no cached data available. Please retry in a few minutes.",
            provider,
          },
          { status: 429 }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("[ads/insights] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
