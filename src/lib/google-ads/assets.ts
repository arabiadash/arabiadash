/**
 * Asset URL resolution for Google Ads.
 *
 * Google Ads GAQL returns asset RESOURCE NAMES (customers/X/assets/Y)
 * for ad image fields. To get actual URLs, we query the asset entity
 * separately. This module performs that batched resolution.
 *
 * Phase 4.8 M5 Commit 2 — enables RDA marketing_images and IMAGE_AD
 * image rendering in the Reports Google tab.
 */

import { GoogleAdsApi } from "google-ads-api";

export interface FetchAssetUrlsOptions {
  customerId: string;
  refreshToken: string;
  loginCustomerId?: string;
  resourceNames: string[];
}

/**
 * Resolves a batch of asset resource names to their full-size image URLs.
 * Empty input returns an empty Map (no API call). Errors return an empty
 * Map (graceful degradation — image fields stay undefined per ADR-008).
 */
export async function fetchAssetUrls(
  options: FetchAssetUrlsOptions
): Promise<Map<string, string>> {
  const { customerId, refreshToken, loginCustomerId, resourceNames } = options;

  if (resourceNames.length === 0) {
    return new Map();
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!developerToken || !clientId || !clientSecret) {
    console.error("[google-ads/assets] Missing OAuth credentials");
    return new Map();
  }

  try {
    const api = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });

    const customer = api.Customer({
      customer_id: customerId,
      refresh_token: refreshToken,
      ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
    });

    // Dedup and quote resource names for GAQL IN clause
    const uniqueNames = Array.from(new Set(resourceNames));
    const quoted = uniqueNames.map((n) => `'${n}'`).join(", ");

    const query = `
      SELECT
        asset.resource_name,
        asset.image_asset.full_size.url
      FROM asset
      WHERE asset.resource_name IN (${quoted})
    `;

    const rows = await customer.query(query);

    const urlMap = new Map<string, string>();
    for (const row of rows) {
      const resourceName = row.asset?.resource_name;
      // v23 nests the image URL under .full_size.url — NOT the flat
      // .full_size_image_url field. The previous flat path rejected with
      // query_error 32 in v23, silently breaking RDA marketing_images
      // (caught return new Map() at the bottom suppressed it for an
      // unknown duration). Pre-push verification for M8 surfaced this
      // M5 bug; fixed here in the same commit as M8 since the root
      // cause + the fix are identical (see also fetchImages in
      // src/lib/google-ads/extensions.ts and ADR-014 §Open Items §3).
      const imageAsset = row.asset?.image_asset as
        | { full_size?: { url?: unknown } }
        | undefined;
      const url = imageAsset?.full_size?.url;
      if (
        typeof resourceName === "string" &&
        typeof url === "string" &&
        url.length > 0
      ) {
        urlMap.set(resourceName, url);
      }
    }

    return urlMap;
  } catch (error) {
    console.error("[google-ads/assets] Failed to fetch asset URLs:", error);
    return new Map();
  }
}
