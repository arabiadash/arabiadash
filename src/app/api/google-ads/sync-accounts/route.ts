import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { fetchCustomerDetails } from "@/lib/google-ads/customer";

export const dynamic = "force-dynamic";

interface SyncResult {
  customer_id: string;
  status: "updated" | "skipped" | "failed";
  name?: string;
}

export async function POST() {
  try {
    // 1. Auth check.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2. Admin client — needed because RLS would block updates on
    // google_ads_connections from a user session; we filter by user_id
    // explicitly so the user can only touch their own rows.
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 3. Fetch all the user's Google Ads connections.
    const { data: connections, error: fetchError } = await adminClient
      .from("google_ads_connections")
      .select("customer_id, refresh_token")
      .eq("user_id", user.id);

    if (fetchError) {
      console.error("[sync-accounts] Fetch failed:", fetchError);
      return NextResponse.json(
        { error: "db_fetch_failed" },
        { status: 500 }
      );
    }

    if (!connections || connections.length === 0) {
      return NextResponse.json(
        { message: "no_connections", synced: 0 },
        { status: 200 }
      );
    }

    // 4. Sequential sync — one account at a time to stay polite with the
    // Google Ads API and to keep failures easy to debug.
    const results: SyncResult[] = [];

    for (const conn of connections) {
      const details = await fetchCustomerDetails(
        conn.customer_id,
        conn.refresh_token
      );

      if (!details) {
        results.push({
          customer_id: conn.customer_id,
          status: "skipped",
        });
        continue;
      }

      const { error: updateError } = await adminClient
        .from("google_ads_connections")
        .update({
          descriptive_name: details.descriptive_name,
          currency_code: details.currency_code,
          time_zone: details.time_zone,
          is_manager: details.is_manager,
          manager_customer_id: details.manager_customer_id,
        })
        .eq("user_id", user.id)
        .eq("customer_id", conn.customer_id);

      if (updateError) {
        results.push({
          customer_id: conn.customer_id,
          status: "failed",
        });
      } else {
        results.push({
          customer_id: conn.customer_id,
          status: "updated",
          name: details.descriptive_name ?? undefined,
        });
      }
    }

    return NextResponse.json({
      total: results.length,
      updated: results.filter((r) => r.status === "updated").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });
  } catch (err) {
    // Never log err object directly — may contain tokens.
    console.error(
      "[sync-accounts] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
