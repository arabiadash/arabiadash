import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth callback for providers like Google. Supabase redirects the user back
// here with a `code` query parameter (PKCE flow). We exchange the code for a
// session, which sets the auth cookies via the SSR client, then redirect to
// the destination page.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Either no code was provided or the exchange failed — bounce the user back
  // to login with an error flag so the page can show an Arabic message.
  return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
}
