import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdapterForProvider } from "@/lib/ads/factory";
import {
  getCachedData,
  setCachedData,
  type AdProvider,
} from "@/lib/ads/cache";
import type { UnifiedCampaign } from "@/lib/ads/types";
import { isReauthError } from "@/lib/google-ads/errors";

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

    // Optional account_id — when provided, scopes the adapter + cache lookup
    // to a specific connection. Without it the adapter falls back to
    // maybeSingle() across the user's active connections, which leaks
    // cross-workspace data for single-account providers like Meta.
    // Matches the /api/ads/insights and /api/ads/account pattern.
    const accountId =
      request.nextUrl.searchParams.get("account_id") ?? undefined;

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: "invalid_provider", supported: VALID_PROVIDERS },
        { status: 400 }
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

    const cacheKey = "campaigns";
    const cached = await getCachedData<UnifiedCampaign[]>(
      connection.id,
      provider,
      cacheKey
    );
    if (cached) {
      return NextResponse.json({ data: cached, cached: true, provider });
    }

    const campaigns = await adapter.getCampaigns();
    await setCachedData(connection.id, provider, cacheKey, campaigns);

    return NextResponse.json({ data: campaigns, cached: false, provider });
  } catch (err) {
    // Surface reauth-class errors as 401 + the canonical { error, provider }
    // shape used by /api/ads/insights and /api/ads/creatives. The
    // useProviderInsights hook (use-provider-insights.ts:179-186) checks
    // status === 401 + error === "reauth_required" and sets the hook's
    // error state to "reauth_required" — which the Reports Campaigns
    // sub-tab branches on to render the reauth banner (#49 UI fix).
    if (isReauthError(err)) {
      return NextResponse.json(
        { error: "reauth_required", provider: err.provider },
        { status: 401 }
      );
    }
    console.error("[ads/campaigns] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
