import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  exchangeCodeForTokens,
  getAccessibleCustomers,
} from "@/lib/google-ads/oauth";

export const dynamic = "force-dynamic";

const ERROR_BASE = "/dashboard/connections?google_ads=error&reason=";

function errorRedirect(request: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(ERROR_BASE + reason, request.url));
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");

    // 1. Google rejected the consent (or upstream error).
    if (oauthError) {
      return errorRedirect(request, encodeURIComponent(oauthError));
    }

    if (!code || !state) {
      return errorRedirect(request, "missing_params");
    }

    // 2. Read the CSRF state from the cookie we set in /api/google-ads/auth.
    const cookieStore = await cookies();
    const storedState = cookieStore.get("google_ads_oauth_state")?.value;

    if (!storedState) {
      return errorRedirect(request, "expired_session");
    }

    // 3. CSRF check.
    if (state !== storedState) {
      return errorRedirect(request, "csrf_mismatch");
    }

    // 4. Auth check — only signed-in users can complete the OAuth flow.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(
        new URL("/login?next=/dashboard/connections", request.url)
      );
    }

    // 5. Exchange the authorization code for tokens.
    const tokens = await exchangeCodeForTokens(code);

    // 6. Discover which Google Ads accounts this user can access.
    const customerIds = await getAccessibleCustomers(tokens.refresh_token);

    if (customerIds.length === 0) {
      return errorRedirect(request, "no_accounts");
    }

    // 7. Persist one row per accessible account. Service role required because
    // we write tokens that the user's session shouldn't have direct write
    // access to via RLS. is_active stays false — the user activates accounts
    // explicitly from the connections page.
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    const { error: upsertError } = await adminClient
      .from("google_ads_connections")
      .upsert(
        customerIds.map((customerId) => ({
          user_id: user.id,
          customer_id: customerId,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          expires_at: expiresAt,
          is_active: false,
          descriptive_name: null,
        })),
        { onConflict: "user_id,customer_id" }
      );

    if (upsertError) {
      console.error("[google-ads/callback] DB upsert failed:", upsertError);
      return errorRedirect(request, "internal_error");
    }

    // 8. Clear the temporary state cookie.
    cookieStore.delete("google_ads_oauth_state");

    // 9. Send the user back to the connections page with a success marker.
    return NextResponse.redirect(
      new URL(
        `/dashboard/connections?google_ads=success&count=${customerIds.length}`,
        request.url
      )
    );
  } catch (err) {
    // Never log tokens or full err object that might contain them.
    console.error(
      "[google-ads/callback] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return errorRedirect(request, "internal_error");
  }
}
