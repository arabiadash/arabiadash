import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdapterForProvider } from "@/lib/ads/factory";
import {
  getCachedData,
  setCachedData,
  type AdProvider,
} from "@/lib/ads/cache";
import type { UnifiedCampaign } from "@/lib/ads/types";

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
    console.error("[ads/campaigns] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
