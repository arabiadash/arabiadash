/**
 * OAuth helpers for Google Ads integration.
 * Reference: https://developers.google.com/identity/protocols/oauth2/web-server
 */
import { GoogleAdsApi } from "google-ads-api";

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
