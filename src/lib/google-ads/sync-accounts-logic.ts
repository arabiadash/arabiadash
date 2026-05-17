import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchCustomerDetails } from "@/lib/google-ads/customer";
import {
  getEnrichedCustomerClients,
  type AccessibleCustomerDetails,
} from "@/lib/google-ads/oauth";

export interface SyncResult {
  customer_id: string;
  status: "updated" | "skipped" | "failed";
  name?: string;
}

/**
 * Sequentially fetch Google Ads customer details for each of the user's
 * Google connections and merge the result into `connections.metadata`.
 *
 * Sequential on purpose — one account at a time keeps us polite with the
 * Google Ads API and makes per-account failures easy to debug.
 *
 * Returns a per-connection result list. Caller decides what to do with
 * failures: the manual `/api/google-ads/sync-accounts` route surfaces
 * them in the response; the OAuth callback ignores them (the connection
 * row is already written, the user can manually re-sync later).
 *
 * Accepts an admin Supabase client because the OAuth callback already
 * needs one for the upsert and we want to avoid creating a second.
 */
export async function syncGoogleAccountsForUser(
  adminClient: SupabaseClient<Database>,
  userId: string
): Promise<SyncResult[]> {
  const { data: connections, error: fetchError } = await adminClient
    .from("connections")
    .select("account_id, access_token, metadata")
    .eq("user_id", userId)
    .eq("platform", "google");

  if (fetchError) {
    console.error("[sync-accounts-logic] Fetch failed:", fetchError);
    throw new Error("db_fetch_failed");
  }

  if (!connections || connections.length === 0) {
    return [];
  }

  // Single customer_client query covers all MCC-linked accounts with names
  // + statuses + currency in one shot — works for CANCELED/CLOSED accounts
  // where the per-account customer.descriptive_name query (the fallback
  // below) would fail. Standalone accounts (not in MCC) won't appear here;
  // they fall through to fetchCustomerDetails.
  //
  // All connections for one user share the same refresh_token (the OAuth
  // flow wrote it once on every row), so reading from connections[0] is
  // safe and avoids one extra round-trip.
  const refreshToken = connections[0]?.access_token;
  const enrichedMap = new Map<string, AccessibleCustomerDetails>();
  if (refreshToken) {
    try {
      const enriched = await getEnrichedCustomerClients(refreshToken);
      for (const client of enriched) {
        enrichedMap.set(client.id, client);
      }
    } catch (err) {
      console.error(
        "[sync-accounts-logic] enrichment query failed:",
        err instanceof Error ? err.message : "unknown"
      );
      // Continue without enrichment — per-account fallback will run for each.
    }
  }

  const results: SyncResult[] = [];

  for (const conn of connections) {
    // Enrichment path first — works for any status including CANCELED/CLOSED.
    const enriched = enrichedMap.get(conn.account_id);
    if (enriched) {
      const existingMetadata =
        (conn.metadata as Record<string, unknown>) || {};
      const mergedMetadata = {
        ...existingMetadata,
        currency: enriched.currency_code,
        timezone_name: enriched.time_zone,
        google_account_status: enriched.status,
        is_manager: enriched.manager,
        is_test_account: enriched.test_account,
      };

      const { error: updateError } = await adminClient
        .from("connections")
        .update({
          account_name: enriched.descriptive_name,
          metadata: mergedMetadata,
        })
        .eq("user_id", userId)
        .eq("platform", "google")
        .eq("account_id", conn.account_id);

      if (updateError) {
        results.push({
          customer_id: conn.account_id,
          status: "failed",
        });
      } else {
        results.push({
          customer_id: conn.account_id,
          status: "updated",
          name: enriched.descriptive_name ?? undefined,
        });
      }
      continue;
    }

    // Fallback: standalone accounts (not MCC-linked) — per-account query.
    const details = await fetchCustomerDetails(
      conn.account_id,
      conn.access_token
    );

    if (!details) {
      results.push({
        customer_id: conn.account_id,
        status: "skipped",
      });
      continue;
    }

    // Merge new Google fields into existing metadata — preserves the
    // expires_at and google_access_token that the callback wrote, plus
    // any other future fields. status is left alone (still 'pending'
    // until the user activates from UI).
    const existingMetadata =
      (conn.metadata as Record<string, unknown>) || {};
    const mergedMetadata = {
      ...existingMetadata,
      currency: details.currency_code,
      timezone_name: details.time_zone,
      is_manager: details.is_manager,
      manager_customer_id: details.manager_customer_id,
    };

    const { error: updateError } = await adminClient
      .from("connections")
      .update({
        account_name: details.descriptive_name,
        metadata: mergedMetadata,
      })
      .eq("user_id", userId)
      .eq("platform", "google")
      .eq("account_id", conn.account_id);

    if (updateError) {
      results.push({
        customer_id: conn.account_id,
        status: "failed",
      });
    } else {
      results.push({
        customer_id: conn.account_id,
        status: "updated",
        name: details.descriptive_name ?? undefined,
      });
    }
  }

  return results;
}
