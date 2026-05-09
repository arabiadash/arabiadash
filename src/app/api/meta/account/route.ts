import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: connection, error } = await supabase
      .from("connections")
      .select("account_id, account_name, metadata, status")
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .eq("status", "active")
      .maybeSingle();

    if (error || !connection) {
      return NextResponse.json({ error: "no_connection" }, { status: 404 });
    }

    const metadata =
      (connection.metadata as {
        currency?: string;
        timezone_name?: string;
      }) || {};

    return NextResponse.json({
      account_id: connection.account_id,
      account_name: connection.account_name,
      currency: metadata.currency || "USD",
      timezone: metadata.timezone_name || "UTC",
    });
  } catch (err) {
    console.error("[meta/account] Error:", err);
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }
}
