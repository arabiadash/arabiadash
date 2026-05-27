/**
 * Thin HTTP layer for TikTok Marketing API v1.3.
 *
 * Per ADR-020 §Decision 1 + §Decision 6 + §Decision 7: this is the
 * single file that owns ALL v1.3 endpoint details. When v1.4 ships,
 * bump TIKTOK_API_VERSION + patch any field paths here. Everything
 * downstream (normalize.ts + providers/tiktok.ts) is insulated.
 *
 * Returns TikTok-native response shapes — does NOT return UnifiedAd
 * or other normalized types. Shape mapping lives in normalize.ts.
 *
 * Pattern mirrors src/lib/meta/api.ts (also direct fetch() against
 * an external advertising API with no SDK). Auth header is the
 * `Access-Token` request header, not query param — TikTok diverges
 * from Meta + Google here.
 */

// ───────────────────────────────────────────────────────────────────
// Version pin per ADR-020 §Decision 7 — single source of truth.
// When TikTok deprecates v1.3 → v1.4, this is the ONLY constant
// to update (plus any field-path adjustments downstream in normalize).
// ───────────────────────────────────────────────────────────────────
export const TIKTOK_API_VERSION = "v1.3";
export const TIKTOK_BASE_URL = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;
export const TIKTOK_AUTH_BASE_URL = "https://business-api.tiktok.com";

// ───────────────────────────────────────────────────────────────────
// Common envelope: TikTok wraps every response in { code, message,
// data, request_id }. code=0 = success; non-zero throws via api.ts.
// ───────────────────────────────────────────────────────────────────
interface TiktokEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

/**
 * Centralized GET helper. Sets the Access-Token header + Content-Type,
 * unwraps the envelope, throws on non-zero `code` with a structured
 * error message that classifyTiktokError can pattern-match.
 *
 * Per ADR-020 §Decision 15: every TikTok call lands here so timing
 * instrumentation can be added in one place during Session 3's perf
 * gate.
 */
async function tiktokGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${TIKTOK_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TikTok API HTTP ${response.status} on ${path}: ${text}`
    );
  }

  const json = (await response.json()) as TiktokEnvelope<T>;
  if (json.code !== 0) {
    throw new Error(
      `TikTok API error ${json.code} on ${path}: ${json.message}`
    );
  }
  return json.data;
}

// ───────────────────────────────────────────────────────────────────
// /oauth2/advertiser/get/ — discover advertiser_ids the user
// authorized during OAuth. Required for the account selector.
//
// Per TikTok docs, response shape:
// {
//   "list": [
//     { "advertiser_id": "...", "advertiser_name": "..." },
//     ...
//   ]
// }
// ───────────────────────────────────────────────────────────────────
export interface TiktokAccessibleAdvertiser {
  advertiser_id: string;
  advertiser_name: string;
}

interface AdvertiserGetResponse {
  list: TiktokAccessibleAdvertiser[];
}

export async function getAccessibleAdvertisers(
  accessToken: string,
  appId: string,
  secret: string
): Promise<TiktokAccessibleAdvertiser[]> {
  // /oauth2/advertiser/get/ requires app_id + secret as query params
  // (unlike other endpoints which auth via Access-Token header only).
  // This is TikTok's documented quirk for the advertiser discovery
  // endpoint specifically.
  const url = new URL(`${TIKTOK_BASE_URL}/oauth2/advertiser/get/`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("secret", secret);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TikTok API HTTP ${response.status} on advertiser/get: ${text}`
    );
  }

  const json = (await response.json()) as TiktokEnvelope<AdvertiserGetResponse>;
  if (json.code !== 0) {
    throw new Error(
      `TikTok API error ${json.code} on advertiser/get: ${json.message}`
    );
  }
  return json.data.list ?? [];
}

// ───────────────────────────────────────────────────────────────────
// /advertiser/info/ — fetch enrichment fields (currency, timezone,
// display_name) for a specific advertiser_id. Used to populate
// connections.metadata at select-accounts time.
//
// Per TikTok docs:
// {
//   "list": [{
//     "advertiser_id": "...",
//     "name": "...",
//     "currency": "USD" | "SAR" | ...,
//     "timezone": "Asia/Riyadh",
//     "country": "SA",
//     "status": "STATUS_ENABLE" | "STATUS_FROZEN" | ...,
//     ...
//   }]
// }
// ───────────────────────────────────────────────────────────────────
export interface TiktokAdvertiserInfo {
  advertiser_id: string;
  name: string;
  currency: string;
  timezone: string;
  country?: string;
  status: string;
}

interface AdvertiserInfoResponse {
  list: TiktokAdvertiserInfo[];
}

export async function getAdvertiserInfo(
  accessToken: string,
  advertiserIds: string[]
): Promise<TiktokAdvertiserInfo[]> {
  if (advertiserIds.length === 0) return [];
  return (
    await tiktokGet<AdvertiserInfoResponse>(
      "/advertiser/info/",
      accessToken,
      {
        advertiser_ids: JSON.stringify(advertiserIds),
      }
    )
  ).list ?? [];
}
