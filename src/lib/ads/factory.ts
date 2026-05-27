import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { MetaAdapter } from "./providers/meta";
import { GoogleAdsAdapter } from "./providers/google";
import { TiktokAdapter } from "./providers/tiktok";
import type { AdProviderAdapter } from "./types";
import type { AdProvider } from "./cache";
import type { Database } from "@/lib/supabase/database.types";
import { getPurchaseActionIds } from "@/lib/google-ads/conversion-actions";
import { getRefreshTokenForUser } from "@/lib/google-ads/credentials";

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
      // Meta still stores its access_token in connections.access_token
      // (per ADR-017 §Alternative E — Meta migration deferred to a future
      // milestone). A null here would mean DB corruption for a Meta row.
      if (!connection.access_token) {
        throw new Error(
          `Meta connection ${connection.id} has null access_token. ` +
            `Re-OAuth required.`
        );
      }
      return new MetaAdapter(connection.access_token, connection.account_id, {
        name: connection.account_name || "",
        currency: metadata.currency,
        timezone: metadata.timezone_name,
      });

    case "google": {
      // ADR-017: refresh_token lives in platform_credentials (single source
      // of truth). Use service-role client because RLS blocks user-scoped
      // reads of credential rows.
      const adminClient = createAdminClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );

      const refreshToken = await getRefreshTokenForUser(
        adminClient,
        userId,
        "google"
      );

      if (!refreshToken) {
        throw new Error(
          `User ${userId} has an active Google connection (${connection.account_id}) ` +
            `but no refresh_token in platform_credentials. Re-OAuth required.`
        );
      }

      // Pre-load the purchase action IDs from the conversion_actions
      // cache. The adapter uses this set to filter Q2 segmented
      // conversions down to real purchases (#15, ADR-011).
      //
      // - null = cache empty (sync hasn't populated this account yet).
      //   Adapter degrades to purchases/revenue/roas = null with
      //   hasConversionData = false.
      // - Set<string> (possibly empty) = cache populated; if empty,
      //   means this account has zero PURCHASE/STORE_SALE-categorized
      //   conversion actions (rare but valid — operator may need to
      //   curate via future override UI).
      const purchaseActionIds = await getPurchaseActionIds(
        supabase,
        userId,
        connection.account_id
      );

      return new GoogleAdsAdapter(
        refreshToken,
        connection.account_id,
        {
          name: connection.account_name || "",
          currency: metadata.currency,
          timezone: metadata.timezone_name,
        },
        metadata.manager_customer_id ?? undefined,
        purchaseActionIds
      );
    }

    case "tiktok": {
      // ADR-020 §Decision 1 + ADR-017 single-source-of-truth: refresh
      // token lives in platform_credentials. Use service-role client
      // because RLS blocks user-scoped reads of credential rows.
      const adminClient = createAdminClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );

      const refreshToken = await getRefreshTokenForUser(
        adminClient,
        userId,
        "tiktok"
      );

      if (!refreshToken) {
        throw new Error(
          `User ${userId} has an active TikTok connection (${connection.account_id}) ` +
            `but no refresh_token in platform_credentials. Re-OAuth required.`
        );
      }

      return new TiktokAdapter(refreshToken, connection.account_id, {
        name: connection.account_name || "",
        currency: metadata.currency,
        timezone: metadata.timezone_name,
      });
    }

    default:
      return null;
  }
}

/**
 * Providers where a user may have many active connections (Google +
 * TikTok). Endpoints must require account_id from callers for these.
 */
const MULTI_ACCOUNT_PROVIDERS: ReadonlySet<AdProvider> = new Set([
  "google",
  "tiktok",
]);

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

  // ADR-020 §Decision 8: Promise.allSettled (not Promise.all) so a
  // single provider's failure (e.g. TikTok mid-API-version-migration
  // throwing on construction) doesn't kill the whole adapter list.
  // Meta + Google continue working for the same user. Failed
  // construction errors logged for Vercel debugging; not bubbled up.
  const settled = await Promise.allSettled(
    connections.map((c) =>
      getAdapterForProvider(userId, c.platform as AdProvider, c.account_id)
    )
  );

  return settled
    .map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      console.error(
        `[factory] adapter construction failed for ${connections[i]?.platform}/${connections[i]?.account_id}:`,
        r.reason instanceof Error ? r.reason.message : "unknown"
      );
      return null;
    })
    .filter((a): a is AdProviderAdapter => a !== null);
}
