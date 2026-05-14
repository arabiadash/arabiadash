import { GoogleAdsApi } from "google-ads-api";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

export interface CustomerDetails {
  customer_id: string;
  descriptive_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
  is_manager: boolean;
  manager_customer_id: string | null;
}

/**
 * Fetch basic details (name, currency, timezone, manager flag) for one
 * Google Ads customer account. Returns null if the account cannot be
 * accessed (e.g., revoked permissions).
 *
 * The user may have access to an account either through our MCC or as a
 * direct admin on a standalone account. We try the MCC-linked path first,
 * then fall back to a no-login_customer_id call for standalone accounts.
 * `manager_customer_id` is set to our MCC when the first attempt succeeds,
 * null otherwise — useful later for routing reporting queries.
 */
export async function fetchCustomerDetails(
  customerId: string,
  refreshToken: string
): Promise<CustomerDetails | null> {
  const clientId = requireEnv("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_ADS_CLIENT_SECRET");
  const developerToken = requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN");
  const mccId = requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID");

  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const query = `
    SELECT
      customer.id,
      customer.descriptive_name,
      customer.currency_code,
      customer.time_zone,
      customer.manager
    FROM customer
    LIMIT 1
  `;

  async function tryFetch(
    useMcc: boolean
  ): Promise<CustomerDetails | null> {
    try {
      const customer = api.Customer({
        customer_id: customerId,
        refresh_token: refreshToken,
        // Only pass login_customer_id when attempting as MCC-linked.
        ...(useMcc ? { login_customer_id: mccId } : {}),
      });

      const rows = await customer.query(query);
      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        customer_id: String(row.customer?.id ?? customerId),
        descriptive_name: row.customer?.descriptive_name ?? null,
        currency_code: row.customer?.currency_code ?? null,
        time_zone: row.customer?.time_zone ?? null,
        is_manager: Boolean(row.customer?.manager),
        manager_customer_id: useMcc ? mccId : null,
      };
    } catch {
      return null;
    }
  }

  // Attempt 1: as MCC-linked account.
  const viaManager = await tryFetch(true);
  if (viaManager) return viaManager;

  // Attempt 2: as a standalone account (no login_customer_id).
  const standalone = await tryFetch(false);
  if (standalone) return standalone;

  return null;
}
