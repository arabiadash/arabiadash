import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { canAddMoreAccounts } from "@/lib/plans";

export const dynamic = "force-dynamic";

/**
 * GET /api/plans/limits
 *
 * Returns the authenticated user's current plan check shape (allowed,
 * current, limit, remaining, tier). Used by the account selector UI to
 * drive its progress bar + upgrade prompt.
 *
 * Passes `additionalCount: 0` so the response describes the user's
 * current state — callers compute "remaining after selection" client-side
 * once the user toggles checkboxes.
 */
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const adminClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const info = await canAddMoreAccounts(adminClient, user.id, 0);
  return NextResponse.json(info);
}
