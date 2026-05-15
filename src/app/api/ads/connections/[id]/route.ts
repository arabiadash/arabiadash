import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { getUserAccountsLimit, buildLimitError } from "@/lib/plans";

export const dynamic = "force-dynamic";

interface RequestBody {
  action: "activate" | "deactivate";
}

/**
 * PATCH /api/ads/connections/[id]
 *
 * Toggle a connection between active and pending.
 *
 * - activate: requires < user.limit active connections
 * - deactivate: always allowed
 *
 * Returns the updated connection row or an error.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Auth.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2. Parse + validate the route param and body.
    const { id } = await params;
    const connectionId = Number(id);

    if (!Number.isInteger(connectionId) || connectionId <= 0) {
      return NextResponse.json(
        { error: "invalid_connection_id" },
        { status: 400 }
      );
    }

    let body: RequestBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    if (body.action !== "activate" && body.action !== "deactivate") {
      return NextResponse.json(
        { error: "invalid_action", allowed: ["activate", "deactivate"] },
        { status: 400 }
      );
    }

    // 3. Admin client — RLS would block status writes from a user session;
    // we filter by user_id on every query so the user can only touch their
    // own rows.
    const adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 4. Verify the connection exists and belongs to this user.
    const { data: connection, error: fetchError } = await adminClient
      .from("connections")
      .select("id, platform, status, account_id, account_name")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError || !connection) {
      return NextResponse.json(
        { error: "connection_not_found" },
        { status: 404 }
      );
    }

    // 5. Limit gate — per-platform, not global. Meta is single-account so
    // the limit only meaningfully constrains multi-account providers
    // (Google), but we apply it uniformly: counting active rows for the
    // same platform as the row being toggled. Already-active rows bypass
    // (no net new activation).
    if (body.action === "activate") {
      const { count: activeCount } = await adminClient
        .from("connections")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("platform", connection.platform)
        .eq("status", "active");

      const limit = await getUserAccountsLimit(user.id);
      const current = activeCount ?? 0;

      if (current >= limit && connection.status !== "active") {
        return NextResponse.json(buildLimitError(current, limit), {
          status: 403,
        });
      }
    }

    // 6. Apply the status change. 'pending' is the inverse of 'active' in
    // our state machine — callers don't see other statuses.
    const newStatus = body.action === "activate" ? "active" : "pending";

    const { data: updated, error: updateError } = await adminClient
      .from("connections")
      .update({ status: newStatus })
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .select("id, platform, status, account_id, account_name")
      .single();

    if (updateError || !updated) {
      console.error(
        "[connections/PATCH] Update failed:",
        updateError?.message
      );
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }

    return NextResponse.json({
      connection: updated,
      action: body.action,
    });
  } catch (err) {
    console.error(
      "[connections/PATCH] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
