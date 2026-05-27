import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdapterForProvider } from "@/lib/ads/factory";
import {
  getCachedCreatives,
  setCachedCreatives,
} from "@/lib/ads/cache";
import type {
  DateRange,
  DateRangeInput,
  UnifiedAdKeyword,
} from "@/lib/ads/types";
import { isReauthError } from "@/lib/google-ads/errors";

/**
 * ADR-019 (M9.1) — per-ad_group keywords lazy fetch.
 *
 * Mirrors /api/ads/search-terms route shape exactly. Surfaced on
 * demand when a user opens an AdDetailModal. Removes keywords from
 * the eager /api/ads/creatives payload (latent 6× inflation bug
 * class for accounts with 5,000+ keywords).
 *
 * Cache key: ${user_id}:google:${account_id}:${dateRange}:keywords:
 * ${ad_group_id}. Same SWR fresh/stale semantics.
 */

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

export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get("account_id");
    const adGroupId = request.nextUrl.searchParams.get("ad_group_id");

    if (!accountId) {
      return NextResponse.json(
        { error: "account_id_required" },
        { status: 400 }
      );
    }
    if (!adGroupId) {
      return NextResponse.json(
        { error: "ad_group_id_required" },
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

    const adapter = await getAdapterForProvider(user.id, "google", accountId);
    if (!adapter) {
      return NextResponse.json(
        { error: "no_connection", provider: "google" },
        { status: 404 }
      );
    }
    if (!adapter.getKeywordsForAdGroup) {
      return NextResponse.json(
        { error: "not_supported_by_provider", provider: adapter.provider },
        { status: 400 }
      );
    }

    const dateRange = `${rangeToCacheKey(parsed)}:keywords:${adGroupId}`;
    const cacheParams = {
      userId: user.id,
      provider: "google" as const,
      accountId,
      dateRange,
    };

    if (forceRefresh) {
      const data = await adapter.getKeywordsForAdGroup(adGroupId, parsed);
      await setCachedCreatives({ ...cacheParams, data });
      return NextResponse.json({
        data,
        source: "fresh",
        fetchedAt: new Date().toISOString(),
        revalidating: false,
        adGroupId,
        range: parsed,
      });
    }

    const cached = await getCachedCreatives<UnifiedAdKeyword[]>(cacheParams);

    if (cached?.status === "fresh") {
      return NextResponse.json({
        data: cached.data,
        source: "cache-fresh",
        fetchedAt: cached.fetchedAt.toISOString(),
        revalidating: false,
        adGroupId,
        range: parsed,
      });
    }

    if (cached?.status === "stale") {
      after(async () => {
        try {
          const data = await adapter.getKeywordsForAdGroup!(adGroupId, parsed);
          await setCachedCreatives({ ...cacheParams, data });
        } catch (bgErr) {
          console.warn("[ads/keywords] Background revalidation failed", bgErr);
        }
      });
      return NextResponse.json({
        data: cached.data,
        source: "cache-stale",
        fetchedAt: cached.fetchedAt.toISOString(),
        revalidating: true,
        adGroupId,
        range: parsed,
      });
    }

    const data = await adapter.getKeywordsForAdGroup(adGroupId, parsed);
    await setCachedCreatives({ ...cacheParams, data });
    return NextResponse.json({
      data,
      source: "fresh",
      fetchedAt: new Date().toISOString(),
      revalidating: false,
      adGroupId,
      range: parsed,
    });
  } catch (err) {
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
    console.error("[ads/keywords] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
