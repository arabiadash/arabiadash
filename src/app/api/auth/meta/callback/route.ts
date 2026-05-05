import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  META_SCOPES,
} from "@/lib/meta/oauth";
import { getAdAccounts, getMetaUserInfo } from "@/lib/meta/api";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    console.warn(
      "[meta/callback] Facebook returned error:",
      error,
      errorDescription
    );
    return NextResponse.redirect(
      new URL(
        `/dashboard/connections?error=meta_oauth_denied&reason=${encodeURIComponent(error)}`,
        request.url
      )
    );
  }

  if (!code || !state) {
    console.error("[meta/callback] Missing code or state");
    return NextResponse.redirect(
      new URL(
        "/dashboard/connections?error=meta_callback_invalid",
        request.url
      )
    );
  }

  try {
    const cookieStore = await cookies();
    const storedState = cookieStore.get("meta_oauth_state")?.value;

    if (!storedState || storedState !== state) {
      console.error("[meta/callback] State mismatch");
      return NextResponse.redirect(
        new URL(
          "/dashboard/connections?error=meta_state_mismatch",
          request.url
        )
      );
    }

    cookieStore.delete("meta_oauth_state");

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(
        new URL("/login?from=meta_callback", request.url)
      );
    }

    const shortLivedTokenResponse = await exchangeCodeForToken(code);
    const longLivedTokenResponse = await exchangeForLongLivedToken(
      shortLivedTokenResponse.access_token
    );

    const accessToken = longLivedTokenResponse.access_token;
    const expiresIn = longLivedTokenResponse.expires_in;
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const [userInfo, adAccounts] = await Promise.all([
      getMetaUserInfo(accessToken),
      getAdAccounts(accessToken),
    ]);

    if (adAccounts.length === 0) {
      return NextResponse.redirect(
        new URL(
          "/dashboard/connections?error=meta_no_ad_accounts",
          request.url
        )
      );
    }

    if (adAccounts.length === 1) {
      const account = adAccounts[0];

      const { error: dbError } = await supabase.from("connections").upsert(
        {
          user_id: user.id,
          platform: "meta",
          account_id: account.id,
          account_name: account.name,
          access_token: accessToken,
          token_expires_at: tokenExpiresAt,
          scopes: [...META_SCOPES],
          status: "active",
          metadata: {
            meta_user_id: userInfo.id,
            meta_user_name: userInfo.name,
            currency: account.currency,
            timezone_name: account.timezone_name,
            account_status: account.account_status,
          },
          last_synced_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,platform,account_id",
        }
      );

      if (dbError) {
        console.error("[meta/callback] DB error:", dbError);
        return NextResponse.redirect(
          new URL(
            "/dashboard/connections?error=meta_db_error",
            request.url
          )
        );
      }

      return NextResponse.redirect(
        new URL(
          "/dashboard/connections?success=meta_connected",
          request.url
        )
      );
    }

    const tempCookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 600,
      path: "/",
    };

    cookieStore.set("meta_temp_token", accessToken, tempCookieOptions);
    cookieStore.set(
      "meta_temp_expires_at",
      tokenExpiresAt || "",
      tempCookieOptions
    );
    cookieStore.set(
      "meta_temp_user_info",
      JSON.stringify(userInfo),
      tempCookieOptions
    );

    return NextResponse.redirect(
      new URL("/dashboard/connections/select-account", request.url)
    );
  } catch (err) {
    console.error("[meta/callback] Unexpected error:", err);
    const errorMessage = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.redirect(
      new URL(
        `/dashboard/connections?error=meta_callback_failed&message=${encodeURIComponent(errorMessage)}`,
        request.url
      )
    );
  }
}
