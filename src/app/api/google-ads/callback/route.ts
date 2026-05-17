import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { exchangeCodeForTokens } from "@/lib/google-ads/oauth";

export const dynamic = "force-dynamic";

const ERROR_BASE = "/dashboard/connections?google_ads=error&reason=";

function errorRedirect(request: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(ERROR_BASE + reason, request.url));
}

/**
 * Google Ads OAuth callback.
 *
 * Industry-standard pattern (Triple Whale, Northbeam): OAuth establishes
 * consent and stores the refresh token, then the user explicitly picks
 * which accounts to import via the selector page. The callback no longer
 * pre-populates the `connections` table with all accessible accounts.
 *
 * Flow:
 *   1. Validate code + state + auth.
 *   2. Exchange code for refresh_token.
 *   3. Upsert refresh_token into `platform_credentials` (one row per
 *      user+platform — see ADR-010).
 *   4. Redirect to the selector page where the user picks accounts.
 *
 * The selector page (and `/api/google-ads/select-accounts`) is what
 * actually writes to `connections`.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
      return errorRedirect(request, encodeURIComponent(oauthError));
    }
    if (!code || !state) {
      return errorRedirect(request, "missing_params");
    }

    const cookieStore = await cookies();
    const storedState = cookieStore.get("google_ads_oauth_state")?.value;
    if (!storedState) return errorRedirect(request, "expired_session");
    if (state !== storedState) return errorRedirect(request, "csrf_mismatch");

    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.redirect(
        new URL("/login?next=/dashboard/connections", request.url)
      );
    }

    const tokens = await exchangeCodeForTokens(code);

    // The workspace cookie is set by /api/google-ads/auth and forwarded
    // through the OAuth roundtrip. We don't need it for credential
    // storage (platform_credentials is per-user, not per-workspace) but
    // we pass it to the selector page so it knows which workspace to
    // upsert into.
    const workspaceCookie = cookieStore.get("google_ads_oauth_workspace")?.value;

    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Upsert the refresh token into platform_credentials. Re-OAuth just
    // refreshes the token here; it does NOT touch any existing
    // `connections` rows (user's account selections are preserved).
    const { error: credError } = await adminClient
      .from("platform_credentials")
      .upsert(
        {
          user_id: user.id,
          platform: "google",
          refresh_token: tokens.refresh_token,
          scopes: tokens.scope ? tokens.scope.split(" ") : null,
          expires_at: expiresAt,
        },
        { onConflict: "user_id,platform" }
      );

    if (credError) {
      console.error(
        "[google-ads/callback] platform_credentials upsert failed:",
        credError
      );
      return errorRedirect(request, "internal_error");
    }

    // Cleanup state cookies. The workspace cookie is consumed below via
    // the redirect URL — kept until after that for forwarding.
    cookieStore.delete("google_ads_oauth_state");
    cookieStore.delete("google_ads_oauth_workspace");

    // Redirect to the selector page. ?from=oauth tells the page to show
    // the post-OAuth welcome copy ("تم الربط بنجاح! اختر الحسابات...")
    // instead of the "add more accounts" wording.
    const selectorUrl = new URL(
      "/dashboard/connections/google/select",
      request.url
    );
    selectorUrl.searchParams.set("from", "oauth");
    if (workspaceCookie && /^\d+$/.test(workspaceCookie)) {
      selectorUrl.searchParams.set("workspace", workspaceCookie);
    }

    return NextResponse.redirect(selectorUrl);
  } catch (err) {
    console.error(
      "[google-ads/callback] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return errorRedirect(request, "internal_error");
  }
}
