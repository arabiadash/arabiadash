/**
 * Asset Extensions resolution for Google Ads.
 *
 * Per ADR-012: per-type queries against the `asset` resource, dispatched
 * in parallel via Promise.allSettled-style isolation. Attribution via
 * `ad_group_ad_asset_view`.
 *
 * v1 scope: SITELINK + CALLOUT + STRUCTURED_SNIPPET.
 *
 * Phase 4.8 M6 Commit 2.
 */

import { GoogleAdsApi, errors } from "google-ads-api";
import type { UnifiedAdExtensions } from "@/lib/ads/types";

/**
 * Extract a readable error string from a Google Ads SDK error.
 * Mirrors the pattern used in fetchAds catch (M5 lesson) — without this,
 * `GoogleAdsFailure.toString()` returns "[object Object]" and the actual
 * query_error code stays hidden.
 */
function formatGoogleError(error: unknown): string {
  if (error instanceof errors.GoogleAdsFailure) {
    const details = error.errors
      ?.map((e) => {
        const code = JSON.stringify(e.error_code);
        return `${e.message ?? "(no message)"} [${code}]`;
      })
      .join("; ");
    return details ?? "GoogleAdsFailure (no detail)";
  }
  return error instanceof Error ? error.message : String(error);
}

export interface FetchAdExtensionsOptions {
  customerId: string;
  refreshToken: string;
  loginCustomerId?: string;
  dateFrom: string;
  dateTo: string;
  /**
   * Map of ad_id → campaign_id for the ads in scope. Required to attach
   * campaign-level extensions to each ad (Google Ads inheritance pattern:
   * an ad inherits the extensions attached to its parent campaign).
   */
  adIdToCampaignId: Map<string, string>;
}

/**
 * Fetches all Asset Extensions linked to ads via ad_group_ad_asset_view,
 * resolves each type via parallel per-type queries, and returns a Map
 * keyed by ad_id → UnifiedAdExtensions.
 *
 * Empty input or errors return empty Map (graceful degradation).
 * Per-type failures are isolated — one bad query doesn't break others.
 * Hardened error logging per ADR-008 + M5 lesson — no silent catches.
 */
export async function fetchAdExtensions(
  options: FetchAdExtensionsOptions
): Promise<Map<string, UnifiedAdExtensions>> {
  const {
    customerId,
    refreshToken,
    loginCustomerId,
    dateFrom,
    dateTo,
    adIdToCampaignId,
  } = options;

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!developerToken || !clientId || !clientSecret) {
    console.error("[google-ads/extensions] Missing OAuth credentials");
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

    // =================================================================
    // Pass 1: get (ad_id, field_type, asset_resource_name) tuples
    // =================================================================

    interface Linkage {
      adId: string;
      fieldType: string;
      assetResourceName: string;
    }

    // ad_group_ad_asset_view catches only assets directly attached to ads.
    // Campaign-level assets (the common Google Ads pattern) live on
    // campaign_asset and inherit to every ad in the campaign. Run both
    // queries in parallel; merge expanding campaign-level rows per ad
    // via adIdToCampaignId.
    const [adLevelLinkages, campaignAssetLinkages] = await Promise.all([
      fetchAdLevelLinkages(customer, dateFrom, dateTo),
      fetchCampaignAssetLinkages(customer),
    ]);

    const linkages: Linkage[] = [...adLevelLinkages];

    // Build campaign_id → [adId,...] index from the caller-provided map
    const campaignToAdIds = new Map<string, string[]>();
    for (const [adId, campId] of adIdToCampaignId) {
      const existing = campaignToAdIds.get(campId);
      if (existing) existing.push(adId);
      else campaignToAdIds.set(campId, [adId]);
    }

    // Expand each campaign-level linkage into one Linkage per ad in scope
    for (const campLink of campaignAssetLinkages) {
      const adIds = campaignToAdIds.get(campLink.campaignId);
      if (!adIds) continue;
      for (const adId of adIds) {
        linkages.push({
          adId,
          fieldType: campLink.fieldType,
          assetResourceName: campLink.assetResourceName,
        });
      }
    }

    if (linkages.length === 0) return new Map();

    // Group resource names by field_type (deduplicated via Set)
    const sitelinkNames = new Set<string>();
    const calloutNames = new Set<string>();
    const snippetNames = new Set<string>();

    for (const link of linkages) {
      if (link.fieldType === "SITELINK")
        sitelinkNames.add(link.assetResourceName);
      else if (link.fieldType === "CALLOUT")
        calloutNames.add(link.assetResourceName);
      else if (link.fieldType === "STRUCTURED_SNIPPET")
        snippetNames.add(link.assetResourceName);
    }

    // =================================================================
    // Pass 3: parallel per-type asset fetches (isolated failures)
    // =================================================================

    const [sitelinksMap, calloutsMap, snippetsMap] = await Promise.all([
      fetchSitelinks(customer, sitelinkNames),
      fetchCallouts(customer, calloutNames),
      fetchStructuredSnippets(customer, snippetNames),
    ]);

    // =================================================================
    // Pass 4: join linkages → per-ad extensions
    // =================================================================

    const result = new Map<string, UnifiedAdExtensions>();

    for (const link of linkages) {
      let extensions = result.get(link.adId);
      if (!extensions) {
        extensions = {};
        result.set(link.adId, extensions);
      }

      if (link.fieldType === "SITELINK") {
        const sitelink = sitelinksMap.get(link.assetResourceName);
        if (sitelink) {
          extensions.sitelinks = extensions.sitelinks ?? [];
          extensions.sitelinks.push(sitelink);
        }
      } else if (link.fieldType === "CALLOUT") {
        const callout = calloutsMap.get(link.assetResourceName);
        if (callout) {
          extensions.callouts = extensions.callouts ?? [];
          extensions.callouts.push(callout);
        }
      } else if (link.fieldType === "STRUCTURED_SNIPPET") {
        const snippet = snippetsMap.get(link.assetResourceName);
        if (snippet) {
          extensions.structuredSnippets = extensions.structuredSnippets ?? [];
          extensions.structuredSnippets.push(snippet);
        }
      }
    }

    return result;
  } catch (error) {
    const msg = formatGoogleError(error);
    console.error("[google-ads/extensions] unexpected failure:", msg);
    return new Map();
  }
}

// =================================================================
// Linkage fetchers
// =================================================================

interface AdLinkage {
  adId: string;
  fieldType: string;
  assetResourceName: string;
}

interface CampaignLinkage {
  campaignId: string;
  fieldType: string;
  assetResourceName: string;
}

async function fetchAdLevelLinkages(
  customer: CustomerHandle,
  dateFrom: string,
  dateTo: string
): Promise<AdLinkage[]> {
  try {
    const query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad_asset_view.field_type,
        ad_group_ad_asset_view.asset
      FROM ad_group_ad_asset_view
      WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
        AND ad_group_ad.status != 'REMOVED'
    `;

    const rows = await customer.query(query);
    if (!rows || rows.length === 0) return [];

    const out: AdLinkage[] = [];
    for (const row of rows) {
      const adIdRaw = row.ad_group_ad?.ad?.id;
      const adId =
        adIdRaw !== undefined && adIdRaw !== null
          ? String(adIdRaw)
          : undefined;
      const fieldTypeRaw: unknown = row.ad_group_ad_asset_view?.field_type;
      const fieldType =
        typeof fieldTypeRaw === "string"
          ? fieldTypeRaw
          : typeof fieldTypeRaw === "number"
            ? mapFieldTypeIntToString(fieldTypeRaw)
            : undefined;
      const assetResourceNameRaw: unknown =
        row.ad_group_ad_asset_view?.asset;
      const assetResourceName =
        typeof assetResourceNameRaw === "string"
          ? assetResourceNameRaw
          : undefined;

      if (adId && fieldType && assetResourceName) {
        out.push({ adId, fieldType, assetResourceName });
      }
    }
    return out;
  } catch (error) {
    const msg = formatGoogleError(error);
    console.error("[google-ads/extensions] fetchAdLevelLinkages failed:", msg);
    return [];
  }
}

/**
 * Campaign-level asset linkages. This is the COMMON pattern in Google Ads
 * (Asset section shows "Level: Campaign" for most sitelinks/callouts).
 * ad_group_ad_asset_view does NOT include these.
 *
 * No date predicate on campaign_asset — it's a structural attachment that
 * doesn't have a date range concept. Status filter excludes removed assets.
 */
async function fetchCampaignAssetLinkages(
  customer: CustomerHandle
): Promise<CampaignLinkage[]> {
  try {
    const query = `
      SELECT
        campaign.id,
        campaign_asset.field_type,
        campaign_asset.asset
      FROM campaign_asset
      WHERE campaign_asset.status != 'REMOVED'
    `;

    const rows = await customer.query(query);
    if (!rows || rows.length === 0) return [];

    const out: CampaignLinkage[] = [];
    for (const row of rows) {
      const campaignIdRaw = row.campaign?.id;
      const campaignId =
        campaignIdRaw !== undefined && campaignIdRaw !== null
          ? String(campaignIdRaw)
          : undefined;
      const fieldTypeRaw: unknown = row.campaign_asset?.field_type;
      const fieldType =
        typeof fieldTypeRaw === "string"
          ? fieldTypeRaw
          : typeof fieldTypeRaw === "number"
            ? mapFieldTypeIntToString(fieldTypeRaw)
            : undefined;
      const assetResourceNameRaw: unknown = row.campaign_asset?.asset;
      const assetResourceName =
        typeof assetResourceNameRaw === "string"
          ? assetResourceNameRaw
          : undefined;

      if (campaignId && fieldType && assetResourceName) {
        out.push({ campaignId, fieldType, assetResourceName });
      }
    }
    return out;
  } catch (error) {
    const msg = formatGoogleError(error);
    console.error(
      "[google-ads/extensions] fetchCampaignAssetLinkages failed:",
      msg
    );
    return [];
  }
}

// =================================================================
// Per-type fetchers — isolated failures (M5 lesson)
// =================================================================

type SitelinkData = NonNullable<UnifiedAdExtensions["sitelinks"]>[number];
type StructuredSnippetData = NonNullable<
  UnifiedAdExtensions["structuredSnippets"]
>[number];

/**
 * Loose customer type — google-ads-api's Customer is dynamic and the SDK
 * doesn't export a clean public type. Pragmatic exception, matches
 * existing pattern in conversion-actions.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CustomerHandle = any;

async function fetchSitelinks(
  customer: CustomerHandle,
  resourceNames: Set<string>
): Promise<Map<string, SitelinkData>> {
  if (resourceNames.size === 0) return new Map();

  try {
    const quoted = Array.from(resourceNames)
      .map((n) => `'${n}'`)
      .join(", ");
    // Modern Google Ads API: only `link_text` is reliably selectable from
    // sitelink_asset (description-style fields exist on the resource but
    // reject in SELECT — query_error 32 in v23). `final_urls` lives at the
    // asset level, not nested under sitelink_asset.
    const query = `
      SELECT
        asset.resource_name,
        asset.sitelink_asset.link_text,
        asset.final_urls
      FROM asset
      WHERE asset.resource_name IN (${quoted})
    `;

    const rows = await customer.query(query);

    const map = new Map<string, SitelinkData>();
    for (const row of rows) {
      const rn = row.asset?.resource_name;
      const linkText: unknown = row.asset?.sitelink_asset?.link_text;
      if (typeof rn === "string" && typeof linkText === "string" && linkText) {
        const finalUrlsRaw: unknown = row.asset?.final_urls;
        const finalUrl = Array.isArray(finalUrlsRaw)
          ? finalUrlsRaw.find(
              (u): u is string => typeof u === "string" && u.length > 0
            )
          : undefined;
        map.set(rn, {
          text: linkText,
          finalUrl,
        });
      }
    }
    return map;
  } catch (error) {
    const msg = formatGoogleError(error);
    console.error("[google-ads/extensions] fetchSitelinks failed:", msg);
    return new Map();
  }
}

async function fetchCallouts(
  customer: CustomerHandle,
  resourceNames: Set<string>
): Promise<Map<string, string>> {
  if (resourceNames.size === 0) return new Map();

  try {
    const quoted = Array.from(resourceNames)
      .map((n) => `'${n}'`)
      .join(", ");
    const query = `
      SELECT
        asset.resource_name,
        asset.callout_asset.callout_text
      FROM asset
      WHERE asset.resource_name IN (${quoted})
    `;

    const rows = await customer.query(query);

    const map = new Map<string, string>();
    for (const row of rows) {
      const rn = row.asset?.resource_name;
      const text: unknown = row.asset?.callout_asset?.callout_text;
      if (typeof rn === "string" && typeof text === "string" && text) {
        map.set(rn, text);
      }
    }
    return map;
  } catch (error) {
    const msg = formatGoogleError(error);
    console.error("[google-ads/extensions] fetchCallouts failed:", msg);
    return new Map();
  }
}

async function fetchStructuredSnippets(
  customer: CustomerHandle,
  resourceNames: Set<string>
): Promise<Map<string, StructuredSnippetData>> {
  if (resourceNames.size === 0) return new Map();

  try {
    const quoted = Array.from(resourceNames)
      .map((n) => `'${n}'`)
      .join(", ");
    const query = `
      SELECT
        asset.resource_name,
        asset.structured_snippet_asset.header,
        asset.structured_snippet_asset.values
      FROM asset
      WHERE asset.resource_name IN (${quoted})
    `;

    const rows = await customer.query(query);

    const map = new Map<string, StructuredSnippetData>();
    for (const row of rows) {
      const rn = row.asset?.resource_name;
      const snippet = row.asset?.structured_snippet_asset;
      const header: unknown = snippet?.header;
      const valuesRaw: unknown = snippet?.values;
      if (
        typeof rn === "string" &&
        typeof header === "string" &&
        header &&
        Array.isArray(valuesRaw)
      ) {
        const values = valuesRaw.filter(
          (v): v is string => typeof v === "string" && v.length > 0
        );
        if (values.length > 0) {
          map.set(rn, { header, values });
        }
      }
    }
    return map;
  } catch (error) {
    const msg = formatGoogleError(error);
    console.error(
      "[google-ads/extensions] fetchStructuredSnippets failed:",
      msg
    );
    return new Map();
  }
}

// =================================================================
// field_type integer → string mapping
// Subset of AssetFieldTypeEnum we care about per ADR-012 v1 scope.
// SDK sometimes returns integer enum values instead of strings depending
// on the GAQL response codec; this normalizes both shapes.
// =================================================================
const FIELD_TYPE_MAP: Record<number, string> = {
  11: "CALLOUT",
  12: "STRUCTURED_SNIPPET",
  13: "SITELINK",
};

function mapFieldTypeIntToString(n: number): string | undefined {
  return FIELD_TYPE_MAP[n];
}
