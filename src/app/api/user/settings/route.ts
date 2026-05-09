import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SUPPORTED_CURRENCIES, type Currency } from "@/lib/currency";

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

    const { data: settings, error } = await supabase
      .from("user_settings")
      .select("preferred_currency")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[user/settings GET] Error:", error);
      return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
    }

    let preferredCurrency: Currency = "USD";

    if (!settings) {
      const { data: connection } = await supabase
        .from("connections")
        .select("metadata")
        .eq("user_id", user.id)
        .eq("platform", "meta")
        .eq("status", "active")
        .maybeSingle();

      if (connection?.metadata) {
        const metaCurrency = (connection.metadata as { currency?: string })
          .currency;
        if (metaCurrency === "SAR") {
          preferredCurrency = "SAR";
        }
      }
    } else {
      preferredCurrency = settings.preferred_currency as Currency;
    }

    return NextResponse.json({
      preferred_currency: preferredCurrency,
      derived_from_meta: !settings,
    });
  } catch (err) {
    console.error("[user/settings GET] Unexpected:", err);
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { preferred_currency } = body;

    if (!SUPPORTED_CURRENCIES.includes(preferred_currency as Currency)) {
      return NextResponse.json(
        { error: "invalid_currency", supported: SUPPORTED_CURRENCIES },
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

    const { error: dbError } = await supabase.from("user_settings").upsert(
      {
        user_id: user.id,
        preferred_currency,
      },
      {
        onConflict: "user_id",
      }
    );

    if (dbError) {
      console.error("[user/settings PUT] DB error:", dbError);
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true, preferred_currency });
  } catch (err) {
    console.error("[user/settings PUT] Unexpected:", err);
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }
}
