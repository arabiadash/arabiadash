import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { syncGoogleAccountsForUser } from "@/lib/google-ads/sync-accounts-logic";

export const dynamic = "force-dynamic";

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
    // connections from a user session; we filter by user_id explicitly so
    // the user can only touch their own rows.
    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 3. Delegate to shared helper. Same logic also runs inline after the
    // Google OAuth callback so new users don't need a manual sync.
    let results;
    try {
      results = await syncGoogleAccountsForUser(adminClient, user.id);
    } catch (err) {
      if (err instanceof Error && err.message === "db_fetch_failed") {
        return NextResponse.json(
          { error: "db_fetch_failed" },
          { status: 500 }
        );
      }
      throw err;
    }

    if (results.length === 0) {
      return NextResponse.json(
        { message: "no_connections", synced: 0 },
        { status: 200 }
      );
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
