import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  META_SCOPES,
} from "@/lib/meta/oauth";
import { getAdAccounts, getMetaUserInfo } from "@/lib/meta/api";
import { getDefaultWorkspaceId } from "@/lib/workspaces";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    console.warn(
      "[meta/callback] Facebook returned error:",
      error,
      errorDescription
    );
    return NextResponse.redirect(
      new URL(
        `/dashboard/connections?error=meta_oauth_denied&reason=${encodeURIComponent(error)}`,
        request.url
      )
    );
  }

  if (!code || !state) {
    console.error("[meta/callback] Missing code or state");
    return NextResponse.redirect(
      new URL(
        "/dashboard/connections?error=meta_callback_invalid",
        request.url
      )
    );
  }

  try {
    const cookieStore = await cookies();
    const storedState = cookieStore.get("meta_oauth_state")?.value;

    if (!storedState || storedState !== state) {
      console.error("[meta/callback] State mismatch");
      return NextResponse.redirect(
        new URL(
          "/dashboard/connections?error=meta_state_mismatch",
          request.url
        )
      );
    }

    cookieStore.delete("meta_oauth_state");

    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(
        new URL("/login?from=meta_callback", request.url)
      );
    }

    const shortLivedTokenResponse = await exchangeCodeForToken(code);
    const longLivedTokenResponse = await exchangeForLongLivedToken(
      shortLivedTokenResponse.access_token
    );

    const accessToken = longLivedTokenResponse.access_token;
    const expiresIn = longLivedTokenResponse.expires_in;
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const [userInfo, adAccounts] = await Promise.all([
      getMetaUserInfo(accessToken),
      getAdAccounts(accessToken),
    ]);

    if (adAccounts.length === 0) {
      return NextResponse.redirect(
        new URL(
          "/dashboard/connections?error=meta_no_ad_accounts",
          request.url
        )
      );
    }

    // Unified pattern (matches Google flow):
    //   - Save ALL ad accounts to the connections table
    //   - New rows: status='pending' (user activates from UI)
    //   - Existing rows: preserve status (don't override active→pending)
    //   - User picks which accounts to activate at /dashboard/connections/meta
    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // Pre-fetch existing rows so we can preserve their status on re-OAuth.
    // A user already running the app may have an active connection from the
    // legacy single-select flow — don't silently flip it to pending under
    // their feet.
    const { data: existingRows, error: existingError } = await adminClient
      .from("connections")
      .select("account_id, status")
      .eq("user_id", user.id)
      .eq("platform", "meta");

    if (existingError) {
      console.error(
        "[meta/callback] Failed to load existing rows:",
        existingError
      );
      return NextResponse.redirect(
        new URL("/dashboard/connections?error=meta_db_error", request.url)
      );
    }

    const existingByAccountId = new Map(
      (existingRows ?? []).map((r) => [r.account_id, r.status])
    );

    // Resolve the workspace this connection belongs to.
    //
    //   1) Read the workspace cookie set by /api/auth/meta/init.
    //   2) Validate: numeric, owned by this user, not archived. RLS would
    //      catch ownership but we use the admin client here, so the eq()
    //      filters are load-bearing.
    //   3) Fall back to the user's default workspace if the cookie was
    //      missing or didn't validate. Defense-in-depth — never trust a
    //      raw cookie value as a foreign key.
    const workspaceCookie = cookieStore.get("meta_oauth_workspace")?.value;
    const requestedId = workspaceCookie ? Number(workspaceCookie) : null;
    let workspaceId: number | null = null;

    if (
      requestedId !== null &&
      Number.isInteger(requestedId) &&
      requestedId > 0
    ) {
      const { data: ownedWorkspace } = await adminClient
        .from("workspaces")
        .select("id")
        .eq("id", requestedId)
        .eq("user_id", user.id)
        .is("archived_at", null)
        .maybeSingle();
      if (ownedWorkspace) workspaceId = ownedWorkspace.id;
    }

    workspaceId ??= await getDefaultWorkspaceId(adminClient, user.id);

    // Consume the workspace cookie either way — keeps the user's browser
    // clean and prevents a stale value from biasing the next OAuth flow.
    cookieStore.delete("meta_oauth_workspace");

    if (!workspaceId) {
      console.error(
        "[meta/callback] No workspace resolvable for user:",
        user.id
      );
      return NextResponse.redirect(
        new URL("/dashboard/connections?error=meta_db_error", request.url)
      );
    }

    const nowIso = new Date().toISOString();

    const rowsToUpsert = adAccounts.map((account) => {
      const previousStatus = existingByAccountId.get(account.id);
      // Existing row → keep its status. New row → start as pending.
      const status = previousStatus ?? "pending";

      return {
        user_id: user.id,
        workspace_id: workspaceId,
        platform: "meta",
        account_id: account.id,
        account_name: account.name,
        access_token: accessToken,
        token_expires_at: tokenExpiresAt,
        scopes: [...META_SCOPES],
        status,
        metadata: {
          meta_user_id: userInfo.id,
          meta_user_name: userInfo.name,
          currency: account.currency,
          timezone_name: account.timezone_name,
          account_status: account.account_status,
        },
        last_synced_at: nowIso,
      };
    });

    const { error: upsertError } = await adminClient
      .from("connections")
      .upsert(rowsToUpsert, {
        onConflict: "user_id,platform,account_id",
      });

    if (upsertError) {
      console.error("[meta/callback] Upsert failed:", upsertError);
      return NextResponse.redirect(
        new URL("/dashboard/connections?error=meta_db_error", request.url)
      );
    }

    // Clean up cookies from the old 2+ accounts flow. They're no longer used
    // but a half-finished OAuth attempt could leave one behind — best-effort.
    cookieStore.delete("meta_temp_token");
    cookieStore.delete("meta_temp_expires_at");
    cookieStore.delete("meta_temp_user_info");

    // Same UX as Google: land on the Meta sub-page where the user toggles
    // accounts on/off.
    return NextResponse.redirect(
      new URL(
        `/dashboard/connections/meta?success=meta_connected&count=${adAccounts.length}`,
        request.url
      )
    );
  } catch (err) {
    console.error("[meta/callback] Unexpected error:", err);
    const errorMessage = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.redirect(
      new URL(
        `/dashboard/connections?error=meta_callback_failed&message=${encodeURIComponent(errorMessage)}`,
        request.url
      )
    );
  }
}
