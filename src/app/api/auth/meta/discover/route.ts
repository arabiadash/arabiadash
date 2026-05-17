import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { META_API_VERSION } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

interface DiscoverableMetaAccount {
  account_id: string;
  name: string | null;
  currency: string | null;
  timezone_name: string | null;
  account_status: number;
  is_already_connected: boolean;
}

interface GraphAdAccount {
  id: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}

/**
 * Discover available Meta ad accounts for the authenticated user.
 *
 * Reads the stored long-lived user access token from `platform_credentials`,
 * queries Graph API `/me/adaccounts`, filters to active accounts only
 * (account_status === 1), marks already-connected ones. Does NOT write to DB.
 *
 * The selector UI calls this to populate options, then calls
 * `/api/auth/meta/select-accounts` to persist selections.
 *
 * Meta `account_status` reference:
 *   1   = ACTIVE
 *   2   = DISABLED
 *   3   = UNSETTLED
 *   7   = PENDING_RISK_REVIEW
 *   8   = PENDING_SETTLEMENT
 *   9   = IN_GRACE_PERIOD
 *   100 = PENDING_CLOSURE
 *   101 = CLOSED
 *   201 = ANY_ACTIVE
 *   202 = ANY_CLOSED
 *
 * We keep ACTIVE-only plus any account that's currently active in DB
 * (so re-running the selector doesn't accidentally hide a still-selected
 * account that flipped status server-side).
 */
export async function GET() {
  try {
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

    const { data: credential } = await adminClient
      .from("platform_credentials")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .maybeSingle();

    if (!credential?.refresh_token) {
      return NextResponse.json(
        { error: "no_oauth_token", message: "Please connect Meta first" },
        { status: 400 }
      );
    }

    // Note: platform_credentials.refresh_token holds Meta's long-lived
    // USER access token (~60 day TTL). Column name is generic because
    // Google's refresh token + Meta's long-lived token serve the same
    // role — the canonical credential the backend stores per platform.
    const accessToken = credential.refresh_token;
    const fields = "id,name,currency,timezone_name,account_status";
    const url = `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts?fields=${fields}&access_token=${accessToken}&limit=100`;

    const response = await fetch(url);
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error("[meta/discover] Graph API error:", errBody);
      return NextResponse.json(
        { error: "graph_api_failed" },
        { status: 500 }
      );
    }

    const data = (await response.json()) as { data?: GraphAdAccount[] };
    const accounts = data.data ?? [];

    const { data: activeRows } = await adminClient
      .from("connections")
      .select("account_id")
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .eq("status", "active");

    const activeIds = new Set((activeRows ?? []).map((c) => c.account_id));

    // Graph API returns IDs with "act_" prefix; the codebase stores them
    // without (per the existing Meta callback). Strip on the way out.
    const stripPrefix = (id: string) => id.replace(/^act_/, "");

    const discoverable: DiscoverableMetaAccount[] = accounts
      .filter((acc) => {
        const bareId = stripPrefix(String(acc.id));
        return acc.account_status === 1 || activeIds.has(bareId);
      })
      .map((acc) => {
        const bareId = stripPrefix(String(acc.id));
        return {
          account_id: bareId,
          name: acc.name ?? null,
          currency: acc.currency ?? null,
          timezone_name: acc.timezone_name ?? null,
          account_status: acc.account_status ?? 0,
          is_already_connected: activeIds.has(bareId),
        };
      });

    return NextResponse.json({
      accounts: discoverable,
      total: discoverable.length,
    });
  } catch (err) {
    console.error(
      "[meta/discover] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "discovery_failed" }, { status: 500 });
  }
}
