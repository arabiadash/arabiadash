/**
 * TikTok-specific error classification + rate-limit detection.
 *
 * Mirrors the Google `classifyGoogleAdsError` pattern from ADR-017.
 * Returns a typed ReauthRequiredError when the upstream failure indicates
 * the user's TikTok access token is no longer usable, or null otherwise.
 *
 * Per ADR-020 §Decision 9: ReauthRequiredError is widened from ADR-017
 * to carry a `provider` discriminator. The same UI banner branch in
 * ReportsClient handles both providers.
 *
 * TikTok error codes documented at:
 *   https://business-api.tiktok.com/portal/docs/troubleshooting/error-code
 * Subset relevant to reauth + rate-limit:
 *   40100 = rate-limited (per-advertiser 600 req/min cap)
 *   40105 = invalid_access_token
 *   40110 = access_token_expired
 *   40115 = access_denied (consent revoked by user in TikTok dashboard)
 */

import {
  ReauthRequiredError,
  type ReauthReason,
} from "@/lib/google-ads/errors";

// TikTok API error response shape (when response.ok=false OR when
// response.ok=true but body.code != 0 — TikTok signals errors via the
// body's `code` field, NOT just HTTP status).
export interface TiktokApiError {
  code: number;
  message?: string;
  request_id?: string;
}

/**
 * Detect a TikTok API failure indicating the user's access token /
 * refresh token has been rejected. Returns a typed ReauthRequiredError
 * to throw, or null when the error doesn't match a known reauth pattern.
 *
 * Mirrors classifyGoogleAdsError from ADR-017. Logs the classification
 * outcome so if TikTok changes error codes in v1.4 the new pattern
 * surfaces in Vercel logs via the "Auth-like error but no match" warning.
 */
export function classifyTiktokError(
  err: unknown
): ReauthRequiredError | null {
  // Two shapes to handle: (a) a plain Error from `fetch` with TikTok's
  // error message in `.message`, (b) a TiktokApiError object we throw
  // from the api.ts wrapper when body.code != 0.
  let code: number | undefined;
  let message = "";

  if (err && typeof err === "object" && "code" in err) {
    code = Number((err as TiktokApiError).code);
    message = String((err as TiktokApiError).message ?? "");
  } else if (err instanceof Error) {
    message = err.message;
    // Try to extract a code if the error message was formatted by api.ts
    // as "TikTok API error N: ...".
    const match = message.match(/TikTok API error (\d+)/);
    if (match) code = Number(match[1]);
  }

  let result: ReauthRequiredError | null = null;
  if (code === 40105) {
    // invalid_access_token — token rejected outright
    result = new ReauthRequiredError("invalid_grant", "tiktok");
  } else if (code === 40110) {
    // access_token_expired — refresh failed or token aged out
    result = new ReauthRequiredError("token_expired", "tiktok");
  } else if (code === 40115) {
    // access_denied — user revoked consent in TikTok dashboard
    result = new ReauthRequiredError("consent_revoked", "tiktok");
  }

  if (result) {
    console.warn(
      "[tiktok-reauth-classification] Classified as reauth-required:",
      `code=${code}`,
      message
    );
  } else if (
    // Auth-shaped errors that didn't match — log so v1.4 drift surfaces
    code === 40100 // rate-limited — not reauth, distinct class
      ? false
      : message.toLowerCase().includes("token") ||
        message.toLowerCase().includes("auth") ||
        message.toLowerCase().includes("unauthorized") ||
        message.toLowerCase().includes("permission") ||
        (code !== undefined && code >= 40000 && code <= 40999)
  ) {
    console.warn(
      "[tiktok-reauth-classification] Auth-like error but no match:",
      `code=${code}`,
      message
    );
  }

  return result;
}

/**
 * TikTok rate-limit detection. Ported from Meta's isRateLimitError
 * precedent (string-match on response code). TikTok's per-advertiser
 * limit is 600 req/min; recovery is via stale-cache fallback +
 * HTTP 429 with Arabic message when no cache exists.
 *
 * Per ADR-020 §Decision 14.
 */
export function isTiktokRateLimitError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return Number((err as TiktokApiError).code) === 40100;
  }
  if (err instanceof Error) {
    const msg = err.message;
    return (
      msg.includes("TikTok API error 40100") ||
      msg.toLowerCase().includes("rate limit") ||
      msg.toLowerCase().includes("quota exceeded")
    );
  }
  return false;
}
