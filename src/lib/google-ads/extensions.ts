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
import type {
  UnifiedAdExtensions,
  ImageAssetFieldType,
} from "@/lib/ads/types";

/**
 * Image extension field_types per M8 / ADR-014.
 * Authoritative source is the resource_name suffix walk (see Q9/Q10
 * recon — integer 26 resolves to AD_IMAGE on imaa, NOT LANDSCAPE_LOGO
 * as public docs claim). These string literals are matched against
 * the `~`-separated suffix of campaign_asset.resource_name.
 */
const IMAGE_FIELD_TYPES = new Set<string>([
  "AD_IMAGE",
  "BUSINESS_LOGO",
  "LANDSCAPE_LOGO",
  "MARKETING_IMAGE",
  "SQUARE_MARKETING_IMAGE",
  "PORTRAIT_MARKETING_IMAGE",
]);

/**
 * Extract the field_type label from `campaign_asset.resource_name`.
 * Pattern: `customers/X/campaignAssets/CAMPAIGN_ID~ASSET_ID~LABEL`.
 * Returns undefined when the suffix is missing or non-conforming.
 *
 * Per ADR-014 §Decision 7 + memory feedback_resource_name_over_integer_enums:
 * the integer map is unreliable (Google's public docs disagree with
 * on-the-wire reality for image field_types). The suffix is version-stable.
 */
function suffixLabel(resourceName: string): string | undefined {
  if (typeof resourceName !== "string" || resourceName.length === 0) {
    return undefined;
  }
  const parts = resourceName.split("~");
  if (parts.length < 2) return undefined;
  const tail = parts[parts.length - 1];
  return tail.length > 0 ? tail : undefined;
}

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

    // Expand each campaign-level linkage into one Linkage per ad in scope.
    // For IMAGE field_types: enforce strict status='ENABLED' per ADR-014
    // §Decision 3 (user requirement: currently serving only, not
    // historical). M6 text-extension types continue using the != REMOVED
    // filter from the WHERE clause — M6 retrofit deferred per
    // ADR-014 §Open Items §1.
    for (const campLink of campaignAssetLinkages) {
      if (
        IMAGE_FIELD_TYPES.has(campLink.fieldType) &&
        campLink.status !== "ENABLED"
      ) {
        continue;
      }
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
    const imageNames = new Set<string>();

    for (const link of linkages) {
      if (link.fieldType === "SITELINK")
        sitelinkNames.add(link.assetResourceName);
      else if (link.fieldType === "CALLOUT")
        calloutNames.add(link.assetResourceName);
      else if (link.fieldType === "STRUCTURED_SNIPPET")
        snippetNames.add(link.assetResourceName);
      else if (IMAGE_FIELD_TYPES.has(link.fieldType))
        imageNames.add(link.assetResourceName);
    }

    // =================================================================
    // Pass 3: parallel per-type asset fetches (isolated failures)
    // =================================================================

    const [sitelinksMap, calloutsMap, snippetsMap, imagesMap] =
      await Promise.all([
        fetchSitelinks(customer, sitelinkNames),
        fetchCallouts(customer, calloutNames),
        fetchStructuredSnippets(customer, snippetNames),
        fetchImages(customer, imageNames),
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
      } else if (IMAGE_FIELD_TYPES.has(link.fieldType)) {
        const img = imagesMap.get(link.assetResourceName);
        if (img) {
          extensions.images = extensions.images ?? [];
          // Dedup by assetId — imaa proves the same 9 AD_IMAGE assets
          // inherit across 4 campaign_asset rows per ad (Q10). Without
          // dedup an ad inheriting from multiple campaign linkages would
          // render the same image N times.
          if (!extensions.images.some((existing) => existing.assetId === img.assetId)) {
            extensions.images.push({
              ...img,
              fieldType: link.fieldType as ImageAssetFieldType,
            });
          }
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
  /**
   * campaign_asset.status as returned by GAQL (string label).
   * Carried per-row so the image branch can apply strict `= 'ENABLED'`
   * per ADR-014 §Decision 3 while M6 branches (sitelinks/callouts/
   * snippets) continue using the `!= 'REMOVED'` WHERE filter
   * (M6 retrofit deferred per ADR-014 §Open Items §1).
   */
  status?: string;
}

async function fetchAdLevelLinkages(
  customer: CustomerHandle,
  dateFrom: string,
  dateTo: string
): Promise<AdLinkage[]> {
  try {
    // Pre-M8 behavior preserved — this fetcher only services M6 text
    // extensions (SITELINK/CALLOUT/STRUCTURED_SNIPPET) in practice. Image
    // linkages don't attach via ad_group_ad_asset_view (M8 recon Q5
    // returned 0 image rows on imaa) so the suffix-walk pattern used by
    // fetchCampaignAssetLinkages isn't needed here. If Google adds
    // ad-level image attachment in a future API version, re-introduce
    // suffix walk with its own recon probe.
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
    // SELECT additions (M8):
    //  - campaign_asset.status — carried per-row to enforce strict ENABLED
    //    for IMAGE field_types (ADR-014 §Decision 3) without retrofitting
    //    the M6 WHERE filter (deferred per ADR-014 §Open Items §1).
    //  - campaign_asset.resource_name — authoritative field_type label
    //    via `~`-separated suffix (ADR-014 §Decision 7 — public docs
    //    misreport integer 26 as LANDSCAPE_LOGO when on-the-wire it's
    //    AD_IMAGE).
    const query = `
      SELECT
        campaign.id,
        campaign_asset.field_type,
        campaign_asset.asset,
        campaign_asset.status,
        campaign_asset.resource_name
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

      // Authoritative: resource_name suffix. Fallback: integer map.
      const linkResourceNameRaw: unknown = row.campaign_asset?.resource_name;
      const suffix =
        typeof linkResourceNameRaw === "string"
          ? suffixLabel(linkResourceNameRaw)
          : undefined;
      const fieldTypeRaw: unknown = row.campaign_asset?.field_type;
      const fieldType =
        suffix ??
        (typeof fieldTypeRaw === "string"
          ? fieldTypeRaw
          : typeof fieldTypeRaw === "number"
            ? mapFieldTypeIntToString(fieldTypeRaw)
            : undefined);

      const assetResourceNameRaw: unknown = row.campaign_asset?.asset;
      const assetResourceName =
        typeof assetResourceNameRaw === "string"
          ? assetResourceNameRaw
          : undefined;

      const statusRaw: unknown = row.campaign_asset?.status;
      const status =
        typeof statusRaw === "string"
          ? statusRaw
          : typeof statusRaw === "number"
            ? // AssetLinkStatus: 2=ENABLED, 3=REMOVED, 4=PAUSED (order
              // SWAPPED vs the standard 2/3/4 pattern — order-swap trap
              // documented in M8 recon). The WHERE already excludes
              // REMOVED, so this mini-map only needs to disambiguate
              // ENABLED vs PAUSED at the row level.
              statusRaw === 2
              ? "ENABLED"
              : statusRaw === 4
                ? "PAUSED"
                : undefined
            : undefined;

      if (campaignId && fieldType && assetResourceName) {
        out.push({ campaignId, fieldType, assetResourceName, status });
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

/**
 * Image data extracted from `asset.image_asset.*` for a single asset.
 * `fieldType` is set by the caller post-fetch (it lives on the LINKAGE
 * row, not the asset row — same asset can attach as different field_types
 * across linkages).
 */
type ImageAssetData = {
  url: string;
  assetId: string;
  widthPx?: number;
  heightPx?: number;
};

async function fetchImages(
  customer: CustomerHandle,
  resourceNames: Set<string>
): Promise<Map<string, ImageAssetData>> {
  if (resourceNames.size === 0) return new Map();

  try {
    const quoted = Array.from(resourceNames)
      .map((n) => `'${n}'`)
      .join(", ");
    // M8 v1 SELECTs: full_size.{url, width_pixels, height_pixels} all
    // nested under .full_size (verified via SDK protos
    // node_modules/google-ads-api/.../fields.d.ts + live probe against
    // imaa AD_IMAGE assets pre-push 2026-05-26). The flat
    // `full_size_image_url` field that M5 originally used does NOT exist
    // in v23 — rejects with query_error 32 even when SELECTed alone.
    //
    // EXCLUDED from v1: asset.image_asset.file_size + .mime_type.
    // M8 Q1 recon proved bundling them rejects with query_error 32
    // (SDK trap #5). Add only after per-field isolation verification —
    // tracked in ADR-014 §Open Items §4.
    const query = `
      SELECT
        asset.resource_name,
        asset.id,
        asset.image_asset.full_size.url,
        asset.image_asset.full_size.width_pixels,
        asset.image_asset.full_size.height_pixels
      FROM asset
      WHERE asset.resource_name IN (${quoted})
    `;

    const rows = await customer.query(query);

    const map = new Map<string, ImageAssetData>();
    for (const row of rows) {
      const rn = row.asset?.resource_name;
      const assetIdRaw = row.asset?.id;
      // SDK types lag the schema for image_asset sub-fields — cast to
      // a loose shape and validate at runtime. All three image fields
      // live under .full_size in v23.
      const imageAsset = row.asset?.image_asset as
        | {
            full_size?: {
              url?: unknown;
              width_pixels?: unknown;
              height_pixels?: unknown;
            };
          }
        | undefined;
      const url = imageAsset?.full_size?.url;
      const widthRaw = imageAsset?.full_size?.width_pixels;
      const heightRaw = imageAsset?.full_size?.height_pixels;

      if (
        typeof rn === "string" &&
        typeof url === "string" &&
        url.length > 0 &&
        (typeof assetIdRaw === "string" ||
          typeof assetIdRaw === "number")
      ) {
        const widthPx =
          typeof widthRaw === "number"
            ? widthRaw
            : typeof widthRaw === "string" && widthRaw.length > 0
              ? Number(widthRaw) || undefined
              : undefined;
        const heightPx =
          typeof heightRaw === "number"
            ? heightRaw
            : typeof heightRaw === "string" && heightRaw.length > 0
              ? Number(heightRaw) || undefined
              : undefined;
        map.set(rn, {
          url,
          assetId: String(assetIdRaw),
          widthPx,
          heightPx,
        });
      }
    }
    return map;
  } catch (error) {
    const msg = formatGoogleError(error);
    console.error("[google-ads/extensions] fetchImages failed:", msg);
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
// field_type integer → string mapping (FALLBACK ONLY).
//
// Per ADR-014 §Decision 7: the authoritative source is the
// `resource_name` suffix walk via suffixLabel(). This map fires only
// when resource_name is malformed/missing. Integer values per Google's
// AssetFieldTypeEnum proto + on-the-wire reality on imaa.
//
// ⚠ Public Google Ads docs list integer 26 = LANDSCAPE_LOGO, but Q9
// recon proved 26 = AD_IMAGE on imaa (11th integer-drift instance,
// first where public docs are themselves wrong — see
// feedback_resource_name_over_integer_enums.md). The mapping below
// follows on-the-wire reality, not the docs.
// =================================================================
const FIELD_TYPE_MAP: Record<number, string> = {
  // M6 text extensions
  11: "CALLOUT",
  12: "STRUCTURED_SNIPPET",
  13: "SITELINK",
  // M8 image extensions
  5: "MARKETING_IMAGE",
  18: "BUSINESS_NAME", // adjacent integer surfaced by Q9 — included for diagnostic logging
  19: "SQUARE_MARKETING_IMAGE",
  20: "PORTRAIT_MARKETING_IMAGE",
  26: "AD_IMAGE", // public docs wrong; on-the-wire on imaa
  27: "BUSINESS_LOGO",
  // LANDSCAPE_LOGO integer unverified on imaa (0 rows in Q10). Add when
  // a real account surfaces it via suffix walk; do not guess.
};

function mapFieldTypeIntToString(n: number): string | undefined {
  return FIELD_TYPE_MAP[n];
}
