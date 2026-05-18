import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  getAccessibleCustomers,
  getEnrichedCustomerClients,
  type AccessibleCustomerDetails,
} from "@/lib/google-ads/oauth";
import { fetchCustomerDetails } from "@/lib/google-ads/customer";

export const dynamic = "force-dynamic";

interface DiscoverableAccount {
  account_id: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  is_manager: boolean;
  is_already_connected: boolean;
}

/**
 * Discover available Google Ads accounts for the authenticated user.
 *
 * Reads the user's stored refresh token from `platform_credentials`
 * (saved during the OAuth callback — see C4), queries Google's
 * customer_client endpoint for the list of accessible accounts, filters
 * out cancelled/closed, and returns the list. Does NOT write to DB.
 *
 * The selector UI calls this to populate options, then calls
 * `/api/google-ads/select-accounts` to persist the user's choices.
 *
 * Industry-standard pattern (Triple Whale, Northbeam): discovery is
 * read-only; only user-selected accounts are persisted.
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

    // Refresh token lives in platform_credentials (one row per user/platform).
    // OAuth callback writes it; we read it here.
    const { data: credential } = await adminClient
      .from("platform_credentials")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("platform", "google")
      .maybeSingle();

    if (!credential?.refresh_token) {
      return NextResponse.json(
        { error: "no_oauth_token", message: "Please connect Google first" },
        { status: 400 }
      );
    }

    // Hybrid discovery (ADR-010 follow-up):
    //   1) customer_client (MCC-linked accounts with rich status data —
    //      preferred; returns ENABLED/SUSPENDED/CANCELED/CLOSED so we
    //      can filter cancelled ones out cleanly).
    //   2) Fallback to listAccessibleCustomers + per-account
    //      fetchCustomerDetails for standalone account owners (the
    //      typical Saudi market user — owns accounts directly, not via
    //      an MCC). Cancelled/inaccessible accounts naturally drop here
    //      because fetchCustomerDetails returns null for them.
    let enrichedAccounts: AccessibleCustomerDetails[] =
      await getEnrichedCustomerClients(credential.refresh_token);

    console.log("[discover-debug] MCC query result:", {
      count: enrichedAccounts.length,
      sample: enrichedAccounts.slice(0, 2),
    });

    if (enrichedAccounts.length === 0) {
      console.log("[discover-debug] fallback path triggered");

      let standaloneIds: string[];
      try {
        standaloneIds = await getAccessibleCustomers(credential.refresh_token);
        console.log("[discover-debug] listAccessibleCustomers result:", {
          count: standaloneIds.length,
          ids: standaloneIds.slice(0, 5),
        });
      } catch (err) {
        console.error(
          "[discover-debug] listAccessibleCustomers threw:",
          err instanceof Error ? err.message : "unknown"
        );
        standaloneIds = [];
      }

      const enrichedStandalone = await Promise.all(
        standaloneIds.map(
          async (id): Promise<AccessibleCustomerDetails | null> => {
            try {
              const details = await fetchCustomerDetails(
                id,
                credential.refresh_token
              );
              if (!details) {
                console.log(
                  `[discover-debug] fetchCustomerDetails returned null for ${id}`
                );
                return null;
              }
              return {
                id,
                descriptive_name: details.descriptive_name,
                currency_code: details.currency_code,
                time_zone: details.time_zone,
                // Standalone path can't fetch status directly. If details
                // came back, the account is queryable → assume ENABLED.
                // Cancelled/closed accounts fail the details query and
                // get filtered above by the `if (!details) return null`.
                status: "ENABLED",
                manager: details.is_manager,
                test_account: false,
              };
            } catch (err) {
              console.error(
                `[discover-debug] fetchCustomerDetails threw for ${id}:`,
                err instanceof Error ? err.message : "unknown"
              );
              return null;
            }
          }
        )
      );

      console.log("[discover-debug] standalone enrichment result:", {
        total: enrichedStandalone.length,
        nonNull: enrichedStandalone.filter(Boolean).length,
      });

      enrichedAccounts = enrichedStandalone.filter(
        (acc): acc is AccessibleCustomerDetails => acc !== null
      );
    }

    // Filter to usable statuses: ENABLED, SUSPENDED, and unknown
    // (rare edge case where the SDK returns null status).
    // CANCELED and CLOSED accounts can't serve ads — hidden from selector.
    const usable = enrichedAccounts.filter(
      (acc) =>
        acc.status === "ENABLED" ||
        acc.status === "SUSPENDED" ||
        acc.status === null
    );

    // Mark which accounts are already active in DB so the UI can
    // pre-select them (and show "مرتبط" badge).
    const { data: activeRows } = await adminClient
      .from("connections")
      .select("account_id")
      .eq("user_id", user.id)
      .eq("platform", "google")
      .eq("status", "active");

    const activeIds = new Set((activeRows ?? []).map((c) => c.account_id));

    const discoverable: DiscoverableAccount[] = usable.map((acc) => ({
      account_id: acc.id,
      name: acc.descriptive_name,
      currency: acc.currency_code,
      timezone: acc.time_zone,
      is_manager: acc.manager,
      is_already_connected: activeIds.has(acc.id),
    }));

    return NextResponse.json({
      accounts: discoverable,
      total: discoverable.length,
    });
  } catch (err) {
    console.error(
      "[google-ads/discover] Error:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "discovery_failed" }, { status: 500 });
  }
}
