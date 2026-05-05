import { randomBytes } from "crypto";

export const META_API_VERSION = "v21.0";
export const META_OAUTH_BASE_URL = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`;
export const META_SCOPES = ["ads_read", "business_management"] as const;

export interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface MetaAdAccount {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
}

export interface MetaError {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

export function generateOAuthState(): string {
  return randomBytes(32).toString("hex");
}

export function getMetaAuthUrl(state: string): string {
  const clientId = process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!clientId) {
    throw new Error("META_APP_ID environment variable is not set");
  }
  if (!redirectUri) {
    throw new Error("META_REDIRECT_URI environment variable is not set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: META_SCOPES.join(","),
    response_type: "code",
  });

  return `${META_OAUTH_BASE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string
): Promise<MetaTokenResponse> {
  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Meta OAuth env vars are not properly configured");
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Token exchange failed: ${response.status} ${errorText}`
    );
  }

  return response.json() as Promise<MetaTokenResponse>;
}

export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<MetaTokenResponse> {
  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Meta OAuth env vars are not properly configured");
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`;
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortLivedToken,
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Long-lived token exchange failed: ${response.status} ${errorText}`
    );
  }

  return response.json() as Promise<MetaTokenResponse>;
}
