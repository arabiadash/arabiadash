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

    const rows = await customer.query(query);

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

      const keyword: UnifiedAdKeyword = {
        id: String(criterionId),
        text,
        matchType,
        status,
        spend: costMicros / 1_000_000,
        impressions,
        clicks,
        ctr: ctrRaw * 100, // Google returns 0.123 for 12.3% — normalize to UI percent
        cpc: avgCpcMicros / 1_000_000,
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
