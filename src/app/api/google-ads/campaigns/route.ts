import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { fetchCampaigns } from "@/lib/google-ads/campaigns";

export const dynamic = "force-dynamic";

interface RequestBody {
  customer_id: string;
  date_from: string;
  date_to: string;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2. Parse + validate body.
    let body: RequestBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    if (!body.customer_id || !body.date_from || !body.date_to) {
      return NextResponse.json(
        {
          error: "missing_params",
          required: ["customer_id", "date_from", "date_to"],
        },
        { status: 400 }
      );
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(body.date_from) || !dateRegex.test(body.date_to)) {
      return NextResponse.json(
        { error: "invalid_date_format", expected: "YYYY-MM-DD" },
        { status: 400 }
      );
    }

    // 3. Look up the user's connection to get refresh_token + which
    // login_customer_id strategy to use.
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: conn, error: fetchError } = await adminClient
      .from("google_ads_connections")
      .select(
        "refresh_token, manager_customer_id, descriptive_name, currency_code"
      )
      .eq("user_id", user.id)
      .eq("customer_id", body.customer_id)
      .single();

    if (fetchError || !conn) {
      return NextResponse.json(
        { error: "connection_not_found" },
        { status: 404 }
      );
    }

    // 4. Fetch campaign rows from Google Ads.
    const result = await fetchCampaigns({
      customerId: body.customer_id,
      refreshToken: conn.refresh_token,
      dateFrom: body.date_from,
      dateTo: body.date_to,
      // Pass MCC ID only if this account is linked to our manager;
      // for standalone accounts manager_customer_id is null in DB.
      loginCustomerId: conn.manager_customer_id ?? undefined,
    });

    if (!result) {
      return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
    }

    // 5. Enriched response — account name/currency for the UI header.
    return NextResponse.json({
      customer_id: body.customer_id,
      customer_name: conn.descriptive_name,
      currency: conn.currency_code,
      date_range: { from: body.date_from, to: body.date_to },
      campaigns: result.campaigns,
      totals: result.totals,
    });
  } catch (err) {
    console.error(
      "[google-ads/campaigns] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
