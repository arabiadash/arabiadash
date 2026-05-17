import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { getDefaultWorkspaceId } from "@/lib/workspaces";
import { canAddMoreAccounts } from "@/lib/plans";
import { META_API_VERSION, META_SCOPES } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

interface SelectAccountsBody {
  account_ids: string[];
  workspace_id?: number;
}

interface GraphAdAccountDetails {
  id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}

/**
 * Persist the user's Meta account selection from the selector UI.
 *
 * Mirrors /api/google-ads/select-accounts. Differences:
 *   - Reads long-lived access token from platform_credentials (not a
 *     refresh token, but stored in the same column — see ADR-010).
 *   - Enriches each selected account via Graph API /act_<id>?fields=... in
 *     parallel, so the upsert lands with name + currency + timezone_name
 *     populated (no separate sync step needed — Meta API returns those
 *     fields for active accounts directly).
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

    // 2. Workspace resolution + ownership.
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

    // 3. Read access token from platform_credentials.
    const { data: credential } = await adminClient
      .from("platform_credentials")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .maybeSingle();
    if (!credential?.refresh_token) {
      return NextResponse.json(
        { error: "no_oauth_token" },
        { status: 400 }
      );
    }
    const accessToken = credential.refresh_token;

    // 4. Fetch metadata for each selected account in parallel.
    // Meta returns name + currency + timezone_name from the per-account
    // endpoint, so we don't need a separate sync step — unlike Google
    // where customer_client query is the only way to get those fields.
    const fields = "name,currency,timezone_name,account_status";
    const enriched = await Promise.all(
      body.account_ids.map(async (id) => {
        try {
          const url = `https://graph.facebook.com/${META_API_VERSION}/act_${id}?fields=${fields}&access_token=${accessToken}`;
          const res = await fetch(url);
          if (!res.ok) {
            return {
              id,
              name: null,
              currency: null,
              timezone_name: null,
              account_status: null,
            };
          }
          const data = (await res.json()) as GraphAdAccountDetails;
          return {
            id,
            name: data.name ?? null,
            currency: data.currency ?? null,
            timezone_name: data.timezone_name ?? null,
            account_status: data.account_status ?? null,
          };
        } catch {
          return {
            id,
            name: null,
            currency: null,
            timezone_name: null,
            account_status: null,
          };
        }
      })
    );

    const nowIso = new Date().toISOString();
    const rowsToUpsert = enriched.map((acc) => ({
      user_id: user.id,
      workspace_id: workspace.id,
      platform: "meta",
      account_id: acc.id,
      account_name: acc.name,
      // refresh_token column on connections is provider-agnostic. We
      // still write the access token here so the existing adapter
      // (factory.ts → MetaAdapter) keeps working unchanged.
      access_token: accessToken,
      token_expires_at: null,
      scopes: [...META_SCOPES],
      status: "active",
      metadata: {
        currency: acc.currency,
        timezone_name: acc.timezone_name,
        account_status: acc.account_status,
      },
      connected_at: nowIso,
      last_synced_at: nowIso,
    }));

    const { error: upsertError } = await adminClient
      .from("connections")
      .upsert(rowsToUpsert, { onConflict: "user_id,platform,account_id" });

    if (upsertError) {
      console.error("[meta/select] upsert failed:", upsertError);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      added: body.account_ids.length,
      total: limitCheck.current + body.account_ids.length,
      limit: limitCheck.limit,
    });
  } catch (err) {
    console.error(
      "[meta/select] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
