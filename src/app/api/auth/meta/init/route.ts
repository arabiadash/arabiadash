import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { generateOAuthState, getMetaAuthUrl } from "@/lib/meta/oauth";

function errorRedirect(request: NextRequest, code: string) {
  return NextResponse.redirect(
    new URL(`/dashboard/connections?error=${code}`, request.url)
  );
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.redirect(
        new URL("/login?from=meta_connect", request.url)
      );
    }

    // Workspace context is REQUIRED. The UI button always appends
    // ?workspace=<id>. Direct URL access without the param previously
    // skipped silently and the callback fell back to the default
    // workspace. Mirrors the Google /auth fix (commit 49d81ad).
    const { searchParams } = new URL(request.url);
    const workspaceParam = searchParams.get("workspace");
    if (!workspaceParam || !/^\d+$/.test(workspaceParam)) {
      return errorRedirect(request, "meta_workspace_required");
    }

    // Validate ownership + not archived inline so failures don't burn
    // an OAuth roundtrip.
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", Number(workspaceParam))
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle();

    if (!workspace) {
      return errorRedirect(request, "meta_invalid_workspace");
    }

    const state = generateOAuthState();

    const cookieStore = await cookies();
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 600,
      path: "/",
    };
    cookieStore.set("meta_oauth_state", state, cookieOpts);
    cookieStore.set(
      "meta_oauth_workspace",
      String(workspace.id),
      cookieOpts
    );

    const authUrl = getMetaAuthUrl(state);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("[meta/init] Error:", err);
    return errorRedirect(request, "meta_init_failed");
  }
}
