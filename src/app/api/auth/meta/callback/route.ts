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

export const dynamic = "force-dynamic";

/**
 * Meta OAuth callback.
 *
 * Industry-standard pattern (Triple Whale, Northbeam): OAuth establishes
 * consent + stores the long-lived access token, then the user explicitly
 * picks which accounts to import via the selector page (see C9 selector).
 * The callback no longer pre-populates `connections` with all accessible
 * ad accounts.
 *
 * Flow:
 *   1. Validate code + state + auth.
 *   2. Exchange code → short-lived → long-lived token.
 *   3. Upsert long-lived token into `platform_credentials` (one row per
 *      user/platform — see ADR-010).
 *   4. Redirect to the Meta selector page where the user picks accounts.
 *
 * Same pattern as Google callback (commit bb127f3).
 */
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

    // Exchange code → short-lived → long-lived (~60-day) token. The
    // long-lived token is what we store; the short-lived one is
    // discarded after the exchange.
    const shortLivedTokenResponse = await exchangeCodeForToken(code);
    const longLivedTokenResponse = await exchangeForLongLivedToken(
      shortLivedTokenResponse.access_token
    );

    const accessToken = longLivedTokenResponse.access_token;
    const expiresIn = longLivedTokenResponse.expires_in;
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    // Forward the workspace cookie to the selector page so its
    // /select-accounts call lands in the right workspace.
    const workspaceCookie = cookieStore.get("meta_oauth_workspace")?.value;

    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // Upsert into platform_credentials. Re-OAuth refreshes the token
    // here without touching any existing `connections` rows (user's
    // selections preserved).
    //
    // Meta's long-lived token is the "refresh_token" equivalent for the
    // platform — column reused as generic credential storage (ADR-010).
    const { error: credError } = await adminClient
      .from("platform_credentials")
      .upsert(
        {
          user_id: user.id,
          platform: "meta",
          refresh_token: accessToken,
          scopes: [...META_SCOPES],
          expires_at: expiresAt,
        },
        { onConflict: "user_id,platform" }
      );

    if (credError) {
      console.error(
        "[meta/callback] platform_credentials upsert failed:",
        credError
      );
      return NextResponse.redirect(
        new URL("/dashboard/connections?error=meta_db_error", request.url)
      );
    }

    // Cleanup. Workspace cookie is consumed below via the redirect URL.
    cookieStore.delete("meta_oauth_workspace");

    // Also clean up legacy temp cookies that may exist from the
    // pre-PR-#18 multi-step OAuth flow. Best-effort.
    cookieStore.delete("meta_temp_token");
    cookieStore.delete("meta_temp_expires_at");
    cookieStore.delete("meta_temp_user_info");

    // Redirect to the selector page.
    const selectorUrl = new URL(
      "/dashboard/connections/meta/select",
      request.url
    );
    selectorUrl.searchParams.set("from", "oauth");
    if (workspaceCookie && /^\d+$/.test(workspaceCookie)) {
      selectorUrl.searchParams.set("workspace", workspaceCookie);
    }

    return NextResponse.redirect(selectorUrl);
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
