import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { exchangeAuthCodeForTokens } from "@/lib/tiktok/oauth";

export const dynamic = "force-dynamic";

const ERROR_BASE = "/dashboard/connections?tiktok=error&reason=";

function errorRedirect(request: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(ERROR_BASE + reason, request.url));
}

/**
 * TikTok OAuth callback.
 *
 * Per ADR-020 §Decision 1 + ADR-017 (M-hardening-1): refresh token is
 * the canonical credential, persisted to platform_credentials (NOT to
 * connections.access_token). The connections table only gets populated
 * after the user picks accounts in /dashboard/connections/tiktok/select.
 *
 * Token field naming: TikTok's response has both `access_token` AND
 * `refresh_token` (rotating refresh — every refresh returns a new
 * refresh_token + access_token pair). We store the REFRESH token in
 * platform_credentials.refresh_token (matches Google's column naming +
 * ADR-017 single source of truth).
 *
 * TikTok's access_token has a 24h lifetime; refresh_token has 1 year.
 * Pre-emptive expiry tracking REJECTED per ADR-020 §Decision 11 —
 * ReauthRequiredError handles expiry reactively.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const authCode = params.get("auth_code");
    const state = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
      return errorRedirect(request, encodeURIComponent(oauthError));
    }
    if (!authCode || !state) {
      return errorRedirect(request, "missing_params");
    }

    const cookieStore = await cookies();
    const storedState = cookieStore.get("tiktok_oauth_state")?.value;
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

    const tokens = await exchangeAuthCodeForTokens(authCode);

    const workspaceCookie = cookieStore.get("tiktok_oauth_workspace")?.value;

    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // Per ADR-017: refresh_token lives in platform_credentials. The
    // `expires_at` column tracks the SHORT-lived access_token TTL
    // (24h on TikTok) — historical from when the column was first
    // designed for Google's 1h access_token. Still useful for
    // operational diagnostics (is the access_token still warm?) but
    // NOT used for any auth logic.
    const accessTokenExpiresAt = tokens.access_token_expire_in
      ? new Date(
          Date.now() + tokens.access_token_expire_in * 1000
        ).toISOString()
      : null;

    const { error: credError } = await adminClient
      .from("platform_credentials")
      .upsert(
        {
          user_id: user.id,
          platform: "tiktok",
          refresh_token: tokens.refresh_token,
          scopes: tokens.scope ?? null,
          expires_at: accessTokenExpiresAt,
        },
        { onConflict: "user_id,platform" }
      );

    if (credError) {
      console.error(
        "[tiktok/callback] platform_credentials upsert failed:",
        credError
      );
      return errorRedirect(request, "internal_error");
    }

    cookieStore.delete("tiktok_oauth_state");
    cookieStore.delete("tiktok_oauth_workspace");

    // Redirect to selector page so user can pick which advertiser_ids
    // to import (mirrors Google's industry-standard account selection
    // flow from ADR-010).
    const selectorUrl = new URL(
      "/dashboard/connections/tiktok/select",
      request.url
    );
    selectorUrl.searchParams.set("from", "oauth");
    if (workspaceCookie && /^\d+$/.test(workspaceCookie)) {
      selectorUrl.searchParams.set("workspace", workspaceCookie);
    }

    return NextResponse.redirect(selectorUrl);
  } catch (err) {
    console.error(
      "[tiktok/callback] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return errorRedirect(request, "internal_error");
  }
}
