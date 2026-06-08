/**
 * Search Terms View fetching for Google Ads Search campaigns (M9 / ADR-018).
 *
 * Per ADR-018: per-ad_group list of actual user search queries that
 * triggered an ad in the date range. Mirrors the M7.5 keywords.ts
 * structure — Q1 (unsegmented identity + metrics) + Q2 (segmented
 * purchase merger, 8th sibling of the ADR-011 family).
 *
 * Composite-key requirement per recon Q4 (9% cross-ad_group collision
 * rate on imaa search terms — higher than M7.5 keywords' 6%). Map key
 * is `${adGroupId}${searchTerm}` (control byte SOH) — search
 * terms are arbitrary user text and may contain pipes, so the M7.5
 * pipe separator is unsafe here.
 *
 * GAQL queries against `FROM search_term_view` — natural FROM, no SDK
 * trap. Recon Q1 confirmed full SELECT bundle works on first attempt.
 */

import { GoogleAdsApi, errors } from "google-ads-api";
import { classifyGoogleAdsError } from "./errors";
import type {
  UnifiedAdSearchTerm,
  SearchTermStatus,
  KeywordMatchType,
} from "@/lib/ads/types";

// Control byte (SOH, Start-of-Heading) — Unicode reserves this for
// non-content use; cannot be typed via keyboard. Safe Map-key separator
// for user-typed search terms that may contain pipes/symbols.
const COMPOSITE_KEY_SEP = "";

function compositeKey(adGroupId: string, term: string): string {
  return `${adGroupId}${COMPOSITE_KEY_SEP}${term}`;
}

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

// Standard SearchTermStatusEnum per recon Q1 — no integer drift on imaa.
// Defensive 6-value mapping; UNSPECIFIED + UNKNOWN both collapse to
// UI label "UNKNOWN" (yellow badge).
const SEARCH_TERM_STATUS_MAP: Record<number, SearchTermStatus> = {
  0: "UNKNOWN", // UNSPECIFIED
  1: "UNKNOWN",
  2: "ADDED",
  3: "EXCLUDED",
  4: "ADDED_EXCLUDED",
  5: "NONE",
};

function readSearchTermStatus(raw: unknown): SearchTermStatus {
  if (typeof raw === "number") {
    return SEARCH_TERM_STATUS_MAP[raw] ?? "UNKNOWN";
  }
  if (typeof raw === "string") {
    if (
      raw === "ADDED" ||
      raw === "NONE" ||
      raw === "EXCLUDED" ||
      raw === "ADDED_EXCLUDED" ||
      raw === "UNKNOWN"
    ) {
      return raw;
    }
  }
  return "UNKNOWN";
}

// Match type — same enum as M7 keywords. 2/3/4 = EXACT/PHRASE/BROAD.
// Returns undefined when search term has no triggering keyword
// (rare; UI renders "—").
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

export interface FetchSearchTermsOptions {
  customerId: string;
  refreshToken: string;
  loginCustomerId?: string;
  dateFrom: string;
  dateTo: string;
  /**
   * Set of ad_group IDs to filter on. Search terms are scoped to these
   * ad_groups only. Empty input returns empty Map (no fetch fired).
   */
  adGroupIds: Set<string>;
  /**
   * Purchase conversion-action IDs filter for the ADR-011-family merger
   * (Q2 below). Same null/empty/Set semantics as M7.5 keywords.
   * - null  = cache miss / no actions configured
   * - empty = configured but no PURCHASE-category actions
   * - Set   = filter the segmented Q2 conversions to these action IDs
   */
  purchaseActionIds?: Set<string> | null;
}

/**
 * Fetch search terms for the given ad_groups, returning a Map keyed by
 * ad_group_id → searchTerms[]. Per-ad_group dedup is automatic via the
 * outer Map; per-(ad_group, search_term) dedup via the composite-key
 * accumulator inside the JS pass.
 *
 * Empty input / errors return empty Map (graceful degradation —
 * search terms are an enhancement, not a hard dependency for ad render).
 *
 * Status filtering is applied CLIENT-SIDE in the React component, not
 * here. Returns ALL statuses; UI hides EXCLUDED/UNKNOWN by default.
 * Rationale: avoids cache fragmentation (one cached payload covers all
 * status-filter UI preferences).
 */
export async function fetchSearchTerms(
  options: FetchSearchTermsOptions
): Promise<Map<string, UnifiedAdSearchTerm[]>> {
  const {
    customerId,
    refreshToken,
    loginCustomerId,
    dateFrom,
    dateTo,
    adGroupIds,
    purchaseActionIds,
  } = options;

  if (adGroupIds.size === 0) return new Map();

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!developerToken || !clientId || !clientSecret) {
    console.error("[google-ads/search-terms] Missing OAuth credentials");
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

    const adGroupList = Array.from(adGroupIds).join(", ");

    // Q1: unsegmented identity + cost/clicks/impressions/CTR/CPC.
    // No status WHERE — fetch all statuses, filter client-side per
    // ADR-018 §Decision 3 (avoids cache fragmentation).
    const q1 = `
      SELECT
        search_term_view.search_term,
        search_term_view.status,
        segments.keyword.info.text,
        segments.keyword.info.match_type,
        ad_group.id,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc
      FROM search_term_view
      WHERE ad_group.id IN (${adGroupList})
        AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
        AND campaign.advertising_channel_type = 'SEARCH'
    `;

    // Q1 + Q2 in parallel — both reach Google independently. Wall time
    // = max(latencies) instead of sum.
    const [rows, purchaseTotals] = await Promise.all([
      customer.query(q1),
      fetchPurchaseSearchTermTotals({
        customer,
        adGroupIds,
        dateFrom,
        dateTo,
        purchaseActionIds: purchaseActionIds ?? null,
      }),
    ]);

    // Aggregator: a single (ad_group_id, search_term) pair can appear
    // in multiple rows when Google segments by date implicitly. We
    // sum metrics on the composite key, then layer in the purchase
    // attribution from Q2's Map.
    type Accum = {
      adGroupId: string;
      text: string;
      status: SearchTermStatus;
      matchType?: KeywordMatchType;
      triggeredByKeywordText?: string;
      cost_micros: number;
      impressions: number;
      clicks: number;
      // CTR + average_cpc are weighted averages; recompute from sums.
    };

    const byKey = new Map<string, Accum>();

    for (const row of rows) {
      const adGroupId = row.ad_group?.id;
      const term = row.search_term_view?.search_term;
      if (adGroupId === undefined || adGroupId === null || !term) continue;

      const agId = String(adGroupId);
      const key = compositeKey(agId, term);
      const status = readSearchTermStatus(row.search_term_view?.status);
      const matchType = readMatchType(row.segments?.keyword?.info?.match_type);
      const triggeredByKeywordText = row.segments?.keyword?.info?.text;

      const cost = Number(row.metrics?.cost_micros ?? 0);
      const imp = Number(row.metrics?.impressions ?? 0);
      const clk = Number(row.metrics?.clicks ?? 0);

      const existing = byKey.get(key);
      if (existing) {
        existing.cost_micros += cost;
        existing.impressions += imp;
        existing.clicks += clk;
        // Status from first sighting wins (consistent across an
        // ad_group/term pair within one date range).
      } else {
        byKey.set(key, {
          adGroupId: agId,
          text: term,
          status,
          matchType,
          triggeredByKeywordText:
            typeof triggeredByKeywordText === "string" &&
            triggeredByKeywordText.length > 0
              ? triggeredByKeywordText
              : undefined,
          cost_micros: cost,
          impressions: imp,
          clicks: clk,
        });
      }
    }

    // Group by ad_group_id for the outer Map shape the adapter expects.
    const byAdGroup = new Map<string, UnifiedAdSearchTerm[]>();

    for (const [key, accum] of byKey.entries()) {
      const spend = accum.cost_micros / 1_000_000;
      const ctr =
        accum.impressions > 0
          ? (accum.clicks / accum.impressions) * 100
          : 0;
      const cpc = accum.clicks > 0 ? spend / accum.clicks : 0;

      // ADR-018 §Decision 1 — composite-key lookup for purchase merger.
      // null Map = no purchase data → hasConversionData=false →
      // UI renders "—" with tooltip. Map entry present (even {0,0}) =
      // "tracking configured, real-zero purchases" → renders "0 ر.س" / "0".
      const purchaseEntry = purchaseTotals?.get(key);
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

      const searchTerm: UnifiedAdSearchTerm = {
        text: accum.text,
        status: accum.status,
        matchType: accum.matchType ?? "BROAD", // safe default; UI tolerates
        triggeredByKeywordText: accum.triggeredByKeywordText,
        spend,
        impressions: accum.impressions,
        clicks: accum.clicks,
        ctr,
        cpc,
        purchases,
        revenue,
        roas,
        hasConversionData,
      };

      const existing = byAdGroup.get(accum.adGroupId);
      if (existing) {
        existing.push(searchTerm);
      } else {
        byAdGroup.set(accum.adGroupId, [searchTerm]);
      }
    }

    return byAdGroup;
  } catch (error) {
    // Bubble reauth-class errors (ADR-017) so the existing route-layer
    // isReauthError check (/api/ads/search-terms/route.ts) can surface
    // the Arabic reauth banner. Non-reauth keeps graceful degradation.
    const reauth = classifyGoogleAdsError(error);
    if (reauth) throw reauth;
    const msg = formatGoogleError(error);
    console.error("[google-ads/search-terms] fetchSearchTerms failed:", msg);
    return new Map();
  }
}

// =================================================================
// ADR-018 / M9 — 8th sibling of the ADR-011 merger family.
// Mirrors fetchPurchaseKeywordTotals (M7.5 / keywords.ts) at search-term level.
// =================================================================

// Loose customer-handle type — google-ads-api Customer is dynamic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CustomerHandle = any;

interface FetchPurchaseSearchTermTotalsOptions {
  customer: CustomerHandle;
  adGroupIds: Set<string>;
  dateFrom: string;
  dateTo: string;
  /**
   * Set of conversion_action IDs categorized as PURCHASE/STORE_SALE.
   *  - null  = cache miss / actions never synced → returns null
   *  - empty = configured but no PURCHASE-category actions → returns null
   *  - non-empty = real filter applied; returns Map
   * Matches the strict semantic from fetchPurchaseKeywordTotals (M7.5)
   * which itself mirrors fetchPurchaseAssetGroupTotals (M-PMax).
   */
  purchaseActionIds: Set<string> | null;
}

/**
 * Segmented purchase merger at SEARCH-TERM LEVEL — 8th sibling of the
 * ADR-011 merger family (campaign / time-series / ad / asset_group /
 * keyword / SEARCH_TERM). Same two-query GAQL pattern: cost+clicks
 * live in fetchSearchTerms (Q1 above), this query carries only
 * conversions segmented by segments.conversion_action and filtered
 * to the customer's purchase action IDs.
 *
 * Returns null when:
 * - purchaseActionIds is null (cache miss / actions never synced)
 * - purchaseActionIds.size === 0 (configured but no PURCHASE actions)
 * - Google API call fails (caught here, logged, returns null)
 *
 * Returned Map: composite key `${adGroupId}${searchTerm}` ->
 * {purchases, revenue}. "First sighting" Map semantic preserved: every
 * (ad_group, search_term) pair that appears in the GAQL response gets
 * an entry (initialized at {0,0}) even when none of its rows match a
 * purchase action — preserves the "tracking configured + zero" vs
 * "not configured / no data" distinction in the UI per ADR-011 family
 * convention.
 *
 * CRITICAL — composite key per ADR-018 §Decision 2 + recon Q4:
 * search_term is NOT unique account-wide. Same text reused across 3+
 * ad_groups on imaa (~9% collision rate). Keying by search_term alone
 * would sum unrelated rows. Control-byte separator (SOH = ) is
 * safe for any user-typed text including pipes.
 */
async function fetchPurchaseSearchTermTotals(
  options: FetchPurchaseSearchTermTotalsOptions
): Promise<Map<string, { purchases: number; revenue: number }> | null> {
  const { customer, adGroupIds, dateFrom, dateTo, purchaseActionIds } = options;

  if (purchaseActionIds === null) return null;
  if (purchaseActionIds.size === 0) return null;
  if (adGroupIds.size === 0) return null;

  try {
    const adGroupList = Array.from(adGroupIds).join(", ");

    const query = `
      SELECT
        ad_group.id,
        search_term_view.search_term,
        segments.conversion_action,
        metrics.conversions,
        metrics.conversions_value
      FROM search_term_view
      WHERE ad_group.id IN (${adGroupList})
        AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
        AND campaign.advertising_channel_type = 'SEARCH'
    `;

    const rows = await customer.query(query);

    const byKey = new Map<
      string,
      { purchases: number; revenue: number }
    >();

    for (const row of rows) {
      const agRaw = row.ad_group?.id;
      const term = row.search_term_view?.search_term;
      if (agRaw === undefined || agRaw === null || !term) continue;

      const key = compositeKey(String(agRaw), term);

      // First-sighting init: every (ad_group, term) pair with any
      // segmented row gets an entry (initialized {0,0}) even if NONE of
      // its rows match a purchase action. Preserves "configured + zero"
      // vs "no data" distinction in caller.
      const existing = byKey.get(key) ?? { purchases: 0, revenue: 0 };

      const resourcePath = String(row.segments?.conversion_action ?? "");
      const actionId = resourcePath.split("/").pop() ?? "";

      if (purchaseActionIds.has(actionId)) {
        const conversions = Number(row.metrics?.conversions) || 0;
        const conversionsValue = Number(row.metrics?.conversions_value) || 0;
        existing.purchases += conversions;
        existing.revenue += conversionsValue;
      }

      byKey.set(key, existing);
    }

    return byKey;
  } catch (error) {
    const reauth = classifyGoogleAdsError(error);
    if (reauth) throw reauth;
    const msg = formatGoogleError(error);
    console.error(
      "[google-ads/search-terms] fetchPurchaseSearchTermTotals failed:",
      msg,
      "— degrading search-term purchases/revenue to null"
    );
    return null;
  }
}
