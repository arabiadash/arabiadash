import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { getDefaultWorkspaceId } from "@/lib/workspaces";
import { canAddMoreAccounts } from "@/lib/plans";
import { syncGoogleAccountsForUser } from "@/lib/google-ads/sync-accounts-logic";

export const dynamic = "force-dynamic";

interface SelectAccountsBody {
  account_ids: string[];
  workspace_id?: number;
}

/**
 * Persist the user's account selection from the selector UI.
 *
 * Flow:
 *   1. Validate against the cross-platform plan limit (PlanLimits).
 *   2. Resolve + validate workspace ownership.
 *   3. Read the user's refresh token from platform_credentials.
 *   4. Upsert one connection row per selected account (status='active').
 *   5. Auto-run syncGoogleAccountsForUser to enrich metadata (currency,
 *      timezone, account name) — non-fatal if it fails.
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
    if (!Array.isArray(body.account_ids) || body.account_ids.length === 0) {
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

    // 1. Cross-platform plan-limit gate.
    const limitCheck = await canAddMoreAccounts(
      adminClient,
      user.id,
      body.account_ids.length
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

    // 2. Workspace resolution + ownership check.
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

    // 3. Read refresh token from platform_credentials.
    const { data: credential } = await adminClient
      .from("platform_credentials")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("platform", "google")
      .maybeSingle();

    if (!credential?.refresh_token) {
      return NextResponse.json(
        { error: "no_oauth_token" },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    // 4. Upsert selected accounts as active. onConflict handles
    // re-selection of previously-deactivated accounts (their row gets
    // status flipped back to 'active').
    //
    // ADR-017: refresh_token is NOT duplicated into connections.access_token
    // for Google. Read path uses platform_credentials.refresh_token via
    // factory.ts's getRefreshTokenForUser helper.
    const rowsToUpsert = body.account_ids.map((accountId) => ({
      user_id: user.id,
      workspace_id: workspace.id,
      platform: "google",
      account_id: accountId,
      access_token: null,
      status: "active",
      metadata: {},
      connected_at: nowIso,
    }));

    const { error: upsertError } = await adminClient
      .from("connections")
      .upsert(rowsToUpsert, { onConflict: "user_id,platform,account_id" });

    if (upsertError) {
      console.error("[google-ads/select] upsert failed:", upsertError);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    // 5. Auto-enrich metadata. Non-fatal — the rows are already written;
    // a sync failure just means name/currency populate on next manual sync.
    try {
      await syncGoogleAccountsForUser(adminClient, user.id);
    } catch (syncErr) {
      console.error(
        "[google-ads/select] auto-sync failed (non-fatal):",
        syncErr instanceof Error ? syncErr.message : "unknown"
      );
    }

    return NextResponse.json({
      success: true,
      added: body.account_ids.length,
      total: limitCheck.current + body.account_ids.length,
      limit: limitCheck.limit,
    });
  } catch (err) {
    console.error(
      "[google-ads/select] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
