/**
 * Typed errors for Google Ads OAuth/credential failures. Surfaces
 * actionable reauth requirements to the API + UI layers instead of
 * collapsing to a generic 500.
 *
 * See ADR-017.
 */

export type ReauthReason = "invalid_grant" | "consent_revoked" | "token_expired";

export class ReauthRequiredError extends Error {
  readonly provider: "google";
  readonly reason: ReauthReason;
  readonly reauthUrl: string;

  constructor(reason: ReauthReason) {
    super(`Google Ads reauth required: ${reason}`);
    this.name = "ReauthRequiredError";
    this.provider = "google";
    this.reason = reason;
    this.reauthUrl = "/dashboard/connections/google";
  }
}

export function isReauthError(err: unknown): err is ReauthRequiredError {
  return err instanceof ReauthRequiredError;
}

/**
 * Detect a Google Ads SDK failure that indicates the user's refresh
 * token is no longer usable. Returns a typed ReauthRequiredError to
 * throw, or null when the error doesn't match a known reauth pattern.
 *
 * Logs the classification outcome so if Google changes their error
 * message format and the substring matching silently fails, Vercel
 * logs surface the new pattern via the "Auth-like error but no
 * match" warning. Add the new substring to the classifier when that
 * fires.
 */
export function classifyGoogleAdsError(
  err: unknown
): ReauthRequiredError | null {
  if (!(err instanceof Error)) return null;
  const msg = err.message.toLowerCase();

  let result: ReauthRequiredError | null = null;
  if (msg.includes("invalid_grant")) {
    result = new ReauthRequiredError("invalid_grant");
  } else if (msg.includes("access_denied") || msg.includes("consent")) {
    result = new ReauthRequiredError("consent_revoked");
  } else if (
    msg.includes("token expired") ||
    msg.includes("token has been expired")
  ) {
    result = new ReauthRequiredError("token_expired");
  }

  if (result) {
    console.warn(
      "[reauth-classification] Classified as reauth-required:",
      err.message
    );
  } else if (
    msg.includes("auth") ||
    msg.includes("credential") ||
    msg.includes("unauthorized") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("permission")
  ) {
    console.warn(
      "[reauth-classification] Auth-like error but no match:",
      err.message
    );
  }

  return result;
}
