import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCampaigns, type MetaCampaign } from "@/lib/meta/api";
import { getCachedData, setCachedData } from "@/lib/meta/cache";

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

    const { data: connection, error: connError } = await supabase
      .from("connections")
      .select("id, account_id, access_token")
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .eq("status", "active")
      .single();

    if (connError || !connection) {
      return NextResponse.json(
        { error: "no_meta_connection" },
        { status: 404 }
      );
    }

    const cached = await getCachedData<MetaCampaign[]>(
      connection.id,
      "campaigns"
    );
    if (cached) {
      return NextResponse.json({ data: cached, cached: true });
    }

    const campaigns = await getCampaigns(
      connection.access_token,
      connection.account_id
    );

    await setCachedData(connection.id, "campaigns", campaigns);

    return NextResponse.json({ data: campaigns, cached: false });
  } catch (err) {
    console.error("[meta/campaigns] Error:", err);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
