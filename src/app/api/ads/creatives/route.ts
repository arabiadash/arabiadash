import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdapterForProvider } from "@/lib/ads/factory";
import type { AdProvider } from "@/lib/ads/cache";
import type { DateRange, DateRangeInput } from "@/lib/ads/types";

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

export async function GET(request: NextRequest) {
  try {
    const provider = (request.nextUrl.searchParams.get("provider") ||
      "meta") as AdProvider;

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: "invalid_provider", supported: VALID_PROVIDERS },
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

    const ads = await adapter.getAds(parsed);

    return NextResponse.json({
      data: ads,
      provider,
      range: parsed,
    });
  } catch (err) {
    console.error("[ads/creatives] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
