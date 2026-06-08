/**
 * OAuth helpers for Google Ads integration.
 * Reference: https://developers.google.com/identity/protocols/oauth2/web-server
 */
import { GoogleAdsApi } from "google-ads-api";
import { classifyGoogleAdsError } from "./errors";

const OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/adwords";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export interface GoogleRefreshResponse {
  access_token: string;
  expires_in: number;
}

/**
 * Build the consent screen URL the user is redirected to.
 * `access_type=offline` + `prompt=consent` together guarantee a refresh_token
 * is returned even on repeated authorizations.
 */
export function getGoogleAdsOAuthUrl(state: string): string {
  const clientId = requireEnv("GOOGLE_ADS_CLIENT_ID");
  const redirectUri = requireEnv("GOOGLE_ADS_REDIRECT_URI");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${OAUTH_BASE}?${params.toString()}`;
}

/**
 * Exchange the authorization `code` returned to the callback for tokens.
 * Throws with the upstream error body if Google rejects the exchange.
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<GoogleTokenResponse> {
  const clientId = requireEnv("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_ADS_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_ADS_REDIRECT_URI");

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Google token exchange failed (${response.status}): ${errText}`
    );
  }

  return (await response.json()) as GoogleTokenResponse;
}

/**
 * Trade a refresh_token for a fresh access_token. Use this when a stored
 * access_token has expired (Google's TTL is ~1 hour).
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<GoogleRefreshResponse> {
  const clientId = requireEnv("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_ADS_CLIENT_SECRET");

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Google token refresh failed (${response.status}): ${errText}`
    );
  }

  return (await response.json()) as GoogleRefreshResponse;
}

/**
 * List the customer IDs the authorized user can access. Returns bare 10-digit
 * IDs (the API returns `customers/1234567890` resource names; we strip the
 * prefix here so callers can use the IDs directly).
 *
 * Note: google-ads-api@23 expects a refresh_token here, not an access_token —
 * the library refreshes internally as needed. Spec asked for `accessToken`
 * but the library API forces this signature. Adjust if the calling site
 * already has only an access_token (in which case we'd need the REST endpoint
 * `https://googleads.googleapis.com/v17/customers:listAccessibleCustomers`).
 */
export async function getAccessibleCustomers(
  refreshToken: string
): Promise<string[]> {
  const clientId = requireEnv("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_ADS_CLIENT_SECRET");
  const developerToken = requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN");

  const client = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const response = await client.listAccessibleCustomers(refreshToken);
  const resourceNames: string[] = response.resource_names ?? [];

  return resourceNames
    .map((name) => name.replace(/^customers\//, ""))
    .filter((id) => /^\d{10}$/.test(id));
}

export interface AccessibleCustomerDetails {
  id: string;
  descriptive_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
  status: "ENABLED" | "SUSPENDED" | "CANCELED" | "CLOSED" | "UNKNOWN" | null;
  manager: boolean;
  test_account: boolean;
}

// Google Ads CustomerStatus enum mapping.
//
// The google-ads-api SDK returns numeric enum values for status fields,
// not the string names we'd expect from documentation. PR #22 debug logs
// surfaced this: an ENABLED account (status code 2) was reaching the UI
// filter as the integer 2, never matching the string "ENABLED" — so the
// MCC's own manager row was being silently filtered out.
//
// Mapping reference:
//   https://developers.google.com/google-ads/api/reference/rpc/v17/CustomerStatusEnum.CustomerStatus
const CUSTOMER_STATUS_MAP: Record<
  number,
  AccessibleCustomerDetails["status"]
> = {
  0: "UNKNOWN", // UNSPECIFIED
  1: "UNKNOWN", // UNKNOWN
  2: "ENABLED",
  3: "CANCELED",
  4: "SUSPENDED",
  5: "CLOSED",
};

/**
 * Enriched account discovery via customer_client GAQL query from our
 * MCC context. Returns name + status + currency + timezone + manager
 * flag for accounts linked under our MCC — INCLUDING CANCELED/CLOSED
 * where the per-customer `customer.descriptive_name` query fails.
 *
 * Standalone accounts (admin-on-account, not linked to our MCC) will
 * NOT appear in this result — callers can fall back to per-account
 * queries via `fetchCustomerDetails` for those.
 *
 * Returns [] on failure (no auth, transient, etc.) — never throws,
 * because this is enrichment, not the primary discovery path.
 *
 * Note: this helper was originally introduced in PR #20 (industry-
 * standard pivot superseded that PR). Restored here in C2 because
 * `/api/google-ads/discover` is its first consumer on this branch.
 */
export async function getEnrichedCustomerClients(
  refreshToken: string
): Promise<AccessibleCustomerDetails[]> {
  const clientId = requireEnv("GOOGLE_ADS_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_ADS_CLIENT_SECRET");
  const developerToken = requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN");
  const mccId = requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID");

  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  try {
    const customer = api.Customer({
      customer_id: mccId,
      refresh_token: refreshToken,
      login_customer_id: mccId,
    });

    const query = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.status,
        customer_client.manager,
        customer_client.test_account
      FROM customer_client
      WHERE customer_client.level <= 1
    `;

    const rows = await customer.query(query);

    return rows
      .map((row) => {
        const client = row.customer_client;
        if (!client?.id) return null;
        return {
          id: String(client.id),
          descriptive_name: client.descriptive_name ?? null,
          currency_code: client.currency_code ?? null,
          time_zone: client.time_zone ?? null,
          // google-ads-api v23 returns the enum as a NUMERIC value
          // (despite docs implying strings). Map via CUSTOMER_STATUS_MAP.
          // Defensive: if a future SDK version starts returning strings,
          // pass them through; null when status is undefined.
          status:
            typeof client.status === "number"
              ? (CUSTOMER_STATUS_MAP[client.status] ?? "UNKNOWN")
              : ((client.status as AccessibleCustomerDetails["status"]) ??
                null),
          manager: Boolean(client.manager),
          test_account: Boolean(client.test_account),
        };
      })
      .filter((r): r is AccessibleCustomerDetails => r !== null);
  } catch (err) {
    // Bubble reauth-class errors (ADR-017). CRITICAL: closes a hole from
    // #46 — without this bubble, the discover route's handleDiscoverError
    // wrapper is unreachable for the MCC path because this catch resolves
    // with [] instead of rejecting. MCC-only customers would still hit
    // the dead-end on expired tokens. The #46 production test passed
    // only because the standalone path (getAccessibleCustomers, no
    // internal catch) threw and bubbled first.
    const reauth = classifyGoogleAdsError(err);
    if (reauth) throw reauth;
    console.error(
      "[oauth] getEnrichedCustomerClients failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return [];
  }
}
