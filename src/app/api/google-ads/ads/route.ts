import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { fetchAds } from "@/lib/google-ads/ads";

export const dynamic = "force-dynamic";

interface RequestBody {
  customer_id: string;
  date_from: string;
  date_to: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

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

    const result = await fetchAds({
      customerId: body.customer_id,
      refreshToken: conn.refresh_token,
      dateFrom: body.date_from,
      dateTo: body.date_to,
      loginCustomerId: conn.manager_customer_id ?? undefined,
    });

    if (!result) {
      return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
    }

    return NextResponse.json({
      customer_id: body.customer_id,
      customer_name: conn.descriptive_name,
      currency: conn.currency_code,
      date_range: { from: body.date_from, to: body.date_to },
      ads: result.ads,
      totals: result.totals,
    });
  } catch (err) {
    console.error(
      "[google-ads/ads] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
