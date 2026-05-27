import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getTiktokOAuthUrl } from "@/lib/tiktok/oauth";

export const dynamic = "force-dynamic";

/**
 * TikTok OAuth init route. Mirrors /api/google-ads/auth.
 *
 * Per ADR-020 §Decision 5: TikTok Sandbox during development; the
 * sandbox uses the same OAuth endpoints with sandbox-tagged
 * advertiser_ids — no code path divergence needed.
 *
 * Workspace context is required (matches Google's no-silent-defaults
 * stance from ADR-008).
 */

function errorRedirect(request: NextRequest, reason: string) {
  return NextResponse.redirect(
    new URL(
      `/dashboard/connections?tiktok=error&reason=${reason}`,
      request.url
    )
  );
}

export async function GET(request: NextRequest) {
  try {
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

    // Workspace context is required — ADR-008 no-silent-defaults.
    const workspaceParam = request.nextUrl.searchParams.get("workspace");
    if (!workspaceParam || !/^\d+$/.test(workspaceParam)) {
      return errorRedirect(request, "workspace_required");
    }

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

    // CSRF state cookie.
    const state = randomUUID();
    const cookieStore = await cookies();
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 600,
      path: "/",
    };
    cookieStore.set("tiktok_oauth_state", state, cookieOpts);
    cookieStore.set(
      "tiktok_oauth_workspace",
      String(workspace.id),
      cookieOpts
    );

    return NextResponse.redirect(getTiktokOAuthUrl(state));
  } catch (err) {
    console.error("[tiktok/init] Error:", err);
    return errorRedirect(request, "internal_error");
  }
}
