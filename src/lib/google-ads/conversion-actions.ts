import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleAdsApi, type Customer, errors } from "google-ads-api";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Google Ads conversion_action category integer enum (subset relevant to us).
 *
 * Source: google-ads-api SDK ConversionActionCategoryEnum (v17+).
 * Values that map to real e-commerce purchases:
 *   7  = PURCHASE
 *   21 = STORE_SALE (offline / brick-and-mortar attributed)
 *
 * Conservative stance per ADR-011: false negatives preferred over false
 * positives. If a user has miscategorized actions, the operator override
 * column (user_override) will be the long-term fix.
 */
const PURCHASE_CATEGORY_INTEGERS = new Set<number>([7, 21]);

/**
 * Reverse map for category_name denormalization. Stored in DB for human
 * readability when querying directly in Supabase Studio. Adapter logic
 * uses counts_as_purchase boolean, not this string.
 *
 * If the SDK returns an integer we don't recognize, we store category_name
 * as 'UNKNOWN_<N>' rather than throwing — the row still gets cached, just
 * with counts_as_purchase = false. This is forward-compatible with future
 * SDK additions.
 */
const CATEGORY_NAMES: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "DEFAULT",
  3: "PAGE_VIEW",
  4: "PURCHASE_LEGACY",
  5: "SIGNUP",
  6: "LEAD",
  7: "PURCHASE",
  8: "DOWNLOAD",
  9: "ADD_TO_CART",
  10: "BEGIN_CHECKOUT",
  11: "SUBSCRIBE_PAID",
  12: "PHONE_CALL_LEAD",
  13: "IMPORTED_LEAD",
  14: "SUBMIT_LEAD_FORM",
  15: "BOOK_APPOINTMENT",
  16: "REQUEST_QUOTE",
  17: "GET_DIRECTIONS",
  18: "OUTBOUND_CLICK",
  19: "CONTACT",
  20: "ENGAGEMENT",
  21: "STORE_SALE",
  22: "QUALIFIED_LEAD",
  23: "CONVERTED_LEAD",
};

function resolveCategoryName(raw: number): string {
  return CATEGORY_NAMES[raw] ?? `UNKNOWN_${raw}`;
}

export type ConversionActionRow = {
  resource_name: string;
  id: string;
  name: string;
  category: number;
  status: number;
  primary_for_goal: boolean;
};

export type SyncResult = {
  customer_id: string;
  fetched: number;
  upserted: number;
  purchases_detected: number;
  error?: string;
};

/**
 * Fetch conversion_action metadata for a single customer.
 *
 * Note: the `customer` instance must already be constructed with the right
 * login_customer_id (for MCC-managed accounts) or without it (for standalone
 * accounts). The factory in src/lib/ads/factory.ts handles that distinction.
 */
export async function fetchConversionActions(
  customer: Customer
): Promise<ConversionActionRow[]> {
  const query = `
    SELECT
      conversion_action.resource_name,
      conversion_action.id,
      conversion_action.name,
      conversion_action.category,
      conversion_action.status,
      conversion_action.primary_for_goal
    FROM conversion_action
  `;

  const rows = await customer.query(query);

  return rows.map((r) => {
    const ca = r.conversion_action;
    if (!ca) {
      throw new Error(
        "Google Ads returned a conversion_action row with no conversion_action object"
      );
    }
    return {
      resource_name: String(ca.resource_name ?? ""),
      id: String(ca.id ?? ""),
      name: String(ca.name ?? ""),
      category: typeof ca.category === "number" ? ca.category : 0,
      status: typeof ca.status === "number" ? ca.status : 0,
      primary_for_goal: Boolean(ca.primary_for_goal),
    };
  });
}

/**
 * Upsert conversion_action rows into google_conversion_actions for a single
 * (user_id, customer_id) scope.
 *
 * - Uses service role to bypass RLS (must be called from a server route
 *   with the admin client, not from a user-scoped client)
 * - Conflict resolution: ON CONFLICT (user_id, customer_id, conversion_action_id)
 *   DO UPDATE on name, category, status, primary_for_goal, counts_as_purchase,
 *   synced_at — preserves user_override (NEVER overwrite operator choices)
 * - Returns a summary including purchase detection count for logging
 */
export async function upsertConversionActions(
  admin: SupabaseClient<Database>,
  userId: string,
  customerId: string,
  rows: ConversionActionRow[]
): Promise<{ upserted: number; purchases_detected: number }> {
  if (rows.length === 0) {
    return { upserted: 0, purchases_detected: 0 };
  }

  const records = rows.map((row) => {
    const counts_as_purchase = PURCHASE_CATEGORY_INTEGERS.has(row.category);
    return {
      user_id: userId,
      customer_id: customerId,
      conversion_action_id: row.id,
      resource_name: row.resource_name,
      name: row.name,
      category: row.category,
      category_name: resolveCategoryName(row.category),
      status: row.status,
      primary_for_goal: row.primary_for_goal,
      counts_as_purchase,
      // user_override deliberately omitted — never written by sync,
      // only by future operator-override UI
      synced_at: new Date().toISOString(),
    };
  });

  const { error, count } = await admin
    .from("google_conversion_actions")
    .upsert(records, {
      onConflict: "user_id,customer_id,conversion_action_id",
      count: "exact",
      // Important: do NOT pass ignoreDuplicates — we want to refresh
      // name/category/status on every sync, since users can rename or
      // re-categorize actions in the Google Ads UI.
    });

  if (error) {
    throw new Error(
      `Failed to upsert conversion_actions for ${customerId}: ${error.message}`
    );
  }

  const purchases_detected = records.filter((r) => r.counts_as_purchase).length;

  return {
    upserted: count ?? records.length,
    purchases_detected,
  };
}

/**
 * Full sync flow for a single customer. Constructs its own Customer
 * instance internally to match the existing helper-layer convention
 * (refresh-token-in, SDK-internal; see src/lib/google-ads/customer.ts
 * for the parallel pattern used by fetchCustomerDetails).
 *
 * Error isolation: caller should treat conversion_actions sync as
 * non-blocking. If it fails for one account, the primary metadata
 * refresh for that account should still succeed, and other accounts
 * in the batch should still be processed.
 *
 * The login_customer_id parameter is optional: pass the MCC ID for
 * manager-enrolled accounts, omit for standalone accounts (post-PR #22
 * hybrid discovery distinguishes these via connections.metadata.
 * manager_customer_id).
 */
export async function syncConversionActionsForCustomer(
  admin: SupabaseClient<Database>,
  userId: string,
  customerId: string,
  refreshToken: string,
  loginCustomerId?: string
): Promise<SyncResult> {
  try {
    const api = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    });

    const customer = api.Customer({
      customer_id: customerId,
      refresh_token: refreshToken,
      ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
    });

    const rows = await fetchConversionActions(customer);
    const { upserted, purchases_detected } = await upsertConversionActions(
      admin,
      userId,
      customerId,
      rows
    );
    return {
      customer_id: customerId,
      fetched: rows.length,
      upserted,
      purchases_detected,
    };
  } catch (err) {
    const message =
      err instanceof errors.GoogleAdsFailure
        ? err.errors?.map((e) => e.message).join("; ") ?? "GoogleAdsFailure (no detail)"
        : err instanceof Error
        ? err.message
        : String(err);
    return {
      customer_id: customerId,
      fetched: 0,
      upserted: 0,
      purchases_detected: 0,
      error: message,
    };
  }
}

/**
 * Load the set of conversion_action IDs that count as purchases for a
 * given (user_id, customer_id) scope. Used by the adapter (commit 5) to
 * filter the segmented conversions query.
 *
 * Effective value = COALESCE(user_override, counts_as_purchase) — i.e. an
 * explicit operator override (TRUE or FALSE) wins over the auto-derived
 * flag.
 *
 * Returns null (NOT empty set) when the cache is empty — adapter must
 * distinguish "no data yet, sync hasn't run" from "data exists but
 * nothing counts as purchase". The former triggers a fire-and-forget
 * resync + purchases=null in the response; the latter is purchases=0.
 */
export async function getPurchaseActionIds(
  admin: SupabaseClient<Database>,
  userId: string,
  customerId: string
): Promise<Set<string> | null> {
  const { data, error } = await admin
    .from("google_conversion_actions")
    .select("conversion_action_id, counts_as_purchase, user_override")
    .eq("user_id", userId)
    .eq("customer_id", customerId)
    .eq("status", 2);

  if (error) {
    throw new Error(
      `Failed to load purchase action IDs for ${customerId}: ${error.message}`
    );
  }

  if (data === null || data.length === 0) {
    return null;
  }

  const result = new Set<string>();
  for (const row of data) {
    const effective =
      row.user_override !== null ? row.user_override : row.counts_as_purchase;
    if (effective) {
      result.add(row.conversion_action_id);
    }
  }

  return result;
}
