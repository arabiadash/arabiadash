import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  getAccessibleAdvertisers,
  getAdvertiserInfo,
} from "@/lib/tiktok/api";

export const dynamic = "force-dynamic";

interface DiscoverableTiktokAdvertiser {
  advertiser_id: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  country: string | null;
  status: string;
  is_already_connected: boolean;
}

/**
 * Discover available TikTok advertiser_ids for the authenticated user.
 *
 * Reads the user's stored access_token from platform_credentials
 * (column is the generic credential slot per ADR-020 §13c — same
 * pattern as Meta), calls /oauth2/advertiser/get/ live for the list
 * of authorized advertisers + /advertiser/info/ for enrichment.
 *
 * Mirrors Google + Meta exactly — callback persists token only; this
 * route re-fetches the advertiser list LIVE on every selector page
 * load. No cookie carry-over, no persisted advertiser_ids
 * (per ADR-020 §15c).
 *
 * Returns the unified discoverable shape the selector UI consumes.
 * Marks already-connected advertisers for pre-selection.
 */
export async function GET() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: credential } = await adminClient
      .from("platform_credentials")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("platform", "tiktok")
      .maybeSingle();

    if (!credential?.refresh_token) {
      return NextResponse.json(
        { error: "no_oauth_token", message: "Please connect TikTok first" },
        { status: 400 }
      );
    }

    // Per ADR-020 §13c, the platform_credentials.refresh_token column
    // holds TikTok's long-lived access_token (generic credential slot,
    // same pattern as Meta). Rename locally for call-site clarity.
    const accessToken = credential.refresh_token;

    const appId = process.env.TIKTOK_APP_ID;
    const secret = process.env.TIKTOK_SECRET;
    if (!appId || !secret) {
      console.error("[tiktok/discover] Missing TIKTOK_APP_ID or TIKTOK_SECRET");
      return NextResponse.json({ error: "config_error" }, { status: 500 });
    }

    let accessible;
    try {
      accessible = await getAccessibleAdvertisers(accessToken, appId, secret);
    } catch (err) {
      console.error(
        "[tiktok/discover] getAccessibleAdvertisers failed:",
        err instanceof Error ? err.message : "unknown"
      );
      return NextResponse.json({ error: "discovery_failed" }, { status: 500 });
    }

    // Enrich via /advertiser/info/ — gets currency, timezone, status.
    const advertiserIds = accessible.map((a) => a.advertiser_id);
    let infoList: Awaited<ReturnType<typeof getAdvertiserInfo>> = [];
    try {
      infoList = await getAdvertiserInfo(accessToken, advertiserIds);
    } catch (err) {
      // Enrichment failure is non-fatal — fall back to bare list.
      console.warn(
        "[tiktok/discover] getAdvertiserInfo failed:",
        err instanceof Error ? err.message : "unknown"
      );
    }

    const infoByAdvertiserId = new Map(
      infoList.map((info) => [info.advertiser_id, info])
    );

    // Mark already-connected advertisers for pre-selection in the UI.
    const { data: activeRows } = await adminClient
      .from("connections")
      .select("account_id")
      .eq("user_id", user.id)
      .eq("platform", "tiktok")
      .eq("status", "active");

    const activeIds = new Set((activeRows ?? []).map((c) => c.account_id));

    const discoverable: DiscoverableTiktokAdvertiser[] = accessible.map((a) => {
      const info = infoByAdvertiserId.get(a.advertiser_id);
      return {
        advertiser_id: a.advertiser_id,
        name: info?.name ?? a.advertiser_name,
        currency: info?.currency ?? null,
        timezone: info?.timezone ?? null,
        country: info?.country ?? null,
        status: info?.status ?? "UNKNOWN",
        is_already_connected: activeIds.has(a.advertiser_id),
      };
    });

    return NextResponse.json({
      advertisers: discoverable,
      total: discoverable.length,
    });
  } catch (err) {
    console.error(
      "[tiktok/discover] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "discovery_failed" }, { status: 500 });
  }
}
