import { createClient } from "@/lib/supabase/server";
import { MetaAdapter } from "./providers/meta";
import { GoogleAdsAdapter } from "./providers/google";
import type { AdProviderAdapter } from "./types";
import type { AdProvider } from "./cache";

/**
 * Get the user's adapter for a specific ad provider.
 * Returns null if user doesn't have an active connection for that provider.
 */
export async function getAdapterForProvider(
  userId: string,
  provider: AdProvider
): Promise<AdProviderAdapter | null> {
  const supabase = await createClient();

  const { data: connection, error } = await supabase
    .from("connections")
    .select("id, account_id, account_name, access_token, metadata")
    .eq("user_id", userId)
    .eq("platform", provider)
    .eq("status", "active")
    .maybeSingle();

  if (error || !connection) return null;

  const metadata =
    (connection.metadata as {
      currency?: string;
      timezone_name?: string;
      // Google-specific metadata written at OAuth sync time:
      is_manager?: boolean;
      manager_customer_id?: string | null;
    }) || {};

  switch (provider) {
    case "meta":
      return new MetaAdapter(connection.access_token, connection.account_id, {
        name: connection.account_name || "",
        currency: metadata.currency || "USD",
        timezone: metadata.timezone_name || "UTC",
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
          currency: metadata.currency || "USD",
          timezone: metadata.timezone_name || "UTC",
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
 * Get all adapters for the user (one per active connection).
 * Useful for cross-platform aggregations.
 */
export async function getAllAdaptersForUser(
  userId: string
): Promise<AdProviderAdapter[]> {
  const supabase = await createClient();

  const { data: connections, error } = await supabase
    .from("connections")
    .select("platform")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error || !connections) return [];

  const adapters = await Promise.all(
    connections.map(async (c) => {
      return getAdapterForProvider(userId, c.platform as AdProvider);
    })
  );

  return adapters.filter((a): a is AdProviderAdapter => a !== null);
}
