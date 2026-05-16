import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getGoogleAdsOAuthUrl } from "@/lib/google-ads/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // 1. Auth check — anonymous users get bounced to login with a return path.
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(
        new URL("/login?next=/dashboard/connections", request.url)
      );
    }

    // 2. CSRF state. randomUUID is 36 chars including hyphens — well over 32.
    const state = randomUUID();

    // 3. Store state in a short-lived secure cookie. sameSite=lax is required
    // because Google's callback is a cross-site top-level redirect; strict
    // would drop the cookie on return.
    const cookieStore = await cookies();
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 600,
      path: "/",
    };
    cookieStore.set("google_ads_oauth_state", state, cookieOpts);

    // 3b. Carry the active workspace through the OAuth roundtrip. Digit-only
    // values only — the callback validates ownership + non-archived before
    // trusting it, and falls back to the default workspace otherwise.
    const workspaceParam = request.nextUrl.searchParams.get("workspace");
    if (workspaceParam && /^\d+$/.test(workspaceParam)) {
      cookieStore.set("google_ads_oauth_workspace", workspaceParam, cookieOpts);
    }

    // 4. Build the consent URL and bounce the user to Google.
    const authUrl = getGoogleAdsOAuthUrl(state);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("[google-ads/auth] Error:", err);
    return NextResponse.json(
      {
        error: "init_failed",
        message:
          err instanceof Error ? err.message : "Failed to start OAuth flow",
      },
      { status: 500 }
    );
  }
}
