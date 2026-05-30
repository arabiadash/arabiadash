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
 * Per ADR-020 §Decision 1 + ADR-017 (M-hardening-1): the canonical
 * credential is persisted to platform_credentials (NOT to
 * connections.access_token). The connections table only gets populated
 * after the user picks accounts in /dashboard/connections/tiktok/select.
 *
 * Storage column (per ADR-020 §13c — Meta precedent): TikTok stores
 * its long-lived access_token in platform_credentials.refresh_token.
 * The column name is an accepted misnomer — it's a generic credential
 * slot, used the same way for Meta's long-lived access_token. No
 * column flip, no migration.
 *
 * Token model (per ADR-020 §13b — empirically confirmed 2026-05-29):
 * TikTok's /oauth2/access_token/ returns a long-lived access_token
 * with NO refresh_token and NO expiry field. Re-auth is reactive only
 * via ReauthRequiredError on error codes 40105 / 40110 / 40115.
 *
 * Discovered advertiser_ids are returned inline in the OAuth response
 * but are NOT persisted (per §15c). The selector page re-fetches them
 * live via /api/auth/tiktok/discover → /oauth2/advertiser/get/ — same
 * pattern as Google + Meta. The inline IDs here are logged for
 * diagnostic parity only.
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

    // Diagnostic-only parity log per ADR-020 §15c. The inline
    // advertiser_ids are NOT persisted; selector page re-fetches live
    // via /oauth2/advertiser/get/. Logging the count lets us spot
    // drift (e.g. discover returns fewer IDs than OAuth granted).
    console.log(
      "[tiktok/callback] OAuth granted advertiser_ids count:",
      tokens.advertiser_ids?.length ?? 0
    );

    const workspaceCookie = cookieStore.get("tiktok_oauth_workspace")?.value;

    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // Per ADR-020 §13c: the platform_credentials.refresh_token column
    // is a generic credential slot (see Meta callback's identical
    // pattern). TikTok stores its long-lived access_token here. The
    // expires_at column is NULL — TikTok provides no clock-based
    // expiry signal (ADR-020 §13b).
    //
    // scopes is NULL: TikTok scopes are large integer IDs that exceed
    // JS Number precision at JSON parse (ADR-020 §14b); not stored to
    // avoid silent corruption. Revisit if scope storage is ever needed.
    const { error: credError } = await adminClient
      .from("platform_credentials")
      .upsert(
        {
          user_id: user.id,
          platform: "tiktok",
          refresh_token: tokens.access_token,
          scopes: null,
          expires_at: null,
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
