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
 * Reads the user's stored refresh_token from platform_credentials
 * (per ADR-017 single source of truth), exchanges for a fresh
 * access_token if needed, then calls /oauth2/advertiser/get/ for the
 * list of authorized advertisers + /advertiser/info/ for enrichment.
 *
 * Returns the unified discoverable shape the selector UI consumes.
 * Marks already-connected advertisers for pre-selection.
 *
 * Mirrors /api/google-ads/discover from ADR-010.
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

    // TikTok's /oauth2/advertiser/get/ accepts the REFRESH token directly
    // as the access_token param (TikTok-specific quirk — the refresh
    // token IS the long-lived credential, and this discovery endpoint
    // accepts it). For other endpoints we'd refresh first.
    const appId = process.env.TIKTOK_APP_ID;
    const secret = process.env.TIKTOK_SECRET;
    if (!appId || !secret) {
      console.error("[tiktok/discover] Missing TIKTOK_APP_ID or TIKTOK_SECRET");
      return NextResponse.json({ error: "config_error" }, { status: 500 });
    }

    let accessible;
    try {
      accessible = await getAccessibleAdvertisers(
        credential.refresh_token,
        appId,
        secret
      );
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
      infoList = await getAdvertiserInfo(
        credential.refresh_token,
        advertiserIds
      );
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
