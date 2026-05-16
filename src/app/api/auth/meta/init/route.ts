import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { generateOAuthState, getMetaAuthUrl } from "@/lib/meta/oauth";

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

    // Carry the active workspace through the OAuth roundtrip. Digit-only
    // values only — the callback validates ownership + non-archived before
    // trusting it, and falls back to the default workspace otherwise.
    const { searchParams } = new URL(request.url);
    const workspaceParam = searchParams.get("workspace");
    if (workspaceParam && /^\d+$/.test(workspaceParam)) {
      cookieStore.set("meta_oauth_workspace", workspaceParam, cookieOpts);
    }

    const authUrl = getMetaAuthUrl(state);

    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("[meta/init] Error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/connections?error=meta_init_failed", request.url)
    );
  }
}
