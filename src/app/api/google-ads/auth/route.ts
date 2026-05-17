import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getGoogleAdsOAuthUrl } from "@/lib/google-ads/oauth";

export const dynamic = "force-dynamic";

function errorRedirect(request: NextRequest, reason: string) {
  return NextResponse.redirect(
    new URL(
      `/dashboard/connections?google_ads=error&reason=${reason}`,
      request.url
    )
  );
}

export async function GET(request: NextRequest) {
  try {
    // 1. Auth check — anonymous users bounce to login with a return path.
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

    // 2. Workspace context is REQUIRED. The UI button always appends
    // ?workspace=<id>. Direct URL access without the param previously
    // skipped silently and the callback fell back to the default
    // workspace — landing accounts in the wrong place. ADR-008's
    // no-silent-defaults principle: reject + redirect with a clear toast.
    const workspaceParam = request.nextUrl.searchParams.get("workspace");
    if (!workspaceParam || !/^\d+$/.test(workspaceParam)) {
      return errorRedirect(request, "workspace_required");
    }

    // 3. Validate workspace ownership + not-archived. RLS would also
    // catch this on the callback's lookup, but failing here means the
    // user doesn't burn an OAuth roundtrip just to land on an error.
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", Number(workspaceParam))
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle();

    if (!workspace) {
      return errorRedirect(request, "invalid_workspace");
    }

    // 4. CSRF state. randomUUID is 36 chars including hyphens.
    const state = randomUUID();

    // 5. Store state + workspace in short-lived secure cookies.
    // sameSite=lax is required because Google's callback is a cross-site
    // top-level redirect; strict would drop the cookie on return.
    const cookieStore = await cookies();
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 600,
      path: "/",
    };
    cookieStore.set("google_ads_oauth_state", state, cookieOpts);
    cookieStore.set(
      "google_ads_oauth_workspace",
      String(workspace.id),
      cookieOpts
    );

    // 6. Build the consent URL and bounce the user to Google.
    return NextResponse.redirect(getGoogleAdsOAuthUrl(state));
  } catch (err) {
    console.error("[google-ads/auth] Error:", err);
    return errorRedirect(request, "internal_error");
  }
}
