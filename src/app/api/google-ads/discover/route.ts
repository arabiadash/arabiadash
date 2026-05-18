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

    // Hybrid discovery (ADR-010 follow-up): run BOTH paths in parallel
    // and merge by ID. Preferring the if-empty fallback (PR #22 v1)
    // missed users who have BOTH an MCC-linked manager row AND
    // standalone client accounts — the MCC query returned just the
    // manager (count=1), so the fallback never fired and the 11+
    // standalone accounts were invisible.
    //
    //   - MCC path:  rich status data (ENABLED/SUSPENDED/CANCELED/CLOSED)
    //                — preferred when both paths return the same ID.
    //   - Standalone path:  per-account fetchCustomerDetails. Cancelled/
    //                inaccessible accounts naturally drop because the
    //                query returns null.
    //
    // Each path's failure is logged + isolated via .catch so a transient
    // SDK error on one path doesn't blank the whole result.
    const [mccResults, accessibleIds] = await Promise.all([
      getEnrichedCustomerClients(credential.refresh_token).catch((err) => {
        console.error(
          "[discover] MCC query failed:",
          err instanceof Error ? err.message : "unknown"
        );
        return [] as AccessibleCustomerDetails[];
      }),
      getAccessibleCustomers(credential.refresh_token).catch((err) => {
        console.error(
          "[discover] listAccessibleCustomers failed:",
          err instanceof Error ? err.message : "unknown"
        );
        return [] as string[];
      }),
    ]);

    // IDs already covered by the MCC path keep that path's enrichment
    // (richer status). Only run per-account queries for IDs NOT in MCC.
    const mccIds = new Set(mccResults.map((r) => r.id));
    const standaloneOnlyIds = accessibleIds.filter((id) => !mccIds.has(id));

    const enrichedStandalone = (
      await Promise.all(
        standaloneOnlyIds.map(
          async (id): Promise<AccessibleCustomerDetails | null> => {
            try {
              const details = await fetchCustomerDetails(
                id,
                credential.refresh_token
              );
              if (!details) return null;
              return {
                id,
                descriptive_name: details.descriptive_name,
                currency_code: details.currency_code,
                time_zone: details.time_zone,
                // Standalone path can't fetch status directly. If
                // details came back, the account is queryable → assume
                // ENABLED. Cancelled/closed accounts fail the details
                // query and get filtered above by the null guard.
                status: "ENABLED",
                manager: details.is_manager,
                test_account: false,
              };
            } catch (err) {
              console.error(
                `[discover] fetchCustomerDetails threw for ${id}:`,
                err instanceof Error ? err.message : "unknown"
              );
              return null;
            }
          }
        )
      )
    ).filter((acc): acc is AccessibleCustomerDetails => acc !== null);

    const enrichedAccounts: AccessibleCustomerDetails[] = [
      ...mccResults,
      ...enrichedStandalone,
    ];

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
