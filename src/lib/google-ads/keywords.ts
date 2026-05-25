/**
 * Keyword fetching for Google Ads Search campaigns.
 *
 * Per ADR-015: per-ad_group keyword list with metrics for the Search-side
 * targeting layer. Mirrors the M6 fetchAdExtensions hardened-error pattern.
 *
 * GAQL uses `FROM keyword_view` (NOT `FROM ad_group_criterion`) per recon
 * Q3a finding — ad_group_criterion REJECTS metrics with query_error 49
 * (12th SDK-vs-runtime trap, "the natural FROM is rejected; use the view
 * resource instead"). keyword_view exposes both ad_group_criterion.*
 * identity AND metrics.* via implicit join.
 *
 * Phase 4.8 M7.
 */

import { GoogleAdsApi, errors } from "google-ads-api";
import type {
  UnifiedAdKeyword,
  KeywordMatchType,
  KeywordStatusFilter,
} from "@/lib/ads/types";

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

/**
 * MATCH_TYPE_MAP — verified clean enum via M7 recon 2026-05-26 Q1.
 * Standard 2/3/4 = EXACT/PHRASE/BROAD pattern. No suffix walk needed.
 * If future Google API version introduces new match types (e.g.,
 * NEAR_PHRASE), add to map. Suffix walk discipline not enforced
 * here per recon proof.
 */
const MATCH_TYPE_MAP: Record<number, KeywordMatchType> = {
  2: "EXACT",
  3: "PHRASE",
  4: "BROAD",
};

function readMatchType(raw: unknown): KeywordMatchType | undefined {
  if (typeof raw === "number") return MATCH_TYPE_MAP[raw];
  if (typeof raw === "string") {
    if (raw === "EXACT" || raw === "PHRASE" || raw === "BROAD") return raw;
  }
  return undefined;
}

/**
 * Status int → string. CriterionStatus follows the standard
 * 2/3/4 = ENABLED/PAUSED/REMOVED pattern (NOT swapped like AssetLinkStatus).
 * Verified via M7 recon Q1.
 */
function readStatus(raw: unknown): "ENABLED" | "PAUSED" | "REMOVED" | undefined {
  if (typeof raw === "number") {
    if (raw === 2) return "ENABLED";
    if (raw === 3) return "PAUSED";
    if (raw === 4) return "REMOVED";
  }
  if (typeof raw === "string") {
    if (raw === "ENABLED" || raw === "PAUSED" || raw === "REMOVED") return raw;
  }
  return undefined;
}

/**
 * QualityScore enum (BELOW_AVERAGE / AVERAGE / ABOVE_AVERAGE) returns
 * undefined on most low-traffic keywords per recon Q2 — that's normal
 * Google behavior. UI handles undefined via "—" fallback.
 */
type QualityLabel = "BELOW_AVERAGE" | "AVERAGE" | "ABOVE_AVERAGE" | undefined;

function readQualityLabel(raw: unknown): QualityLabel {
  if (typeof raw === "string") {
    if (raw === "BELOW_AVERAGE" || raw === "AVERAGE" || raw === "ABOVE_AVERAGE")
      return raw;
  }
  if (typeof raw === "number") {
    if (raw === 2) return "BELOW_AVERAGE";
    if (raw === 3) return "AVERAGE";
    if (raw === 4) return "ABOVE_AVERAGE";
  }
  return undefined;
}

export interface FetchKeywordsOptions {
  customerId: string;
  refreshToken: string;
  loginCustomerId?: string;
  dateFrom: string;
  dateTo: string;
  /**
   * Set of ad_group IDs to filter on. Keywords are scoped to these
   * ad_groups only. Empty/missing returns empty Map (no fetch fired).
   */
  adGroupIds: Set<string>;
  /**
   * "enabled" = strict status = 'ENABLED' (default, ADR-015 §Decision 5).
   * "all"     = status != 'REMOVED' (includes PAUSED).
   */
  statusFilter: KeywordStatusFilter;
  /**
   * Purchase conversion-action IDs filter for the M7.5 ADR-011-family
   * merger. null = cache miss / no actions configured → keyword rows
   * surface hasConversionData=false + purchases/revenue=null. Set =
   * filter the segmented Q2 conversions to only these action IDs (the
   * 7th ADR-011 merger sibling, mirrors fetchPurchaseAssetGroupTotals).
   */
  purchaseActionIds?: Set<string> | null;
}

/**
 * Fetch keywords for the given ad_groups, returning a Map keyed by
 * ad_group_id → keywords[]. Per-ad-group dedup is automatic via the Map.
 * Caller applies the per-ad lookup in normalizeAd.
 *
 * Empty input / errors return empty Map (graceful degradation —
 * keywords are an enhancement, not a hard dependency for ad rendering).
 */
export async function fetchKeywords(
  options: FetchKeywordsOptions
): Promise<Map<string, UnifiedAdKeyword[]>> {
  const {
    customerId,
    refreshToken,
    loginCustomerId,
    dateFrom,
    dateTo,
    adGroupIds,
    statusFilter,
    purchaseActionIds,
  } = options;

  if (adGroupIds.size === 0) return new Map();

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!developerToken || !clientId || !clientSecret) {
    console.error("[google-ads/keywords] Missing OAuth credentials");
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

    // Per ADR-015 §Decision 5: strict ENABLED default, opt-in to include
    // PAUSED via UI "الكل" filter. Both cases exclude REMOVED.
    const statusClause =
      statusFilter === "all"
        ? "ad_group_criterion.status != 'REMOVED'"
        : "ad_group_criterion.status = 'ENABLED'";

    const adGroupList = Array.from(adGroupIds).join(", ");

    // GAQL `FROM keyword_view` exposes both ad_group_criterion identity
    // AND metrics via implicit join — required because FROM
    // ad_group_criterion rejects metrics (query_error 49, M7 recon Q3a).
    const query = `
      SELECT
        ad_group.id,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc
      FROM keyword_view
      WHERE ${statusClause}
        AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.negative = FALSE
        AND campaign.advertising_channel_type = 'SEARCH'
        AND ad_group.id IN (${adGroupList})
        AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
    `;

    // Parallel: Q1 (identity + cost/clicks/impressions/CTR/CPC) AND Q2
    // (ADR-011-family purchase totals filtered by purchaseActionIds).
    // Both reach Google independently — wall time = max(Q1, Q2) instead of sum.
    const [rows, purchaseTotals] = await Promise.all([
      customer.query(query),
      fetchPurchaseKeywordTotals({
        customer,
        adGroupIds,
        dateFrom,
        dateTo,
        statusFilter,
        purchaseActionIds: purchaseActionIds ?? null,
      }),
    ]);

    const byAdGroup = new Map<string, UnifiedAdKeyword[]>();

    for (const row of rows) {
      const adGroupId = row.ad_group?.id;
      const criterionId = row.ad_group_criterion?.criterion_id;
      const text = row.ad_group_criterion?.keyword?.text;
      const matchType = readMatchType(
        row.ad_group_criterion?.keyword?.match_type
      );
      const status = readStatus(row.ad_group_criterion?.status);

      if (
        adGroupId === undefined ||
        adGroupId === null ||
        criterionId === undefined ||
        criterionId === null ||
        typeof text !== "string" ||
        !text ||
        !matchType ||
        !status
      ) {
        continue;
      }

      const qualityInfo = row.ad_group_criterion?.quality_info as
        | {
            quality_score?: unknown;
            creative_quality_score?: unknown;
            post_click_quality_score?: unknown;
            search_predicted_ctr?: unknown;
          }
        | undefined;

      const qualityScoreRaw = qualityInfo?.quality_score;
      const qualityScore =
        typeof qualityScoreRaw === "number" ? qualityScoreRaw : undefined;

      const costMicros = Number(row.metrics?.cost_micros ?? 0);
      const impressions = Number(row.metrics?.impressions ?? 0);
      const clicks = Number(row.metrics?.clicks ?? 0);
      const ctrRaw = Number(row.metrics?.ctr ?? 0);
      const avgCpcMicros = Number(row.metrics?.average_cpc ?? 0);
      const spend = costMicros / 1_000_000;

      // ADR-016 §Decision 7 — purchase attribution semantic mirrors
      // M-PMax fetchPurchaseAssetGroupTotals. null Map = no
      // purchaseActionIds → hasConversionData=false → purchases/revenue
      // surface as null → UI renders "—" with tooltip. Map entry present
      // (even with {0,0}) = "tracking configured, real-zero purchases" →
      // renders "0 ر.س" / "0". Map present but key absent = same as
      // null Map for that specific keyword.
      //
      // CRITICAL — composite key (ad_group_id|criterion_id): ad_group_criterion
      // .criterion_id is NOT unique account-wide; the same numeric ID is
      // reused across ad_groups when keyword text matches (e.g., "عطور"
      // → criterion_id=85274071 in 3 different ad_groups on imaa). Keying
      // the Map by criterion_id alone collides → each colliding keyword
      // receives summed purchases from ALL ad_groups (~11.6% over-count
      // surfaced pre-merge on perfumes-KSA). See
      // feedback_merger_composite_keys.md for the lesson.
      const purchaseEntry = purchaseTotals?.get(
        `${adGroupId}|${criterionId}`
      );
      const hasConversionData =
        purchaseTotals != null && purchaseEntry !== undefined;
      const purchases: number | null = hasConversionData
        ? purchaseEntry!.purchases
        : null;
      const revenue: number | null = hasConversionData
        ? purchaseEntry!.revenue
        : null;
      const roas: number | null =
        hasConversionData && spend > 0
          ? purchaseEntry!.revenue / spend
          : null;

      const keyword: UnifiedAdKeyword = {
        id: String(criterionId),
        text,
        matchType,
        status,
        spend,
        impressions,
        clicks,
        ctr: ctrRaw * 100, // Google returns 0.123 for 12.3% — normalize to UI percent
        cpc: avgCpcMicros / 1_000_000,
        purchases,
        revenue,
        roas,
        hasConversionData,
        qualityScore,
        creativeQualityScore: readQualityLabel(qualityInfo?.creative_quality_score),
        postClickQualityScore: readQualityLabel(
          qualityInfo?.post_click_quality_score
        ),
        searchPredictedCtr: readQualityLabel(qualityInfo?.search_predicted_ctr),
      };

      const adGroupKey = String(adGroupId);
      const existing = byAdGroup.get(adGroupKey);
      if (existing) {
        existing.push(keyword);
      } else {
        byAdGroup.set(adGroupKey, [keyword]);
      }
    }

    return byAdGroup;
  } catch (error) {
    const msg = formatGoogleError(error);
    console.error("[google-ads/keywords] fetchKeywords failed:", msg);
    return new Map();
  }
}

// =================================================================
// ADR-016 / M7.5 — 7th sibling of the ADR-011 merger family.
// Mirrors fetchPurchaseAssetGroupTotals (google.ts) at keyword level.
// =================================================================

/**
 * Loose customer-handle type — google-ads-api's Customer is dynamic.
 * Same pragmatic exception as in extensions.ts (no clean SDK type).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CustomerHandle = any;

interface FetchPurchaseKeywordTotalsOptions {
  customer: CustomerHandle;
  adGroupIds: Set<string>;
  dateFrom: string;
  dateTo: string;
  statusFilter: KeywordStatusFilter;
  /**
   * Set of conversion_action IDs categorized as PURCHASE/STORE_SALE.
   *  - null = cache miss / actions never synced → returns null
   *  - empty Set = configured but no PURCHASE-category actions → returns null
   *  - non-empty Set = real filter applied; returns Map
   * Matches the strict semantic from fetchPurchaseAssetGroupTotals
   * (Commit 5, ADR-013) which Commit 4b retroactively aligned all
   * mergers to.
   */
  purchaseActionIds: Set<string> | null;
}

/**
 * Segmented purchase merger at KEYWORD LEVEL — 7th sibling of the
 * ADR-011 merger family (campaign / time-series / ad / asset_group /
 * product_group [removed M-PMax-retail] / shopping_product [same] /
 * KEYWORD). Same two-query GAQL pattern: cost+clicks live in
 * fetchKeywords (Q1 above), this query carries only conversions
 * segmented by segments.conversion_action and filtered to the
 * customer's purchase action IDs.
 *
 * Returns null when:
 * - purchaseActionIds is null (cache miss / actions never synced)
 * - purchaseActionIds.size === 0 (configured but no PURCHASE actions)
 * - Google API call fails (caught here, logged, returns null)
 *
 * Returned Map: ad_group_criterion.criterion_id (string) -> {purchases, revenue}.
 * "First sighting" Map semantic preserved: every keyword that appears
 * in the GAQL response gets an entry (initialized at {0,0}) even when
 * none of its rows match a purchase action — this preserves the
 * "tracking configured + zero" vs "not configured / no data"
 * distinction in the UI (renders "0 ر.س" vs "—" per ADR-016 §Decision 7).
 *
 * Caller (fetchKeywords above) uses the Map presence + entry presence
 * to compute hasConversionData semantically. M-PMax convention carried.
 */
async function fetchPurchaseKeywordTotals(
  options: FetchPurchaseKeywordTotalsOptions
): Promise<Map<string, { purchases: number; revenue: number }> | null> {
  const {
    customer,
    adGroupIds,
    dateFrom,
    dateTo,
    statusFilter,
    purchaseActionIds,
  } = options;

  if (purchaseActionIds === null) return null;
  if (purchaseActionIds.size === 0) return null;
  if (adGroupIds.size === 0) return null;

  try {
    // Match the Q1 status filter exactly so the two result sets are
    // joinable on criterion_id without ghost rows.
    const statusClause =
      statusFilter === "all"
        ? "ad_group_criterion.status != 'REMOVED'"
        : "ad_group_criterion.status = 'ENABLED'";

    const adGroupList = Array.from(adGroupIds).join(", ");

    const query = `
      SELECT
        ad_group.id,
        ad_group_criterion.criterion_id,
        segments.conversion_action,
        metrics.conversions,
        metrics.conversions_value
      FROM keyword_view
      WHERE ${statusClause}
        AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.negative = FALSE
        AND campaign.advertising_channel_type = 'SEARCH'
        AND ad_group.id IN (${adGroupList})
        AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
    `;

    const rows = await customer.query(query);

    const byCriterion = new Map<
      string,
      { purchases: number; revenue: number }
    >();

    for (const row of rows) {
      const criterionIdRaw = row.ad_group_criterion?.criterion_id;
      const adGroupIdRaw = row.ad_group?.id;
      if (
        criterionIdRaw === undefined ||
        criterionIdRaw === null ||
        adGroupIdRaw === undefined ||
        adGroupIdRaw === null
      ) {
        continue;
      }
      // Composite Map key (ad_group_id|criterion_id) — criterion_id is
      // NOT unique account-wide; keying by criterion_id alone would
      // collide across ad_groups and over-attribute purchases to
      // colliding keywords. Verified empirically on imaa 2026-05-27
      // (11 of 192 criterion_ids span multiple ad_groups). See caller
      // (fetchKeywords merge step above) for the matching lookup +
      // feedback_merger_composite_keys.md for the pre-push probe
      // discipline lesson.
      const compositeKey = `${adGroupIdRaw}|${criterionIdRaw}`;

      // First-sighting init: every keyword with any segmented GAQL row
      // gets an entry (initialized {0,0}) even if NONE of its rows
      // match a purchase action. This produces hasConversionData=true
      // in the caller — preserving the "configured + zero purchases"
      // vs "no data" distinction (M-PMax precedent).
      const existing = byCriterion.get(compositeKey) ?? {
        purchases: 0,
        revenue: 0,
      };

      const resourcePath = String(row.segments?.conversion_action ?? "");
      const actionId = resourcePath.split("/").pop() ?? "";

      if (purchaseActionIds.has(actionId)) {
        const conversions = Number(row.metrics?.conversions) || 0;
        const conversionsValue = Number(row.metrics?.conversions_value) || 0;
        existing.purchases += conversions;
        existing.revenue += conversionsValue;
      }

      byCriterion.set(compositeKey, existing);
    }

    return byCriterion;
  } catch (error) {
    const msg = formatGoogleError(error);
    console.error(
      "[google-ads/keywords] fetchPurchaseKeywordTotals failed:",
      msg,
      "— degrading keyword purchases/revenue to null"
    );
    return null;
  }
}
