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

import type {
  TiktokAdRow,
  TiktokFileVideoInfoRow,
  TiktokIdentityVideoDetail,
  TiktokReportRow,
} from "./api";
import type {
  UnifiedAdTiktok,
  UnifiedCampaign,
  UnifiedInsight,
} from "@/lib/ads/types";

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
// Restructured per ADR-020 §StatusCollapse (2026-05-31) — the
// previous version returned "ACTIVE" unconditionally on
// operation_status === "ENABLE", which silently mislabeled 71/100
// ENABLE IMAA ads whose parent campaigns were paused (69 visible
// after the spend filter; 70% of "active" badges were wrong).
//
// Signal hierarchy:
//   1. operation_status — authoritative top-level signal (exact match)
//   2. secondary_status — delivery-state nuance for ENABLE ads
//      (NON_DELIVERY_SECONDARY: campaign/adgroup paused)
//   3. defensive regex fallback — forward-compat against TikTok
//      introducing new operation_status values in v1.4+
//
// Failure-mode asymmetry guiding the rule set:
//   - Exact-match (===) branches are SAFE even when unverified — if
//     TikTok doesn't use the value, the branch never fires.
//   - Regex/substring branches are RISKY when unverified — they can
//     accidentally match a delivering-state string and mislabel an
//     actually-active ad as PAUSED (hiding customer ads = trust
//     collapse, worse than the original over-counting bug).
// ═══════════════════════════════════════════════════════════════════

/**
 * Secondary-status patterns indicating an ENABLE ad is NOT actually
 * delivering — parent campaign or adgroup is paused, ad is inactive
 * by hierarchy even though its own operation_status === "ENABLE".
 *
 * Per ADR-020 §StatusCollapse conservative-pattern decision
 * (2026-05-31):
 *
 *   `CAMPAIGN_DISABLE`  — direct evidence: 71 IMAA ads exhibit
 *                         secondary_status = "AD_STATUS_CAMPAIGN_DISABLE"
 *                         (live-probed scripts/_tiktok-secondary-enum-
 *                         probe.mts). The user-flagged "98 active
 *                         doesn't feel right" → reality 29 active
 *                         was driven by the 69 visible ones.
 *
 *   `ADGROUP_DISABLE`   — included by structural symmetry: TikTok's
 *                         parent hierarchy is campaign → adgroup → ad
 *                         (Meta-precedent), and the naming convention
 *                         for parent-disable is identical. Not in
 *                         IMAA but high-confidence for the symmetric
 *                         case.
 *
 * ⚠️ MAINTENANCE RULE — NEVER add a guess to this regex.
 *
 * The risk asymmetry is steep: a regex pattern matching a
 * delivering-state string by accident would mislabel a truly-active
 * ad as PAUSED, HIDING it from the customer's grid. This is worse
 * than the original over-counting bug (which only mislabels the
 * BADGE — spend/revenue/roas numbers stay correct).
 *
 * Adding more patterns (REJECT / AUDIT / TIME_DONE / NO_BUDGET /
 * etc.) requires either:
 *   (a) a live probe identifying the exact string from a real
 *       customer account, OR
 *   (b) explicit TikTok docs confirming the value verbatim
 *
 * Accounts with rejected / under-review / time-expired / budget-
 * exhausted ads will continue to over-count those as ACTIVE in v1
 * — documented coverage gap. Add patterns when evidence arrives,
 * not before.
 */
const NON_DELIVERY_SECONDARY = /CAMPAIGN_DISABLE|ADGROUP_DISABLE/i;

/**
 * SINGLE SOURCE OF TRUTH for TikTok status collapse. Called from:
 *   - normalizeCampaign in providers/tiktok.ts (campaign-level)
 *   - buildCampaignLookup in providers/tiktok.ts (campaign-level via
 *     report-row insight normalization)
 *   - normalizeTiktokAdToUnified in this file (ad-level, with an
 *     ARCHIVED→PAUSED type-narrowing coercion since UnifiedAdCommon's
 *     status union excludes ARCHIVED)
 *
 * MUST NOT be inlined / duplicated anywhere else. Duplication-drift
 * was discovered on 2026-05-31 when normalizeTiktokAdToUnified had
 * its own parallel implementation that didn't receive the
 * §StatusCollapse fix → the fix appeared inert in the dashboard until
 * the inline copy was deleted in favor of this delegate path.
 */
export function collapseTiktokStatus(
  operationStatus: string | undefined,
  secondaryStatus: string | undefined
): UnifiedCampaign["status"] {
  // Primary path — operation_status is the authoritative top-level
  // signal. Exact-match (===) branches are safe even when unverified
  // for IMAA: if TikTok doesn't use these values for op_status, the
  // branches never fire and execution falls through to the defensive
  // regex fallback at the bottom. ZERO false-PAUSED risk.
  if (operationStatus === "DELETE") return "DELETED";
  if (operationStatus === "ARCHIVE") return "ARCHIVED";

  if (operationStatus === "ENABLE") {
    // ENABLE ads still need a secondary_status check for parent-pause
    // cases (per §StatusCollapse). The probe-supported
    // NON_DELIVERY_SECONDARY pattern catches campaign/adgroup-paused
    // while staying conservative against false-PAUSED of truly-active
    // ads.
    if (secondaryStatus && NON_DELIVERY_SECONDARY.test(secondaryStatus)) {
      return "PAUSED";
    }
    return "ACTIVE";
  }

  if (operationStatus === "DISABLE") return "PAUSED";

  // Defensive fallback — for operation_status values we don't
  // recognize (TikTok may introduce new states in v1.4+), parse the
  // secondary_status regex as the last-resort signal. Live probe
  // 2026-05-31 confirmed these regexes don't false-match any IMAA-
  // observed value (AD_STATUS_DELIVERY_OK, AD_STATUS_CAMPAIGN_DISABLE,
  // CAMPAIGN_STATUS_ENABLE, CAMPAIGN_STATUS_DISABLE — none contain
  // "DELETE" or "ARCHIVE" substrings). Belt-and-suspenders, zero
  // cost, forward-compat.
  if (secondaryStatus && /DELETE/i.test(secondaryStatus)) return "DELETED";
  if (secondaryStatus && /ARCHIVE/i.test(secondaryStatus)) return "ARCHIVED";
  return "PAUSED"; // conservative default — Meta-precedent
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
  // Revenue source = total_complete_payment_rate per ADR-020 §2b
  // (website attribution). The original total_purchase_value belongs
  // to the active_pay (app-attribution) family and returns 0 for
  // website pixel stores. See api.ts INSIGHTS_METRICS_ACCOUNT for the
  // ⚠️ NAMING TRAP note explaining the _rate-suffix-but-actually-value
  // quirk.
  const revenue = extractNumber(m, "total_complete_payment_rate");

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

// ═══════════════════════════════════════════════════════════════════
// /ad/get/ row + matching /report/integrated/get/ AUCTION_AD row →
// UnifiedAdTiktok
//
// Per ADR-020 §12c §1: type_data carries the path-routing
// discriminators (videoId / tiktokItemId / imageIds + identityType +
// identityId) so the 2c URL-resolve route can route WITHOUT
// re-calling /ad/get/.
//
// Per §12c §2: posterUrl is NEVER populated here — URLs are
// signed/expiring and must be resolved at render time. Mapper sets
// posterUrl to undefined; 2c populates it just-in-time.
//
// Per §12c §4: ALL /ad/get/ fields are optional/defensive (silently-
// dropped mode 3 is real on Spark Ads). Every read uses `?.` +
// nullish-coalesce.
// ═══════════════════════════════════════════════════════════════════

export interface NormalizeTiktokAdOpts {
  /**
   * Per-account currency — same source + policy as the report mapper.
   */
  currency: string;
  /**
   * Campaign name from getCampaigns lookup, already trimmed by the
   * adapter (handles operator-input leading whitespace per the
   * /campaign/get/ probe finding).
   */
  campaignName?: string;
  /**
   * Campaign objective_type from getCampaigns lookup (e.g.
   * "WEB_CONVERSIONS"). Empty string when the campaign join misses
   * (orphan ad row). Required by the type contract — never undefined.
   */
  objectiveType: string;
}

/**
 * Map one TikTok /ad/get/ row + optional matching report row to a
 * UnifiedAdTiktok.
 *
 * insightRow undefined = no matching AUCTION_AD report row in
 * window. All metrics default to 0 (NOT undefined) for consistency
 * with UnifiedAdCommon's non-nullable spend/impressions/clicks. The
 * spend === 0 + impressions === 0 combination is the "no activity"
 * signal consumers can check; videoViews is similarly 0 (not
 * undefined) to match — distinguishing "no insight join" from "ran
 * but no plays" is too subtle for the UI and would invite drift
 * across spend/impressions/clicks/videoViews readers.
 *
 * Conversion semantics (pixel-native — same as the report mapper):
 *   purchases + revenue ALWAYS number (never null for TikTok).
 *   roas + costPerPurchase null per contract on zero-spend / zero-
 *   purchases (computed, not trusted from complete_payment_roas).
 */
export function normalizeTiktokAdToUnified(
  adRow: TiktokAdRow,
  insightRow: TiktokReportRow | undefined,
  opts: NormalizeTiktokAdOpts
): UnifiedAdTiktok {
  const m = insightRow?.metrics ?? {};

  const spend = extractNumber(m, "spend");
  const purchases = extractInt(m, "complete_payment");
  // Revenue metric MUST mirror normalizeReportRowToInsight's §2b
  // correction. The original `total_purchase_value` here was
  // duplication-drift from before §2b landed — that metric is the
  // app-attribution (active_pay) family which returns 0 for any
  // website-pixel store (live-verified on IMAA). The §2b fix swapped
  // it to `total_complete_payment_rate` (the website-attribution
  // metric — same naming-trap as the request-side definition in
  // api.ts:INSIGHTS_METRICS_ACCOUNT) for the account+campaign
  // normalizer but missed THIS ad-level normalizer, leaving per-ad
  // revenue silently 0 for all TikTok ads. Surfaced on 2026-05-31
  // by the same duplication-audit pass that caught the status-
  // collapse drift. Both fixes shipped together as a single bundle.
  // Maintenance rule: this line MUST stay in sync with
  // normalizeReportRowToInsight's revenue line — they share a
  // single semantic source-of-truth (the §2b website-attribution
  // metric); divergence has the same silent-data-corruption blast
  // radius the status-collapse drift had.
  const revenue = extractNumber(m, "total_complete_payment_rate");
  const roas = spend > 0 ? revenue / spend : null;

  // Status collapse — delegated to the shared collapseTiktokStatus
  // helper (single source of truth for op_status + secondary_status →
  // unified status mapping). MUST NOT be re-inlined: this function
  // previously had its own copy of the buggy "ENABLE → ACTIVE without
  // checking secondary_status" logic that survived the §StatusCollapse
  // fix as dead-code drift. Surfaced on 2026-05-31 retest when the fix
  // showed zero visible effect on the ad grid. See ADR-020
  // §StatusCollapse for the historical context.
  //
  // Type-narrowing coercion: collapseTiktokStatus returns the
  // 4-value UnifiedCampaign["status"] (includes ARCHIVED);
  // UnifiedAdCommon.status is the 3-value
  // "ACTIVE" | "PAUSED" | "DELETED" union (no ARCHIVED). TikTok ads
  // empirically never return ARCHIVED at the operation_status level
  // (it's a campaign/adgroup-only enum per the live probe), so the
  // coercion branch never fires in practice — it exists to satisfy
  // the narrower union type + future-proof against a hypothetical
  // TikTok API change.
  const collapsedStatus = collapseTiktokStatus(
    adRow.operation_status,
    adRow.secondary_status
  );
  const status: UnifiedAdTiktok["status"] =
    collapsedStatus === "ARCHIVED" ? "PAUSED" : collapsedStatus;

  // Defensive id/name reads per §12c §4. ad_id is always present in
  // practice; defensive against the silently-dropped mode 3 edge.
  const id = adRow.ad_id ?? "";
  const name = adRow.ad_name?.trim() ?? "";

  // Spark Ad embed-player URL per §12c §6 — constructed only when
  // tiktokItemId is set (path B). NEVER constructed for path A
  // (direct uploads have no item_id) or path C (no item_id either).
  const tiktokVideoUrl = adRow.tiktok_item_id
    ? `https://www.tiktok.com/player/v1/${adRow.tiktok_item_id}`
    : undefined;

  return {
    ad_type: "TIKTOK_AD",
    id,
    name,
    status,
    campaignId: adRow.campaign_id,
    campaignName: opts.campaignName,
    adsetId: adRow.adgroup_id,           // TikTok ad_group → UnifiedAdCommon adset terminology bridge
    adsetName: undefined,                 // /adgroup/get/ deferred to v2
    spend,
    impressions: extractInt(m, "impressions"),
    clicks: extractInt(m, "clicks"),
    ctr: extractNumber(m, "ctr"),        // 0-100 percentage passthrough (K2)
    cpc: extractNumber(m, "cpc"),
    purchases,                            // number (never null for TikTok — pixel-native)
    revenue,                              // number (never null for TikTok — pixel-native)
    roas,                                 // number | null per contract
    hasConversionData: true,              // TikTok pixel-native per ADR-020 §Decision 2
    currency: opts.currency,
    provider: "tiktok",
    type_data: {
      // Path discriminators per §12c §1 — cached so 2c can route
      // without re-calling /ad/get/.
      videoId: adRow.video_id ?? undefined,  // TikTok returns null explicitly; normalize to undefined for type cleanliness
      tiktokItemId: adRow.tiktok_item_id,
      identityType: adRow.identity_type,
      identityId: adRow.identity_id,
      imageIds: adRow.image_ids ?? [],
      // URL fields — NOT populated here per §12c §2 (signed/expiring).
      posterUrl: undefined,
      // Path B embed-player URL (constructed above).
      tiktokVideoUrl,
      // Required string field — defaults to empty when campaign join misses.
      objective_type: opts.objectiveType,
      // Silently-dropped field per §12c §4 — never populated in v1.
      callToAction: undefined,
      // Per-ad view count from AUCTION_AD report metrics.
      videoViews: extractInt(m, "video_play_actions"),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// URL-resolution mappers per ADR-020 §12c §3
//
// TWO mappers — different input types, same output shape. Consumed
// by the 2c URL-resolve route after it routes via
// routeCreativeByIdentityType + fetches the matching endpoint.
//
// Both endpoints return signed/expiring URLs (hours-scale TTL).
// expiresAt is the parsed expiry instant; UI may use it to invalidate
// + re-request before failure, though the simpler model is "always
// re-fetch on render".
// ═══════════════════════════════════════════════════════════════════

export interface TikTokCreativeUrls {
  /** Cover/poster image URL (signed, expiring). */
  posterUrl: string;
  /** Playable MP4 URL (signed, expiring). */
  playableUrl: string;
  /** When the signed URLs expire. */
  expiresAt: Date;
  /** Video duration in seconds (float — e.g. 10.033). */
  duration: number;
  /** Video pixel width (typically 1080 for TikTok 9:16). */
  width: number;
  /** Video pixel height (typically 1920 for TikTok 9:16). */
  height: number;
  /** Full post caption — path B only (Spark Ads carry the source post text). */
  caption?: string;
  /** Item type — path B only ("VIDEO" | "CAROUSEL"). */
  itemType?: string;
  /** Spark Ad authorization status — path B only ("AUTHORIZED" etc.). */
  authStatus?: string;
  /** Creator display name — path D (oEmbed) only. See ADR-020 §DCO-Identity. */
  creatorName?: string;
  /** Creator @handle (TikTok unique_id) — path D (oEmbed) only. */
  creatorHandle?: string;
  /** Creator profile URL on tiktok.com — path D (oEmbed) only. */
  creatorUrl?: string;
}

/**
 * Parse the `x-expires=<epoch>` query param off a signed TikTok CDN
 * URL. Defensive: returns now + 1 hour on parse failure (URL still
 * works for that envelope of time in most observed cases).
 */
function parseExpiresFromXExpiresQueryParam(url: string): Date {
  try {
    const parsed = new URL(url);
    const xExpires = parsed.searchParams.get("x-expires");
    if (xExpires) {
      const epoch = parseInt(xExpires, 10);
      if (Number.isFinite(epoch) && epoch > 0) {
        return new Date(epoch * 1000);
      }
    }
  } catch {
    // URL constructor threw — defensive fallback below
  }
  return new Date(Date.now() + 60 * 60 * 1000);
}

/**
 * Path A — /file/video/ad/info/ row → TikTokCreativeUrls.
 *
 * preview_url carries an explicit `preview_url_expire_time` field
 * (datetime string e.g. "2026-05-31 11:56:41") — used directly.
 * video_cover_url uses the x-expires query-param convention — we
 * pick the earlier of the two as the effective expiry.
 */
export function normalizeFileVideoAdInfoToCreative(
  row: TiktokFileVideoInfoRow
): TikTokCreativeUrls {
  const previewExpires = new Date(row.preview_url_expire_time);
  const coverExpires = parseExpiresFromXExpiresQueryParam(
    row.video_cover_url
  );
  // Conservative: use the earlier of the two — first to expire wins.
  const expiresAt =
    previewExpires.getTime() < coverExpires.getTime()
      ? previewExpires
      : coverExpires;

  return {
    posterUrl: row.video_cover_url,
    playableUrl: row.preview_url,
    expiresAt,
    duration: row.duration,
    width: row.width,
    height: row.height,
  };
}

/**
 * Path B — /identity/video/info/ video_detail → TikTokCreativeUrls.
 *
 * Both URLs use the x-expires query-param convention (no explicit
 * expire-time field like path A's preview_url_expire_time). We
 * parse from the playable URL (typically expires first per probe
 * observation — shorter TTL on video streams than poster images).
 *
 * Bonus fields path A doesn't have: caption (post text), itemType
 * (VIDEO vs CAROUSEL), authStatus (Spark authorization state).
 */
export function normalizeIdentityVideoInfoToCreative(
  detail: TiktokIdentityVideoDetail
): TikTokCreativeUrls {
  return {
    posterUrl: detail.video_info.poster_url,
    playableUrl: detail.video_info.url,
    expiresAt: parseExpiresFromXExpiresQueryParam(detail.video_info.url),
    duration: detail.video_info.duration,
    width: detail.video_info.width,
    height: detail.video_info.height,
    caption: detail.text,
    itemType: detail.item_type,
    authStatus: detail.auth_info?.ad_auth_status,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Creative-path dispatcher per ADR-020 §12c §1
//
// Routes on RESOLUTION-ID PRESENCE, NOT identity_type. identity_type
// is descriptive metadata, not the routing key — the ID determines
// which endpoint we can actually call:
//   videoId       → /file/video/ad/info/ (path A)
//   tiktokItemId  → /identity/video/info/ (path B — requires
//                   identityType + identityId too)
//   imageIds      → deferred (path C)
//
// A BC_AUTH_TT Spark Ad with video_id=null + tiktok_item_id=set
// routes correctly to path B via this priority (identityType label
// is BC_AUTH_TT but the routable ID is the Spark item_id).
//
// Pure function — 2c's URL-resolve route consumes the discriminated
// union via a switch on `kind`.
// ═══════════════════════════════════════════════════════════════════

export type TikTokCreativePath =
  | { kind: "A_DIRECT_VIDEO"; videoId: string }
  | {
      kind: "B_SPARK_AD";
      identityType: string;
      identityId: string;
      itemId: string;
    }
  | { kind: "D_DCO_OEMBED"; itemId: string }
  | { kind: "C_PURE_IMAGE_DEFERRED"; imageIds: string[] }
  | { kind: "UNKNOWN" };

/**
 * Classify an ad's creative-routing path from its cached type_data.
 *
 * Path B requires identityType + identityId + itemId together —
 * /identity/video/info/ won't return URLs without all three. When
 * tiktokItemId is set but identityType or identityId is missing
 * (the DCO/SPC pattern per ADR-020 §DCO-Identity), routes to
 * D_DCO_OEMBED — the item_id alone is recoverable via public oEmbed.
 * The path-D check MUST come after path-B's full-triple test so
 * Spark Ads with intact identity stay on path-B.
 */
export function routeCreativeByIdentityType(
  typeData: UnifiedAdTiktok["type_data"]
): TikTokCreativePath {
  if (typeData.videoId && typeData.videoId.length > 0) {
    return { kind: "A_DIRECT_VIDEO", videoId: typeData.videoId };
  }
  if (
    typeData.tiktokItemId &&
    typeData.tiktokItemId.length > 0 &&
    typeData.identityType &&
    typeData.identityType.length > 0 &&
    typeData.identityId &&
    typeData.identityId.length > 0
  ) {
    return {
      kind: "B_SPARK_AD",
      identityType: typeData.identityType,
      identityId: typeData.identityId,
      itemId: typeData.tiktokItemId,
    };
  }
  // Path D — DCO/SPC ads have item_id but identity_type/_id silently
  // stripped by TikTok per ADR-020 §DCO-Identity. Recoverable via
  // public oEmbed (no auth, returns thumbnail + author info).
  if (typeData.tiktokItemId && typeData.tiktokItemId.length > 0) {
    return { kind: "D_DCO_OEMBED", itemId: typeData.tiktokItemId };
  }
  if (typeData.imageIds && typeData.imageIds.length > 0) {
    return { kind: "C_PURE_IMAGE_DEFERRED", imageIds: typeData.imageIds };
  }
  return { kind: "UNKNOWN" };
}
