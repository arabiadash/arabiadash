import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { META_SCOPES } from "@/lib/meta/oauth";
import { getAdAccounts } from "@/lib/meta/api";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { account_id } = body;

    if (!account_id || typeof account_id !== "string") {
      return NextResponse.json(
        { error: "invalid_account_id" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("meta_temp_token")?.value;
    const tokenExpiresAt = cookieStore.get("meta_temp_expires_at")?.value;
    const userInfoStr = cookieStore.get("meta_temp_user_info")?.value;

    if (!accessToken || !userInfoStr) {
      return NextResponse.json(
        { error: "session_expired" },
        { status: 400 }
      );
    }

    let userInfo: { id: string; name: string };
    try {
      userInfo = JSON.parse(userInfoStr);
    } catch {
      return NextResponse.json(
        { error: "invalid_session" },
        { status: 400 }
      );
    }

    const adAccounts = await getAdAccounts(accessToken);
    const account = adAccounts.find((a) => a.id === account_id);

    if (!account) {
      return NextResponse.json(
        { error: "account_not_owned" },
        { status: 403 }
      );
    }

    const { error: dbError } = await supabase.from("connections").upsert(
      {
        user_id: user.id,
        platform: "meta",
        account_id: account.id,
        account_name: account.name,
        access_token: accessToken,
        token_expires_at: tokenExpiresAt || null,
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
      console.error("[meta/select-account] DB error:", dbError);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    cookieStore.delete("meta_temp_token");
    cookieStore.delete("meta_temp_expires_at");
    cookieStore.delete("meta_temp_user_info");

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[meta/select-account] Error:", err);
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }
}
