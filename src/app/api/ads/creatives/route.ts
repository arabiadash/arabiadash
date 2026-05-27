import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getAdapterForProvider,
  isMultiAccountProvider,
} from "@/lib/ads/factory";
import {
  getCachedCreatives,
  setCachedCreatives,
  type AdProvider,
} from "@/lib/ads/cache";
import type {
  DateRange,
  DateRangeInput,
  UnifiedAd,
} from "@/lib/ads/types";
import { isReauthError, ReauthRequiredError } from "@/lib/google-ads/errors";

const VALID_PROVIDERS: readonly AdProvider[] = [
  "meta",
  "google",
  "tiktok",
  "snapchat",
] as const;

const VALID_RANGES: readonly DateRange[] = [
  "today",
  "yesterday",
  "7d",
  "14d",
  "this_month",
  "last_month",
  "30d",
  "90d",
  "lifetime",
] as const;

const isValidISODate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

function parseRangeFromParams(
  searchParams: URLSearchParams
): DateRangeInput | { error: string; status: number } {
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  if (since && until) {
    if (!isValidISODate(since) || !isValidISODate(until)) {
      return { error: "invalid_date_format", status: 400 };
    }
    if (since > until) {
      return { error: "invalid_date_range", status: 400 };
    }
    const days =
      (new Date(until).getTime() - new Date(since).getTime()) /
      (1000 * 60 * 60 * 24);
    if (days / 30 > 37) {
      return { error: "date_range_too_long", status: 400 };
    }
    return { since, until };
  }

  const rangeParam = searchParams.get("range");
  if (rangeParam && VALID_RANGES.includes(rangeParam as DateRange)) {
    return rangeParam as DateRange;
  }
  return "30d";
}

function rangeToCacheKey(range: DateRangeInput): string {
  return typeof range === "string" ? range : `custom:${range.since}:${range.until}`;
}

// Meta rate-limit (code 80004) bubbles up as an Error whose message contains
// the upstream JSON. Detect it conservatively by string match.
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
  // [perf-recon] M9 post-ship 2-min load investigation. Remove after
  // bottleneck identified + fix shipped. Tagged for grep.
  const perf_t0 = performance.now();
  const perf_reqId = Math.random().toString(36).slice(2, 8);
  try {
    const provider = (request.nextUrl.searchParams.get("provider") ||
      "meta") as AdProvider;

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: "invalid_provider", supported: VALID_PROVIDERS },
        { status: 400 }
      );
    }

    const accountId =
      request.nextUrl.searchParams.get("account_id") ?? undefined;

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

    const parsed = parseRangeFromParams(request.nextUrl.searchParams);
    if (typeof parsed === "object" && "error" in parsed) {
      return NextResponse.json(
        { error: parsed.error },
        { status: parsed.status }
      );
    }

    const forceRefresh =
      request.nextUrl.searchParams.get("refresh") === "true";

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Dev-only test injection (ADR-017): header x-fake-error:
    // invalid_grant triggers ReauthRequiredError for CTA propagation
    // testing. Permanently safe — NODE_ENV !== "production" guard +
    // non-standard header name. DO NOT REMOVE; reusable for future
    // reauth-flow regression testing.
    if (
      process.env.NODE_ENV !== "production" &&
      request.headers.get("x-fake-error") === "invalid_grant"
    ) {
      throw new ReauthRequiredError("invalid_grant");
    }

    const perf_t_adapter_start = performance.now();
    const adapter = await getAdapterForProvider(user.id, provider, accountId);
    if (!adapter) {
      return NextResponse.json(
        { error: "no_connection", provider },
        { status: 404 }
      );
    }
    console.log(
      `[perf-recon][${perf_reqId}] adapter_init ${(performance.now() - perf_t_adapter_start).toFixed(0)}ms provider=${provider}`
    );

    // We need the account_id (string, e.g. act_123) for the creatives_cache key.
    // The adapter has it but doesn't expose it; resolve via the connection row.
    let connQuery = supabase
      .from("connections")
      .select("account_id")
      .eq("user_id", user.id)
      .eq("platform", provider)
      .eq("status", "active");

    if (accountId) {
      connQuery = connQuery.eq("account_id", accountId);
    }

    const { data: connection } = await connQuery
      .maybeSingle();

    if (!connection) {
      return NextResponse.json({ error: "no_connection" }, { status: 404 });
    }

    const dateRange = rangeToCacheKey(parsed);
    const cacheParams = {
      userId: user.id,
      provider,
      accountId: connection.account_id as string,
      dateRange,
    };

    // 1. Force refresh: skip cache, fetch fresh, write back.
    if (forceRefresh) {
      try {
        const perf_t_getAds_start = performance.now();
        const ads = await adapter.getAds(parsed);
        console.log(
          `[perf-recon][${perf_reqId}] adapter_getAds ${(performance.now() - perf_t_getAds_start).toFixed(0)}ms path=force-refresh ads_count=${ads.length}`
        );
        const perf_t_cache_start = performance.now();
        await setCachedCreatives({ ...cacheParams, data: ads });
        console.log(
          `[perf-recon][${perf_reqId}] cache_write ${(performance.now() - perf_t_cache_start).toFixed(0)}ms`
        );
        const perf_payload = JSON.stringify(ads);
        const perf_total_kw = ads.reduce(
          (s, a) =>
            s +
            ("keywords" in a && Array.isArray(a.keywords)
              ? a.keywords.length
              : 0),
          0
        );
        const perf_total_st = ads.reduce(
          (s, a) =>
            s +
            ("searchTerms" in a && Array.isArray(a.searchTerms)
              ? a.searchTerms.length
              : 0),
          0
        );
        console.log(
          `[perf-recon][${perf_reqId}] payload_size=${perf_payload.length}B (${(perf_payload.length / 1024).toFixed(0)}KB) ads_count=${ads.length} total_keywords=${perf_total_kw} total_search_terms=${perf_total_st}`
        );
        console.log(
          `[perf-recon][${perf_reqId}] TOTAL ${(performance.now() - perf_t0).toFixed(0)}ms path=force-refresh`
        );
        return NextResponse.json({
          data: ads,
          source: "fresh",
          fetchedAt: new Date().toISOString(),
          revalidating: false,
          provider,
          range: parsed,
        });
      } catch (err) {
        // Even on force refresh, fall back to stale if available.
        const cached = await getCachedCreatives<UnifiedAd[]>(cacheParams);
        if (cached && isRateLimitError(err)) {
          return NextResponse.json(
            {
              data: cached.data,
              source: "rate-limited",
              fetchedAt: cached.fetchedAt.toISOString(),
              revalidating: false,
              provider,
              range: parsed,
              warning: "rate_limited_serving_cache",
            },
            { status: 200 }
          );
        }
        throw err;
      }
    }

    // 2. Cache lookup.
    const cached = await getCachedCreatives<UnifiedAd[]>(cacheParams);

    // 3. Fresh hit — return immediately, no work in background.
    if (cached?.status === "fresh") {
      return NextResponse.json({
        data: cached.data,
        source: "cache-fresh",
        fetchedAt: cached.fetchedAt.toISOString(),
        revalidating: false,
        provider,
        range: parsed,
      });
    }

    // 4. Stale hit — return stale, kick off background refresh.
    if (cached?.status === "stale") {
      after(async () => {
        try {
          const ads = await adapter.getAds(parsed);
          await setCachedCreatives({ ...cacheParams, data: ads });
        } catch (bgErr) {
          console.warn(
            "[ads/creatives] Background revalidation failed",
            bgErr
          );
        }
      });

      return NextResponse.json({
        data: cached.data,
        source: "cache-stale",
        fetchedAt: cached.fetchedAt.toISOString(),
        revalidating: true,
        provider,
        range: parsed,
      });
    }

    // 5. Cache miss — fetch synchronously.
    try {
      const perf_t_getAds_start = performance.now();
      const ads = await adapter.getAds(parsed);
      console.log(
        `[perf-recon][${perf_reqId}] adapter_getAds ${(performance.now() - perf_t_getAds_start).toFixed(0)}ms path=cache-miss ads_count=${ads.length}`
      );
      const perf_t_cache_start = performance.now();
      await setCachedCreatives({ ...cacheParams, data: ads });
      console.log(
        `[perf-recon][${perf_reqId}] cache_write ${(performance.now() - perf_t_cache_start).toFixed(0)}ms`
      );
      const perf_payload = JSON.stringify(ads);
      const perf_total_kw = ads.reduce(
        (s, a) =>
          s +
          ("keywords" in a && Array.isArray(a.keywords) ? a.keywords.length : 0),
        0
      );
      const perf_total_st = ads.reduce(
        (s, a) =>
          s +
          ("searchTerms" in a && Array.isArray(a.searchTerms)
            ? a.searchTerms.length
            : 0),
        0
      );
      console.log(
        `[perf-recon][${perf_reqId}] payload_size=${perf_payload.length}B (${(perf_payload.length / 1024).toFixed(0)}KB) ads_count=${ads.length} total_keywords=${perf_total_kw} total_search_terms=${perf_total_st}`
      );
      console.log(
        `[perf-recon][${perf_reqId}] TOTAL ${(performance.now() - perf_t0).toFixed(0)}ms path=cache-miss`
      );
      return NextResponse.json({
        data: ads,
        source: "fresh",
        fetchedAt: new Date().toISOString(),
        revalidating: false,
        provider,
        range: parsed,
      });
    } catch (err) {
      // 6. Graceful fallback: rate-limited with no cache → 429.
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
    // ADR-017: surface reauth requirement as actionable 401 instead of 500.
    if (isReauthError(err)) {
      return NextResponse.json(
        {
          error: "reauth_required",
          provider: err.provider,
          reason: err.reason,
          reauthUrl: err.reauthUrl,
          message: "انتهت صلاحية ربط حساب Google. يرجى إعادة الربط للمتابعة.",
        },
        { status: 401 }
      );
    }
    console.error("[ads/creatives] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
