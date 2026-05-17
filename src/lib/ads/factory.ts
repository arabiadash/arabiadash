import { createClient } from "@/lib/supabase/server";
import { MetaAdapter } from "./providers/meta";
import { GoogleAdsAdapter } from "./providers/google";
import type { AdProviderAdapter } from "./types";
import type { AdProvider } from "./cache";

/**
 * Get the user's adapter for a specific ad provider, optionally scoped to
 * a specific account.
 *
 * - For single-account providers (Meta), accountId can be omitted and we
 *   pick the user's only active connection.
 * - For multi-account providers (Google), accountId is required — without
 *   it we'd have no way to choose between the user's 11+ accounts. Callers
 *   should enforce that via isMultiAccountProvider() before invoking.
 *
 * Returns null if no matching active connection exists.
 */
export async function getAdapterForProvider(
  userId: string,
  provider: AdProvider,
  accountId?: string
): Promise<AdProviderAdapter | null> {
  const supabase = await createClient();

  let query = supabase
    .from("connections")
    .select("id, account_id, account_name, access_token, metadata")
    .eq("user_id", userId)
    .eq("platform", provider)
    .eq("status", "active");

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  // maybeSingle() returns null + error when more than one row matches —
  // which is correct for single-account providers but would also flag a
  // multi-account provider invoked without an accountId. Callers are
  // expected to enforce the accountId requirement upstream.
  const { data: connection, error } = await query.maybeSingle();

  if (error || !connection) return null;

  const metadata =
    (connection.metadata as {
      currency?: string;
      timezone_name?: string;
      // Google-specific metadata written at OAuth sync time:
      is_manager?: boolean;
      manager_customer_id?: string | null;
      // Populated by customer_client enrichment in the OAuth callback
      // (ADR-009). Optional — existing connections from before the
      // enrichment landed read these as undefined; the UI handles that
      // via a "غير معروف" fallback badge. Not required for adapter
      // construction (informational for UI status display only).
      google_account_status?:
        | "ENABLED"
        | "SUSPENDED"
        | "CANCELED"
        | "CLOSED"
        | "UNKNOWN"
        | null;
      is_test_account?: boolean;
    }) || {};

  // Currency + timezone must come from sync-accounts. A missing currency
  // would cause the adapter to mistag rows (e.g. SAR data labeled USD)
  // and the frontend conversion would inflate values by the SAR-to-USD
  // rate — exactly the May 17 production bug (Google connections that
  // never ran sync-accounts had metadata.currency=null, the previous
  // `|| "USD"` fallback then mistagged SAR data as USD, and the chart's
  // USD→SAR conversion ×3.75 produced the inflated numbers).
  //
  // Throw loudly here instead of silently defaulting — the API route's
  // outer try/catch returns 500, the frontend's useInsights surfaces a
  // "fetch failed" state, and the developer logs name the exact
  // connection that needs re-sync.
  if (!metadata.currency) {
    throw new Error(
      `Connection ${connection.id} (${provider}/${connection.account_id}) ` +
        `is missing currency in metadata. Run sync-accounts to populate it.`
    );
  }
  if (!metadata.timezone_name) {
    throw new Error(
      `Connection ${connection.id} (${provider}/${connection.account_id}) ` +
        `is missing timezone_name in metadata. Run sync-accounts to populate it.`
    );
  }

  switch (provider) {
    case "meta":
      return new MetaAdapter(connection.access_token, connection.account_id, {
        name: connection.account_name || "",
        currency: metadata.currency,
        timezone: metadata.timezone_name,
      });

    case "google":
      // For Google, the `access_token` column holds the long-lived
      // refresh_token (the column name is provider-agnostic). The
      // login_customer_id (MCC) is only passed for accounts linked under
      // our manager; standalone accounts have manager_customer_id = null
      // in metadata, which we collapse to undefined here.
      return new GoogleAdsAdapter(
        connection.access_token,
        connection.account_id,
        {
          name: connection.account_name || "",
          currency: metadata.currency,
          timezone: metadata.timezone_name,
        },
        metadata.manager_customer_id ?? undefined
      );

    // Future providers:
    // case 'tiktok':
    //   return new TikTokAdapter(...);

    default:
      return null;
  }
}

/**
 * Providers where a user may have many active connections (Google, eventually
 * TikTok). Endpoints must require account_id from callers for these.
 */
const MULTI_ACCOUNT_PROVIDERS: ReadonlySet<AdProvider> = new Set(["google"]);

export function isMultiAccountProvider(provider: AdProvider): boolean {
  return MULTI_ACCOUNT_PROVIDERS.has(provider);
}

/**
 * Get all adapters for the user (one per active connection).
 * Useful for cross-platform aggregations.
 */
export async function getAllAdaptersForUser(
  userId: string
): Promise<AdProviderAdapter[]> {
  const supabase = await createClient();

  const { data: connections, error } = await supabase
    .from("connections")
    .select("platform, account_id")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error || !connections) return [];

  const adapters = await Promise.all(
    connections.map(async (c) => {
      return getAdapterForProvider(
        userId,
        c.platform as AdProvider,
        c.account_id
      );
    })
  );

  return adapters.filter((a): a is AdProviderAdapter => a !== null);
}
