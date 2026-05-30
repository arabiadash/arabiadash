import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { getDefaultWorkspaceId } from "@/lib/workspaces";
import { canAddMoreAccounts } from "@/lib/plans";
import { getAdvertiserInfo } from "@/lib/tiktok/api";

export const dynamic = "force-dynamic";

interface SelectAccountsBody {
  advertiser_ids: string[];
  workspace_id?: number;
}

/**
 * Persist the user's TikTok advertiser selection from the selector UI.
 *
 * Mirrors /api/google-ads/select-accounts. Per ADR-019/ADR-020:
 * - connections.access_token is NULL for TikTok rows; TikTok's
 *   long-lived access_token lives in platform_credentials.refresh_token
 *   (the generic credential slot, same pattern as Meta — ADR-020 §13c)
 * - advertiser_id stored bare per ADR-020 §Decision 10 (no prefix)
 * - TikTok-specific fields (currency, timezone, advertiser_name,
 *   country, status) go in connections.metadata jsonb per Decision §10
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as SelectAccountsBody;
    if (
      !Array.isArray(body.advertiser_ids) ||
      body.advertiser_ids.length === 0
    ) {
      return NextResponse.json(
        { error: "no_accounts_selected" },
        { status: 400 }
      );
    }

    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // Cross-platform plan-limit gate (Trial=3, Growth=10, Agency=unlimited).
    const limitCheck = await canAddMoreAccounts(
      adminClient,
      user.id,
      body.advertiser_ids.length
    );
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: "plan_limit_exceeded",
          current: limitCheck.current,
          limit: limitCheck.limit,
          tier: limitCheck.tier,
          message: `خطتك (${limitCheck.tier}) تسمح بـ ${limitCheck.limit} حسابات. لديك ${limitCheck.current} حالياً.`,
        },
        { status: 403 }
      );
    }

    // Workspace resolution + ownership check.
    let workspaceId = body.workspace_id;
    if (!workspaceId) {
      workspaceId =
        (await getDefaultWorkspaceId(adminClient, user.id)) ?? undefined;
    }
    if (!workspaceId) {
      return NextResponse.json({ error: "no_workspace" }, { status: 400 });
    }

    const { data: workspace } = await adminClient
      .from("workspaces")
      .select("id")
      .eq("id", workspaceId)
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle();
    if (!workspace) {
      return NextResponse.json(
        { error: "invalid_workspace" },
        { status: 400 }
      );
    }

    // Read the stored credential to enrich metadata at upsert time.
    // Per ADR-020 §13c, the refresh_token column is a generic credential
    // slot — for TikTok it holds the long-lived access_token (same
    // pattern as Meta). Rename locally for call-site clarity.
    const { data: credential } = await adminClient
      .from("platform_credentials")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("platform", "tiktok")
      .maybeSingle();

    if (!credential?.refresh_token) {
      return NextResponse.json(
        { error: "no_oauth_token" },
        { status: 400 }
      );
    }

    const accessToken = credential.refresh_token;

    // Enrich each selected advertiser_id with currency/timezone/etc.
    // Non-fatal: failure surfaces as missing metadata; the connection
    // row still gets written and adapter construction throws-loudly
    // per ADR-008 if metadata is missing at adapter-init time.
    let advertiserInfo: Awaited<ReturnType<typeof getAdvertiserInfo>> = [];
    try {
      advertiserInfo = await getAdvertiserInfo(
        accessToken,
        body.advertiser_ids
      );
    } catch (err) {
      console.warn(
        "[tiktok/select] advertiser_info enrichment failed (non-fatal):",
        err instanceof Error ? err.message : "unknown"
      );
    }

    const infoByAdvertiserId = new Map(
      advertiserInfo.map((info) => [info.advertiser_id, info])
    );

    const nowIso = new Date().toISOString();
    const rowsToUpsert = body.advertiser_ids.map((advertiserId) => {
      const info = infoByAdvertiserId.get(advertiserId);
      const metadata = info
        ? {
            currency: info.currency,
            timezone_name: info.timezone,
            tiktok_advertiser_name: info.name,
            tiktok_country: info.country ?? null,
            tiktok_advertiser_status: info.status,
          }
        : {};
      return {
        user_id: user.id,
        workspace_id: workspace.id,
        platform: "tiktok",
        account_id: advertiserId, // bare per ADR-020 §Decision 10
        account_name: info?.name ?? null,
        access_token: null, // refresh lives in platform_credentials per ADR-017
        status: "active",
        metadata,
        connected_at: nowIso,
      };
    });

    const { error: upsertError } = await adminClient
      .from("connections")
      .upsert(rowsToUpsert, {
        onConflict: "user_id,platform,account_id",
      });

    if (upsertError) {
      console.error("[tiktok/select] upsert failed:", upsertError);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      added: body.advertiser_ids.length,
      total: limitCheck.current + body.advertiser_ids.length,
      limit: limitCheck.limit,
    });
  } catch (err) {
    console.error(
      "[tiktok/select] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
