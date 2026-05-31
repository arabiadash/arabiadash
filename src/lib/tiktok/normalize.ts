/**
 * TikTok-shape → Unified-shape transformation layer.
 *
 * Per ADR-020 §Decision 6 (thin-boundary 3-layer): this is the second
 * file to patch when TikTok v1.3 → v1.4 changes shapes. api.ts owns
 * endpoint URLs + types; this file owns the UnifiedInsight + UnifiedAd
 * shape mapping; providers/tiktok.ts is the adapter that ties them
 * together.
 *
 * Pure functions — no I/O, no SDK awareness, no side effects.
 *
 * Source of truth for the empirical findings encoded below:
 *   docs/decisions/020-tiktok-adapter-v1.md
 *   - §Report-Shape Empirical Findings (metric names, CTR scale,
 *     string-valued metrics, purchase metric family choice)
 *   - §12c (creative-card 3-path discriminator + URL expiry)
 *   - §13b / §13c (long-lived access_token in refresh_token column)
 */

import type { TiktokReportRow } from "./api";
import type { UnifiedCampaign, UnifiedInsight } from "@/lib/ads/types";

// ═══════════════════════════════════════════════════════════════════
// Extractor helpers — TikTok's /report/integrated/get/ returns ALL
// metrics as strings (per empirical K1 finding). These coerce
// defensively: missing field → 0; non-numeric → 0. The `|| 0` fallback
// catches NaN from invalid numeric strings without losing real zero
// values (parseFloat("0.00") === 0 is truthy-false but Number.isFinite
// is still true).
// ═══════════════════════════════════════════════════════════════════

function extractNumber(metrics: Record<string, string>, key: string): number {
  const raw = metrics[key];
  if (raw === undefined || raw === "") return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function extractInt(metrics: Record<string, string>, key: string): number {
  const raw = metrics[key];
  if (raw === undefined || raw === "") return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

// ═══════════════════════════════════════════════════════════════════
// Status collapse — TikTok's operation_status + secondary_status →
// UnifiedCampaign.status ("ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED").
//
// Empirical mapping observed in 2b-1 kickoff probe (2026-05-31):
//   operation_status="ENABLE"   secondary_status="CAMPAIGN_STATUS_ENABLE"   → ACTIVE
//   operation_status="DISABLE"  secondary_status="CAMPAIGN_STATUS_DISABLE"  → PAUSED
//
// DELETED + ARCHIVED collapse logic is best-guess (substring-match
// on secondary_status) — refined as we encounter real deleted/archived
// campaigns in integration testing. Matches Meta's "unrecognized →
// PAUSED" conservative default per src/lib/meta/api.ts:metaAdToUnified.
// ═══════════════════════════════════════════════════════════════════

export function collapseTiktokStatus(
  operationStatus: string | undefined,
  secondaryStatus: string | undefined
): UnifiedCampaign["status"] {
  if (operationStatus === "ENABLE") return "ACTIVE";
  if (secondaryStatus && /DELETE/i.test(secondaryStatus)) return "DELETED";
  if (secondaryStatus && /ARCHIVE/i.test(secondaryStatus)) return "ARCHIVED";
  return "PAUSED";
}

// ═══════════════════════════════════════════════════════════════════
// Dimension extractors — TikTok echoes requested dimensions back in
// row.dimensions. Named helpers make adapter code more readable than
// raw Record-key access.
// ═══════════════════════════════════════════════════════════════════

export function extractCampaignIdFromRow(row: TiktokReportRow): string | undefined {
  return row.dimensions?.campaign_id;
}

export function extractAdIdFromRow(row: TiktokReportRow): string | undefined {
  return row.dimensions?.ad_id;
}

// ═══════════════════════════════════════════════════════════════════
// /report/integrated/get/ row → UnifiedInsight
// ═══════════════════════════════════════════════════════════════════

export interface NormalizeReportRowOpts {
  /**
   * Per-account currency from /advertiser/info/, stamped at adapter
   * construction. Per ADR-005 row-level currency policy. NEVER
   * hardcode — the JST USD-denominated account on the test apparatus
   * (4 SAR + 1 USD across 5 active advertisers per the 2026-05-31
   * discover probe) is the empirical canary that would catch a SAR
   * hardcode.
   */
  currency: string;
  /**
   * Date range from the request — TikTok's report rows do NOT echo
   * dates at aggregate levels (only when a time_increment dimension
   * like stat_time_day is added). Both come from the resolved
   * request range, passed in by the adapter.
   */
  dateStart: string;
  dateStop: string;
  /**
   * Insight aggregation level. campaignName + status only meaningful
   * at "campaign" level; mapper ignores them otherwise (status is
   * silently dropped when level !== "campaign").
   */
  level: "account" | "campaign" | "ad";
  /**
   * Campaign name from getCampaigns lookup, joined by campaign_id by
   * the adapter. Already trimmed per the 2026-05-31 /campaign/get/
   * probe finding (TikTok preserves operator-input leading whitespace
   * e.g. `" Sales Smart + | UAE"`). Adapter is responsible for the
   * trim before passing in.
   */
  campaignName?: string;
  /**
   * Campaign status from collapseTiktokStatus on the campaign row.
   * Populated ONLY when level === "campaign"; undefined otherwise.
   */
  status?: UnifiedCampaign["status"];
}

/**
 * Map one TikTok report row to a UnifiedInsight.
 *
 * Semantics per the report-shape findings:
 *   - All raw metrics are STRINGS (K1) — coerced via parseFloat /
 *     parseInt with 0 fallback.
 *   - CTR is a 0-100 percentage (K2) — passthrough, no scale convert.
 *   - Purchase metrics use the complete_payment family per ADR-020
 *     §Decision 2 (verified valid K4). The attribution-split
 *     vta_purchase / cta_purchase is deferred to a v2 TikTok-specific
 *     surface and NOT consumed here.
 *
 * Conversion semantics — INTENTIONAL DIVERGENCE FROM GOOGLE:
 *   purchases + revenue are NEVER null for TikTok. The platform is
 *   pixel-native (no purchaseActionIds cache, no "no data yet" state),
 *   so 0 means "zero sales in window", not "no conversion data".
 *   hasConversionData=true reflects this — the value is always
 *   authoritative. DO NOT "fix" purchases/revenue to null on zero —
 *   that would break the "0 vs —" UI distinction (UnifiedInsight
 *   contract §65-83 + ADR-011 family precedent + Meta normalizeInsight
 *   sibling at src/lib/ads/providers/meta.ts:283-284).
 *
 * roas + costPerPurchase ARE null per the UnifiedInsight contract
 * when their preconditions fail (zero spend, zero purchases). The
 * mapper computes these client-side rather than trusting TikTok's
 * complete_payment_roas (which returns "0.00" on zero-spend — we
 * want null per contract, NOT the value-zero collision).
 */
export function normalizeReportRowToInsight(
  row: TiktokReportRow,
  opts: NormalizeReportRowOpts
): UnifiedInsight {
  const m = row.metrics ?? {};

  const spend = extractNumber(m, "spend");
  const purchases = extractInt(m, "complete_payment");
  const revenue = extractNumber(m, "total_purchase_value");

  const roas = spend > 0 ? revenue / spend : null;
  const costPerPurchase = purchases > 0 ? spend / purchases : null;

  return {
    provider: "tiktok",
    currency: opts.currency,
    campaignId: extractCampaignIdFromRow(row),
    campaignName: opts.campaignName,
    spend,
    impressions: extractInt(m, "impressions"),
    clicks: extractInt(m, "clicks"),
    reach: extractInt(m, "reach"),
    frequency: extractNumber(m, "frequency"),
    ctr: extractNumber(m, "ctr"),       // K2: 0-100 percentage — passthrough
    cpc: extractNumber(m, "cpc"),
    cpm: extractNumber(m, "cpm"),
    purchases,                           // number (never null for TikTok — pixel-native)
    revenue,                             // number (never null for TikTok — pixel-native)
    roas,                                // number | null per contract
    addToCart: 0,                        // v1 scope — TikTok has add_to_cart metric, deferred to v2
    initiateCheckout: 0,                 // v1 scope — TikTok has initiate_checkout, deferred to v2
    leads: 0,                            // v1 scope — lead-gen not in ArabiaDash ecommerce focus
    costPerPurchase,                     // number | null per contract
    costPerLead: 0,                      // v1 scope (leads always 0)
    hasConversionData: true,             // TikTok pixel-native per ADR-020 §Decision 2
    status: opts.level === "campaign" ? opts.status : undefined,
    dateStart: opts.dateStart,
    dateStop: opts.dateStop,
  };
}
