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
        asset.image_asset.full_size_image_url
      FROM asset
      WHERE asset.resource_name IN (${quoted})
    `;

    const rows = await customer.query(query);

    const urlMap = new Map<string, string>();
    for (const row of rows) {
      const resourceName = row.asset?.resource_name;
      // SDK types omit full_size_image_url on IImageAsset — GAQL returns it
      // but the type declarations lag. Cast through unknown to read it.
      const imageAsset = row.asset?.image_asset as
        | { full_size_image_url?: unknown }
        | undefined;
      const url = imageAsset?.full_size_image_url;
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
