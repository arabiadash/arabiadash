/**
 * OAuth helpers for TikTok Marketing API integration.
 *
 * Reference: https://business-api.tiktok.com/portal/docs/authentication
 *
 * Per ADR-020 §Decision 1 + §Decision 7: direct HTTP, no SDK. All
 * v1.3 endpoint details live in this file + tiktok/api.ts. When v1.4
 * ships, these two files change; everything else stays stable.
 *
 * Token lifetimes (per TikTok docs):
 *   access_token  — 24 hours (refresh daily)
 *   refresh_token — 1 year (re-OAuth required after that)
 *
 * Per ADR-020 §Decision 11 (Q1 sub-issue resolution): we do NOT track
 * refresh_token expiry pre-emptively. ReauthRequiredError handles
 * expiry reactively when TikTok rejects the call.
 */

import { TIKTOK_AUTH_BASE_URL, TIKTOK_BASE_URL } from "./api";

const OAUTH_AUTHORIZE_PATH = "/portal/auth";
const OAUTH_TOKEN_PATH = "/oauth2/access_token/";

/**
 * 5 read-only OAuth scopes for v1 per ADR-020 §Decision 13:
 *   user.info.basic — OAuth identity verification
 *   ad.read         — list + fetch ads/adgroups/campaigns
 *   report.read     — /report/integrated/get/ performance metrics
 *   creative.read   — video metadata + poster URLs
 *   pixel.read      — pixel setup status for hasConversionData
 *
 * TikTok accepts scopes as comma-separated rid/rids in the auth URL.
 * Order-independent; we list alphabetically for stability.
 */
const TIKTOK_SCOPES = [
  "ad.read",
  "creative.read",
  "pixel.read",
  "report.read",
  "user.info.basic",
];

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export interface TiktokTokenResponse {
  // TikTok wraps responses in { code, message, data, request_id }
  // We expose the inner `data` shape after api.ts unwraps.
  access_token: string;
  refresh_token: string;
  access_token_expire_in: number; // seconds until access_token expires (~86400)
  refresh_token_expire_in: number; // seconds until refresh_token expires (~31536000)
  scope: string[];
  advertiser_ids?: string[];
  open_id?: string;
  token_type?: string;
}

/**
 * Build the consent screen URL the user is redirected to.
 *
 * TikTok's authorize endpoint takes `app_id` (not `client_id`),
 * `redirect_uri`, `state`, and `rid` (scope list comma-joined).
 * After consent, TikTok redirects to redirect_uri with `auth_code`
 * + `state` query params.
 */
export function getTiktokOAuthUrl(state: string): string {
  const appId = requireEnv("TIKTOK_APP_ID");
  const redirectUri = requireEnv("TIKTOK_REDIRECT_URI");

  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: redirectUri,
    state,
    rid: TIKTOK_SCOPES.join(","),
  });

  return `${TIKTOK_AUTH_BASE_URL}${OAUTH_AUTHORIZE_PATH}?${params.toString()}`;
}

/**
 * Exchange the auth_code returned to the callback for tokens.
 *
 * TikTok wraps the response in { code, message, data, request_id }.
 * code=0 means success; non-zero is an error. We throw with the
 * upstream code + message so the callback's error redirect carries
 * actionable context.
 */
export async function exchangeAuthCodeForTokens(
  authCode: string
): Promise<TiktokTokenResponse> {
  const appId = requireEnv("TIKTOK_APP_ID");
  const secret = requireEnv("TIKTOK_SECRET");

  const body = {
    app_id: appId,
    secret,
    auth_code: authCode,
  };

  const response = await fetch(`${TIKTOK_BASE_URL}${OAUTH_TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TikTok token exchange HTTP ${response.status}: ${text}`
    );
  }

  const json = (await response.json()) as {
    code: number;
    message: string;
    data: TiktokTokenResponse;
    request_id?: string;
  };

  if (json.code !== 0) {
    throw new Error(
      `TikTok API error ${json.code}: ${json.message ?? "token exchange failed"}`
    );
  }

  return json.data;
}

/**
 * Refresh an access_token using the stored refresh_token. TikTok's
 * refresh endpoint returns a NEW refresh_token + access_token pair
 * (rotating refresh tokens — different from Google's static refresh).
 * Caller must persist the new refresh_token back to
 * platform_credentials.
 */
export async function refreshTiktokAccessToken(
  refreshToken: string
): Promise<TiktokTokenResponse> {
  const appId = requireEnv("TIKTOK_APP_ID");
  const secret = requireEnv("TIKTOK_SECRET");

  const body = {
    app_id: appId,
    secret,
    refresh_token: refreshToken,
  };

  const response = await fetch(
    `${TIKTOK_BASE_URL}/oauth2/refresh_token/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TikTok token refresh HTTP ${response.status}: ${text}`
    );
  }

  const json = (await response.json()) as {
    code: number;
    message: string;
    data: TiktokTokenResponse;
    request_id?: string;
  };

  if (json.code !== 0) {
    throw new Error(
      `TikTok API error ${json.code}: ${json.message ?? "token refresh failed"}`
    );
  }

  return json.data;
}
