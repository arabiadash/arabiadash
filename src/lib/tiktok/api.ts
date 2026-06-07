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
 *
 * All metric names + field names + endpoint shapes empirically
 * verified via the Session 2 probe suite (2026-05-30 / 2026-05-31).
 * See docs/decisions/020-tiktok-adapter-v1.md §Report-Shape Empirical
 * Findings + §12c for the source-of-truth amendments.
 */

import {
  type DateRangeInput,
  isCustomRange,
  presetToCustomRange,
} from "@/lib/ads/types";

// ───────────────────────────────────────────────────────────────────
// Version pin per ADR-020 §Decision 7 — single source of truth.
// When TikTok deprecates v1.3 → v1.4, this is the ONLY constant
// to update (plus any field-path adjustments downstream in normalize).
// ───────────────────────────────────────────────────────────────────
export const TIKTOK_API_VERSION = "v1.3";
export const TIKTOK_BASE_URL = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;
export const TIKTOK_AUTH_BASE_URL = "https://business-api.tiktok.com";

// Defensive http→https rewrite for TikTok-issued URLs. TikTok's CDN
// (e.g. p16-common-sign.tiktokcdn.com) and oEmbed sometimes return
// http:// scheme; browsers on https:// pages auto-upgrade but log a
// Mixed Content warning and add a small latency hit. Rewriting at the
// source ensures clients never see http://. Idempotent — https URLs,
// undefined, protocol-relative (//), data: URLs all pass through. (#55)
export function forceHttps(url: string): string;
export function forceHttps(url: string | undefined): string | undefined;
export function forceHttps(url: string | undefined): string | undefined {
  if (!url) return url;
  if (url.startsWith("http://")) return "https://" + url.slice(7);
  return url;
}

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
  // Wire shape per official TikTok SDK (authoritative source — empirically
  // confirmed 2026-05-30 via _tiktok-shape-test.mjs probe):
  //   GET /open_api/v1.3/oauth2/advertiser/get/?app_id=X&secret=Y
  //   Header: Access-Token: <access_token>
  //
  // app_id + secret are query params; access_token goes in the
  // Access-Token header. The sibling /oauth2/access_token/ and
  // /oauth2/refresh_token/ endpoints are POST+body, but this one
  // breaks the namespace pattern.
  //
  // Source: github.com/tiktok/tiktok-business-api-sdk
  //   python_sdk/business_api_client/api/authentication_api.py
  //
  // Latent bug from Session 1 — the original query-param shape
  // (access_token=... in URL) returned envelope code 40104
  // "The access_token is empty." and never actually worked. Caught
  // by the first live probe run after Session 2 Commit 1.
  const url = new URL(`${TIKTOK_BASE_URL}/oauth2/advertiser/get/`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("secret", secret);

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
  /**
   * Unix epoch seconds — account inception per /advertiser/info/.
   * Optional because TikTok occasionally omits the field; consumers
   * must handle absence (the chunked-lifetime path falls back to a
   * 365-day single-chunk window when this is missing per ADR-020
   * §Lifetime).
   */
  create_time?: number;
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

// ═══════════════════════════════════════════════════════════════════
// Date-range helper — converts DateRangeInput (preset/custom/lifetime)
// to the YYYY-MM-DD strings TikTok expects. Mirrors the Meta precedent
// (src/lib/meta/api.ts:resolveRangeToDates). Local because it returns
// strings in TikTok's format, not Meta's.
// ═══════════════════════════════════════════════════════════════════

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Resolve a DateRangeInput to explicit YYYY-MM-DD strings.
 * "lifetime" → 365-day lookback (TikTok has no date_preset=maximum
 * equivalent — unlike Meta's `date_preset=maximum` real lifetime
 * preset; we synthesize one by clamping to TikTok's hard cap).
 *
 * The 365-day cap is empirically verified live against IMAA
 * (probe scripts/_tiktok-lifetime-paused-probe.mts, 2026-05-31):
 *   - 365d range → /report/integrated/get/ returns code:0, rows:1
 *   - 366d range → code:40002 "max time span must be less than 365 days"
 *   - 730d range (pre-fix) → code:40002 → tiktokGet throws → adapter
 *     filter drops all ads → empty grid (the user-visible "no data"
 *     symptom that motivated this clamp)
 * 365d sits exactly on the boundary. Despite TikTok's error message
 * wording ("less than 365"), 365 succeeds — likely off-by-one in
 * their check, or inclusive-endpoint counting. Going defensive to
 * 364 would over-engineer against a hypothetical tightening.
 *
 * Exported per Session 2 Commit 2b-3 plan so the adapter can thread
 * the same resolved (since, until) into normalize.ts opts without
 * duplicating the helper. Single source of truth for date resolution.
 */
export function resolveRangeToDates(
  range: DateRangeInput
): { since: string; until: string } {
  if (isCustomRange(range)) {
    return { since: range.since, until: range.until };
  }
  if (range === "lifetime") {
    const today = new Date();
    const oneYearAgo = new Date(
      today.getTime() - 365 * 24 * 60 * 60 * 1000
    );
    return { since: toYmd(oneYearAgo), until: toYmd(today) };
  }
  const customRange = presetToCustomRange(range);
  return { since: customRange.since, until: customRange.until };
}

// ═══════════════════════════════════════════════════════════════════
// Common shapes — page_info echoed by /report/integrated/get/,
// /ad/get/, /campaign/get/ alike (all integers despite TikTok's
// metric-strings convention).
// ═══════════════════════════════════════════════════════════════════

export interface TiktokPageInfo {
  page: number;
  page_size: number;
  total_page: number;
  total_number: number;
}

// ═══════════════════════════════════════════════════════════════════
// /report/integrated/get/ — performance reporting endpoint.
//
// Wire shape per Session 2 probes (verified 2026-05-31):
//   GET /open_api/v1.3/report/integrated/get/
//   Header: Access-Token
//   Query: advertiser_id, report_type=BASIC, data_level, dimensions
//          (JSON-array), metrics (JSON-array), start_date, end_date,
//          page, page_size
//
// data_level uses AUCTION_* prefix (NOT AUC_* as session2-plan v1
// originally documented — corrected via SDK source + empirical probe).
// ═══════════════════════════════════════════════════════════════════

export type TiktokDataLevel =
  | "AUCTION_ADVERTISER"
  | "AUCTION_CAMPAIGN"
  | "AUCTION_ADGROUP"
  | "AUCTION_AD";

/**
 * One row from /report/integrated/get/. Metrics are STRINGS (per
 * empirical K1 finding — TikTok returns all metrics as strings;
 * normalize.ts coerces via parseInt / parseFloat). Dimensions echo
 * back the dimension values requested (e.g. {advertiser_id: "..."}
 * or {ad_id: "..."}).
 */
export interface TiktokReportRow {
  metrics: Record<string, string>;
  dimensions: Record<string, string>;
}

export interface TiktokReportResponse {
  list: TiktokReportRow[];
  page_info: TiktokPageInfo;
}

/**
 * Account-level metric set (AUCTION_ADVERTISER + AUCTION_CAMPAIGN).
 * All 10 names empirically verified valid in v1.3 via Session 2 probes
 * (_tiktok-report-shape.mjs, _tiktok-report-q2b.mjs,
 * _tiktok-report-active.mjs, _tiktok-metric-validity.mjs,
 * _tiktok-revenue-metric.mts).
 *
 * `complete_payment` family is the v1 purchase-attribution choice
 * per ADR-020 §Decision 2 + Report-Shape Findings §4 + §2b correction.
 * vta_purchase / cta_purchase split deferred to a v2 TikTok-specific
 * surface.
 *
 * CTR is 0-100 percentage scale (K2 verified). normalize.ts passes
 * through with parseFloat — no scale conversion.
 *
 * REMOVED per ADR-020 §2b (2026-05-31 live-data correction):
 *   - `total_purchase_value` — app-attribution (active_pay family);
 *     returns 0 for website pixel stores. Replaced by
 *     total_complete_payment_rate.
 *   - `complete_payment_roas` — metric is valid (returns the website
 *     ROAS, contrary to the original app-attribution hypothesis), but
 *     not requested because we compute roas = revenue/spend client-
 *     side for null-safety per the UnifiedInsight contract. Kept as a
 *     diagnostic reference in normalize.ts comments.
 */
const INSIGHTS_METRICS_ACCOUNT: readonly string[] = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "reach",
  "frequency",
  "complete_payment",
  // ⚠️ NAMING TRAP per ADR-020 §2b: despite the `_rate` suffix this is
  // the aggregate VALUE in account currency, NOT a rate/percentage.
  // TikTok's internal ID is `time_attr_total_shopping_value` (per the
  // SDK YAML `smart_plus_material_report_overview.yml`), confirming
  // it's a SUM-of-values. The API key name appears to be a TikTok SDK
  // naming inconsistency. Live-verified 456,410 SAR on IMAA (advertiser
  // 7327982125339328514, May 2-31) — matches platform UI "Purchase
  // value (website)" within 0.00%. Do NOT "fix" the apparent rate-vs-
  // value mismatch.
  "total_complete_payment_rate",
] as const;

/**
 * Campaign-level metrics — same set as account level. TikTok's report
 * surface returns the same metrics regardless of data_level (verified
 * empirically across AUCTION_ADVERTISER + AUCTION_AD; AUCTION_CAMPAIGN
 * follows by API design).
 */
const INSIGHTS_METRICS_CAMPAIGN: readonly string[] = INSIGHTS_METRICS_ACCOUNT;

/**
 * Per-ad metrics (AUCTION_AD) — account set + video_play_actions.
 *
 * `video_play_actions` is TikTok's canonical view count (maps
 * internally to `total_play` per the SDK YAML). Powers the
 * TikTokCreativeCard footer's "N views" display per ADR-020 §12
 * (the original §Decision 12 + session2-plan reference to
 * `video_views` was wrong — that name is rejected with 40002 at
 * every data_level; see Report-Shape Findings §1).
 */
const INSIGHTS_METRICS_AD: readonly string[] = [
  ...INSIGHTS_METRICS_ACCOUNT,
  "video_play_actions",
] as const;

/**
 * Centralized report fetcher. Single call, no chunking — TikTok has
 * no Meta-style 30-day daily-breakdown truncation. page_size=1000
 * (TikTok's documented max) covers any realistic v1 row count;
 * pagination loop deferred to a future enhancement if any real
 * account exceeds it.
 */
export async function getReportInsights(
  accessToken: string,
  advertiserId: string,
  dataLevel: TiktokDataLevel,
  dimensions: string[],
  metrics: readonly string[],
  range: DateRangeInput
): Promise<TiktokReportRow[]> {
  const { since, until } = resolveRangeToDates(range);
  const response = await tiktokGet<TiktokReportResponse>(
    "/report/integrated/get/",
    accessToken,
    {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: dataLevel,
      dimensions: JSON.stringify(dimensions),
      metrics: JSON.stringify([...metrics]),
      start_date: since,
      end_date: until,
      page: 1,
      page_size: 1000,
    }
  );
  return response.list ?? [];
}

/**
 * Account-level insights (totals across the whole advertiser).
 * Used by TiktokAdapter.getAccountInsights for the KPI strip.
 */
export async function getAccountInsights(
  accessToken: string,
  advertiserId: string,
  range: DateRangeInput
): Promise<TiktokReportRow[]> {
  return getReportInsights(
    accessToken,
    advertiserId,
    "AUCTION_ADVERTISER",
    ["advertiser_id"],
    INSIGHTS_METRICS_ACCOUNT,
    range
  );
}

/**
 * Per-campaign insights. dimensions include campaign_id; rows are
 * joined to campaign metadata (from getCampaigns) in normalize.ts.
 */
export async function getCampaignInsights(
  accessToken: string,
  advertiserId: string,
  range: DateRangeInput
): Promise<TiktokReportRow[]> {
  return getReportInsights(
    accessToken,
    advertiserId,
    "AUCTION_CAMPAIGN",
    ["campaign_id"],
    INSIGHTS_METRICS_CAMPAIGN,
    range
  );
}

/**
 * Per-ad insights. Includes video_play_actions for TikTokCreativeCard
 * footer. Adapter joins these by ad_id with getAds rows + (lazily)
 * URL-resolves via getFileVideoAdInfo / getIdentityVideoInfo per §12c.
 */
export async function getAdInsights(
  accessToken: string,
  advertiserId: string,
  range: DateRangeInput
): Promise<TiktokReportRow[]> {
  return getReportInsights(
    accessToken,
    advertiserId,
    "AUCTION_AD",
    ["ad_id"],
    INSIGHTS_METRICS_AD,
    range
  );
}

// ═══════════════════════════════════════════════════════════════════
// Lifetime chunked-fetch — pure helpers per ADR-020 §Lifetime
// (2026-05-31). Composed by the *Lifetime wrappers in Commit B.
//
// TikTok caps /report/integrated/get/ at 365 days per request
// (probe-confirmed 365/366 boundary in
// scripts/_tiktok-lifetime-paused-probe.mts, 2026-05-31). For true
// lifetime semantics we chunk [account_create_time, today] into
// ≤365-day windows, fetch in parallel, merge client-side.
// ═══════════════════════════════════════════════════════════════════

/**
 * Sanity ceiling for the lifetime lower bound. ~3 years is the
 * empirical history retention observed in
 * scripts/_tiktok-history-chunked-probe.mts (chunks beyond ~2.4
 * years returned zero rows for IMAA, consistent with TikTok's
 * documented retention). Prevents wasted API calls for accounts with
 * a stale or pre-retention `create_time`.
 */
const MAX_LIFETIME_RETENTION_DAYS = 1095;

/**
 * Metric names that are RATIOS, not additives. NEVER summed across
 * chunks — summing percentages or per-unit values produces garbage.
 *
 * `ctr` / `cpc` / `cpm` / `frequency` are RECOMPUTED from summed
 * components inside `mergeChunkedReports` (per ADR-020 §Lifetime
 * merge-rules table, "Ratios — recomputed in the MERGE layer" row).
 *
 * `complete_payment_roas` is listed for a different reason — NOT
 * because the metric is wrong. Per §2b's live-data evidence, the
 * metric IS valid and IS correct: it equals the platform UI's
 * "Payment completion ROAS (website)" exactly (per-campaign
 * 4.79 / 3.89 / 5.59 in the §2b table match TikTok's UI verbatim).
 * We simply don't request it today because the normalizer recomputes
 * `roas` client-side from `spend` + `revenue` per §2b's null-safe
 * contract — one source-of-truth, fewer moving parts. If a future
 * change re-adds it to the metric set, this set prevents the
 * mechanical mistake of summing it across chunks (a ratio summed
 * across chunks is mathematically wrong); the right path on re-add
 * is to either drop it from the merged row and rely on the
 * normalizer's recompute, or recompute it explicitly from summed
 * `total_complete_payment_rate` / `spend` like the other ratios above.
 */
const RATIO_METRICS: ReadonlySet<string> = new Set([
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "complete_payment_roas",
]);

/**
 * Split `[lower_bound, today]` into ≤365-day chunks for lifetime
 * fetch per ADR-020 §Lifetime.
 *
 *   lower_bound = max(create_time, today − MAX_LIFETIME_RETENTION_DAYS)
 *   chunk_size  = 365 days
 *   chunks are returned in ascending date order
 *
 * Inclusive `since/until` per chunk with `+1d` step to the next
 * chunk's start (no double-counting the boundary day). Mirrors Meta's
 * `chunkDateRange` pattern at src/lib/meta/api.ts:243-270, sized for
 * TikTok's 365-day cap instead of Meta's 30-day daily-breakdown cap.
 *
 * Edge cases:
 *   - createTime undefined / 0 / future → fall back to a single
 *     365-day chunk (matches the pre-§Lifetime clamp behavior;
 *     callers should treat this as a degraded "best effort" lifetime).
 *   - createTime < today by less than 365 days → returns a single
 *     chunk [createTime → today].
 *   - createTime older than retention cap → lower_bound clamped at
 *     today − MAX_LIFETIME_RETENTION_DAYS; ~3 chunks for IMAA's
 *     2.4-year history, up to 3 chunks for any account.
 *
 * @param createTime Unix epoch SECONDS from /advertiser/info/ (matches
 *   TikTok's wire format — NOT milliseconds; the *1000 happens here).
 */
export function chunkLifetimeRange(
  createTime: number | undefined
): Array<{ since: string; until: string }> {
  const todayMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Lower bound resolution. The defensive defaults match the
  // pre-§Lifetime single-request 365d clamp when createTime is unusable.
  let lowerMs: number;
  const validCreateTime =
    typeof createTime === "number" &&
    Number.isFinite(createTime) &&
    createTime > 0 &&
    createTime * 1000 < todayMs;

  if (validCreateTime) {
    const fromCreateMs = createTime! * 1000;
    const fromCapMs = todayMs - MAX_LIFETIME_RETENTION_DAYS * DAY_MS;
    lowerMs = Math.max(fromCreateMs, fromCapMs);
  } else {
    lowerMs = todayMs - 365 * DAY_MS;
  }

  const chunks: Array<{ since: string; until: string }> = [];
  let cursorMs = lowerMs;

  while (cursorMs <= todayMs) {
    // Each chunk covers up to 365 days inclusive of `cursor`. The
    // `365 - 1` accounts for inclusive endpoint counting (since-until
    // span of 364 = 365 days inclusive). Probe-verified: this lands
    // EXACTLY on the 365-day cap TikTok accepts (the 366d probe
    // returned code:40002).
    const chunkEndMs = Math.min(cursorMs + (365 - 1) * DAY_MS, todayMs);
    chunks.push({
      since: toYmd(new Date(cursorMs)),
      until: toYmd(new Date(chunkEndMs)),
    });
    // Next chunk starts the day after this chunk's until.
    cursorMs = chunkEndMs + DAY_MS;
  }

  return chunks;
}

/**
 * Merge multiple chunked /report/integrated/get/ results into a
 * single set of synthesized rows per dimension key, per ADR-020
 * §Lifetime merge rules.
 *
 * THREE-PASS SHAPE:
 *
 *   PASS 1 — sum additive metrics by JSON-serialized dimension key
 *     across all chunks. Ratio metrics (RATIO_METRICS) are SKIPPED
 *     — they'd produce garbage if summed. Missing metric values
 *     contribute 0 (no entry pollution).
 *
 *   PASS 2 — recompute the ratio metrics from the summed components:
 *     ctr       = clicks / impressions * 100   (K2: 0-100 percentage)
 *     cpc       = spend / clicks
 *     cpm       = spend / impressions * 1000
 *     frequency = impressions / reach
 *     Each guards against /0 by checking the denominator.
 *
 *   PASS 3 — convert numeric metrics back to strings (TikTok's wire
 *     format) so the result is drop-in for the existing
 *     normalizeReportRowToInsight downstream.
 *
 * The normalizer recomputes `roas` + `costPerPurchase` from the
 * merged components (per §2b's null-safe contract). The merge does
 * NOT touch those — they're handled correctly downstream.
 *
 * Grouping by JSON-serialized `dimensions` keeps multi-dim queries
 * correct (e.g. {campaign_id, stat_time_day} groups by both keys).
 * Our v1 single-dim queries (advertiser_id | campaign_id | ad_id) get
 * effective grouping by that single key.
 *
 * Entity-present-in-some-chunks behavior: an entity (e.g. a 2024
 * paused campaign in chunk 1 but not chunk 0) gets a single-entry
 * group whose summed metrics equal that one chunk's values. This is
 * exactly the path surfacing §Lifetime's paused-with-historical-spend
 * coverage gap.
 */
export function mergeChunkedReports(
  chunkResults: ReadonlyArray<ReadonlyArray<TiktokReportRow>>
): TiktokReportRow[] {
  interface MergedEntry {
    dimensions: Record<string, string>;
    metrics: Record<string, number>;
  }
  const byDimKey = new Map<string, MergedEntry>();

  // PASS 1 — sum additives by dimension key. Ratios SKIPPED here.
  for (const chunk of chunkResults) {
    for (const row of chunk) {
      const key = JSON.stringify(row.dimensions);
      let entry = byDimKey.get(key);
      if (!entry) {
        entry = { dimensions: { ...row.dimensions }, metrics: {} };
        byDimKey.set(key, entry);
      }
      for (const [metricName, valueStr] of Object.entries(row.metrics ?? {})) {
        if (RATIO_METRICS.has(metricName)) continue;
        const n = parseFloat(valueStr);
        if (!Number.isFinite(n)) continue;
        entry.metrics[metricName] = (entry.metrics[metricName] ?? 0) + n;
      }
    }
  }

  // PASS 2 — recompute ratios from summed components. The normalizer
  // reads these as passthrough so they must be correct here. roas +
  // costPerPurchase are NOT computed here — the normalizer handles
  // them from the summed revenue/spend/purchases.
  for (const entry of byDimKey.values()) {
    const spend = entry.metrics.spend ?? 0;
    const impressions = entry.metrics.impressions ?? 0;
    const clicks = entry.metrics.clicks ?? 0;
    const reach = entry.metrics.reach ?? 0;
    entry.metrics.ctr =
      impressions > 0 ? (clicks / impressions) * 100 : 0;
    entry.metrics.cpc = clicks > 0 ? spend / clicks : 0;
    entry.metrics.cpm =
      impressions > 0 ? (spend / impressions) * 1000 : 0;
    entry.metrics.frequency = reach > 0 ? impressions / reach : 0;
  }

  // PASS 3 — stringify metrics back to TikTok's wire format. The
  // normalizer's extractNumber/extractInt re-parse them; round-trip
  // is lossless for the integer + float values we sum here.
  return Array.from(byDimKey.values()).map((entry) => ({
    dimensions: entry.dimensions,
    metrics: Object.fromEntries(
      Object.entries(entry.metrics).map(([k, v]) => [k, String(v)])
    ),
  }));
}

/**
 * Shared lifetime-fetch orchestrator per ADR-020 §Lifetime.
 *
 * Fetches `create_time` from /advertiser/info/, computes ≤365-day
 * chunks via chunkLifetimeRange, dispatches N parallel per-chunk
 * fetches through the provided `baseFetcher`, then merges via
 * mergeChunkedReports. The three level-specific lifetime paths
 * (account / campaign / ad) compose this with the appropriate
 * baseFetcher (`getAccountInsights` / `getCampaignInsights` /
 * `getAdInsights`).
 *
 * Per-chunk fetches pass a CustomDateRange to the baseFetcher —
 * resolveRangeToDates routes that through `isCustomRange` and uses
 * the dates as-is, bypassing its own lifetime branch's 365d
 * fallback clamp. The clamp remains defensive against any future
 * caller bypassing this wrapper.
 *
 * Reauth-across-chunks contract: Promise.all is fail-fast. A single
 * chunk's `code:40105/40110/40115` from tiktokGet throws → Promise.all
 * rejects → the adapter's `withReauthMapping` (caller-side) classifies
 * via classifyTiktokError's regex-on-message → throws
 * ReauthRequiredError. NEVER returns a partial merge — that would
 * silently render misleading lifetime data.
 *
 * `getAdvertiserInfo` returns the parsed API response without field
 * filtering (line 207's `.list ?? []`), so create_time is present
 * at runtime when TikTok returns it. The `?.create_time` defensive
 * read falls back to `undefined` when missing, and
 * chunkLifetimeRange handles undefined with a single 365d chunk —
 * degrades to today's behavior, never errors.
 */
export async function fetchInsightsLifetime(
  accessToken: string,
  advertiserId: string,
  baseFetcher: (
    accessToken: string,
    advertiserId: string,
    range: DateRangeInput
  ) => Promise<TiktokReportRow[]>
): Promise<TiktokReportRow[]> {
  const info = await getAdvertiserInfo(accessToken, [advertiserId]);
  const createTime = info[0]?.create_time;
  const chunks = chunkLifetimeRange(createTime);

  // Promise.all (fail-fast) — one chunk's reauth/error kills the
  // whole lifetime fetch. Partial-merge would silently render
  // incomplete data; the user must see the reauth banner instead.
  const chunkResults = await Promise.all(
    chunks.map((c) =>
      baseFetcher(accessToken, advertiserId, {
        since: c.since,
        until: c.until,
      })
    )
  );

  return mergeChunkedReports(chunkResults);
}

// ═══════════════════════════════════════════════════════════════════
// /ad/get/ — ad metadata + creative-routing discriminators.
//
// Per ADR-020 §12c §4: ALL fields are optional (silently-dropped mode
// 3 is real on Spark Ads). normalize.ts uses `?.` + nullish-coalesce
// on every read.
//
// AD_FIELDS excludes the 5 silently-dropped fields (ad_format,
// call_to_action, call_to_action_id, creative_type, image_mode).
// They're in TikTok's allowed-fields list but absent from the
// response on AUTH_CODE (Spark Ad) rows. Excluded to avoid the
// "valid field name, missing value" anti-pattern; can be re-added
// later when normalize.ts has a real consumer for them.
// ═══════════════════════════════════════════════════════════════════

/**
 * Per-ad row from /ad/get/. ALL fields optional per §12c §4
 * defensive-field rule. `video_id: string | null` because TikTok
 * explicitly returns null (not absent) on non-video ads — distinct
 * from "field missing entirely".
 */
export interface TiktokAdRow {
  ad_id?: string;
  ad_name?: string;
  ad_text?: string;
  display_name?: string;
  secondary_status?: string;
  operation_status?: string;
  campaign_id?: string;
  adgroup_id?: string;
  // Creative path discriminators per ADR-020 §12c §1
  video_id?: string | null;       // path A: direct upload (BC_AUTH_TT)
  image_ids?: string[];           // path C: pure image (DEFERRED)
  tiktok_item_id?: string;        // path B: Spark Ad (AUTH_CODE)
  identity_type?: string;         // AUTH_CODE | BC_AUTH_TT | TT_USER | CUSTOMIZED_USER
  identity_id?: string;           // path B URL resolution dependency
  landing_page_url?: string;
  create_time?: string;
  modify_time?: string;
}

export interface TiktokAdsResponse {
  list: TiktokAdRow[];
  page_info: TiktokPageInfo;
}

/**
 * The 16 verified-safe /ad/get/ fields. Excludes the 5 silently-
 * dropped fields per §12c §4. If future normalize.ts work needs
 * additional fields, validate against TikTok's allowed-list (returned
 * verbatim in 40002 error messages) before adding.
 */
const AD_FIELDS: readonly string[] = [
  "ad_id",
  "ad_name",
  "ad_text",
  "display_name",
  "secondary_status",
  "operation_status",
  "campaign_id",
  "adgroup_id",
  "video_id",
  "image_ids",
  "tiktok_item_id",
  "identity_type",
  "identity_id",
  "landing_page_url",
  "create_time",
  "modify_time",
] as const;

const ADS_PAGE_SIZE = 100;
const MAX_AD_PAGES = 20;

/**
 * List ads for an advertiser. Pagination loop via page+page_size
 * (TikTok uses 1-indexed page numbers, NOT Meta's paging.next cursor).
 * MAX_AD_PAGES safety cap (20 pages × 100 = 2000 ads max) mirrors
 * Meta's getAds convention.
 *
 * NO embedded insights — TikTok's /ad/get/ returns metadata only.
 * Adapter joins with getAdInsights by ad_id (NOT date-filtered at
 * this layer; range param reserved for future use if TikTok adds
 * activity-window filtering).
 */
export async function getAds(
  accessToken: string,
  advertiserId: string,
  range: DateRangeInput
): Promise<TiktokAdRow[]> {
  // range currently unused at this layer — adapter date-filters via
  // getAdInsights and joins by ad_id. Parameter kept for API
  // consistency + future-proofing if a filter is needed here.
  void range;

  const allAds: TiktokAdRow[] = [];
  let page = 1;
  while (page <= MAX_AD_PAGES) {
    const response = await tiktokGet<TiktokAdsResponse>(
      "/ad/get/",
      accessToken,
      {
        advertiser_id: advertiserId,
        fields: JSON.stringify([...AD_FIELDS]),
        page,
        page_size: ADS_PAGE_SIZE,
      }
    );
    const list = response.list ?? [];
    allAds.push(...list);
    if (list.length === 0) break;
    const totalPages = response.page_info?.total_page ?? 0;
    if (page >= totalPages) break;
    page++;
  }
  return allAds;
}

// ═══════════════════════════════════════════════════════════════════
// /campaign/get/ — campaign metadata.
//
// CAMPAIGN_FIELDS minimal set: identifiers + objective + status.
// UNCERTAIN — /campaign/get/'s allowed-fields list is not yet
// empirically verified (no Session 2 probe ran against this
// endpoint). Mirrors /ad/get/'s status-field naming convention
// (operation_status + secondary_status). If 40002 fires during 2b
// integration testing, the error message will name the bad field
// and we patch.
// ═══════════════════════════════════════════════════════════════════

export interface TiktokCampaignRow {
  campaign_id?: string;
  campaign_name?: string;
  objective_type?: string;
  operation_status?: string;
  secondary_status?: string;
}

export interface TiktokCampaignsResponse {
  list: TiktokCampaignRow[];
  page_info: TiktokPageInfo;
}

const CAMPAIGN_FIELDS: readonly string[] = [
  "campaign_id",
  "campaign_name",
  "objective_type",
  "operation_status",
  "secondary_status",
] as const;

const CAMPAIGNS_PAGE_SIZE = 100;
const MAX_CAMPAIGN_PAGES = 20;

export async function getCampaigns(
  accessToken: string,
  advertiserId: string
): Promise<TiktokCampaignRow[]> {
  const allCampaigns: TiktokCampaignRow[] = [];
  let page = 1;
  while (page <= MAX_CAMPAIGN_PAGES) {
    const response = await tiktokGet<TiktokCampaignsResponse>(
      "/campaign/get/",
      accessToken,
      {
        advertiser_id: advertiserId,
        fields: JSON.stringify([...CAMPAIGN_FIELDS]),
        page,
        page_size: CAMPAIGNS_PAGE_SIZE,
      }
    );
    const list = response.list ?? [];
    allCampaigns.push(...list);
    if (list.length === 0) break;
    const totalPages = response.page_info?.total_page ?? 0;
    if (page >= totalPages) break;
    page++;
  }
  return allCampaigns;
}

// ═══════════════════════════════════════════════════════════════════
// /file/video/ad/info/ — path A URL resolver per ADR-020 §12c §1.
//
// Fetches signed CDN URLs for direct-upload (BC_AUTH_TT) video ads.
// URLs expire in hours (preview_url_expire_time field + x-expires
// query params on video_cover_url). CACHE ONLY IDs in creatives_cache;
// re-resolve URLs at render time via this endpoint (per §12c §2).
// ═══════════════════════════════════════════════════════════════════

/**
 * Per-video metadata row from /file/video/ad/info/. Empirically
 * verified shape (probe 2026-05-31) — all listed fields present in
 * the response when envelope code === 0.
 */
export interface TiktokFileVideoInfoRow {
  video_id: string;
  video_cover_url: string;
  preview_url: string;
  preview_url_expire_time: string;
  duration: number;
  width: number;
  height: number;
  format: string;
  size: number;
  bit_rate: number;
  material_id: string;
  signature: string;
  file_name: string;
  create_time: string;
  modify_time: string;
  allow_download: boolean;
  displayable: boolean;
  allowed_placements: string[];
  fix_task_id: string | null;
  flaw_types: string | null;
}

export interface TiktokFileVideoInfoResponse {
  list: TiktokFileVideoInfoRow[];
}

/**
 * Resolve video URLs for one or more video_ids. Empty input returns
 * empty array (no API call). video_ids passed as JSON-encoded array
 * (the SDK Python "multi" collection_format is wrong; empirically
 * verified that JSON encoding is what TikTok accepts).
 */
export async function getFileVideoAdInfo(
  accessToken: string,
  advertiserId: string,
  videoIds: string[]
): Promise<TiktokFileVideoInfoRow[]> {
  if (videoIds.length === 0) return [];
  const response = await tiktokGet<TiktokFileVideoInfoResponse>(
    "/file/video/ad/info/",
    accessToken,
    {
      advertiser_id: advertiserId,
      video_ids: JSON.stringify(videoIds),
    }
  );
  return response.list ?? [];
}

// ═══════════════════════════════════════════════════════════════════
// /identity/video/info/ — path B URL resolver per ADR-020 §12c §1.
//
// Fetches signed CDN URLs for Spark Ad (AUTH_CODE / TT_USER /
// BC_AUTH_TT-with-organic-source) creatives. Returns a single
// `video_detail` object (NOT a `list` array — diverges from
// /file/video/ad/info/). Same hours-scale URL expiry.
// ═══════════════════════════════════════════════════════════════════

export interface TiktokIdentityVideoInfo {
  url: string;          // playable MP4 (signed, expiring)
  poster_url: string;   // cover image (signed, expiring)
  duration: number;
  bit_rate: number;
  format: string;
  width: number;
  height: number;
  size: number;
  signature: string;
}

export interface TiktokIdentityAuthInfo {
  ad_auth_status: string;
  auth_start_time: string;
  auth_end_time: string;
  invite_start_time: string;
}

export interface TiktokIdentityAnchor {
  Id: string;
  status: string;
  title: string;
  url: string;
}

/**
 * Empirically verified shape (probe 2026-05-31) against a real IMAA
 * Spark Ad. The auth_info / anchor_list / carousel_info fields are
 * present-but-empty for VIDEO item_type; the carousel_info.image_info
 * array populates when item_type === "CAROUSEL" (not yet probed
 * against a real CAROUSEL Spark Ad).
 */
export interface TiktokIdentityVideoDetail {
  item_id: string;
  item_type: string;           // "VIDEO" | "CAROUSEL" | ...
  status: string;
  text: string;                // full post caption (Arabic content on Saudi accounts)
  video_info: TiktokIdentityVideoInfo;
  auth_info?: TiktokIdentityAuthInfo;
  carousel_info?: {
    image_info: unknown[];     // populates when item_type === "CAROUSEL" — shape unverified
    music_info: Record<string, unknown>;
  };
  anchor_list?: TiktokIdentityAnchor[];
}

export interface TiktokIdentityVideoInfoResponse {
  video_detail: TiktokIdentityVideoDetail;
  video_details: unknown[];    // empty array in probe — purpose unknown
}

/**
 * Resolve URLs + metadata for a Spark Ad's source organic post.
 * Returns null if the response lacks video_detail (defensive — the
 * endpoint may return code 0 with empty data on certain identity
 * states; not yet observed empirically).
 */
export async function getIdentityVideoInfo(
  accessToken: string,
  advertiserId: string,
  identityType: string,
  identityId: string,
  itemId: string
): Promise<TiktokIdentityVideoDetail | null> {
  const response = await tiktokGet<TiktokIdentityVideoInfoResponse>(
    "/identity/video/info/",
    accessToken,
    {
      advertiser_id: advertiserId,
      identity_type: identityType,
      identity_id: identityId,
      item_id: itemId,
    }
  );
  return response.video_detail ?? null;
}

// ═══════════════════════════════════════════════════════════════════
// /oembed — path D resolver per ADR-020 §DCO-Identity.
//
// Public TikTok oEmbed endpoint at www.tiktok.com (NOT business-api).
// No auth. Used when path A (direct video) and path B (Spark Ad)
// identity resolution both fail but tiktok_item_id is populated —
// the DCO / Smart-Performance-Campaign pattern where TikTok strips
// identity_type/identity_id from /ad/get/ responses.
//
// Recovers BOTH the static poster (thumbnail_url) AND creator info
// (author_name / author_unique_id / author_url) in one HTTP call.
// Production-verified 2026-05-31 via Vercel iad1: HTTP 200, 179ms,
// hasThumbnail=true, author populated.
//
// URL shape: https://www.tiktok.com/oembed?url=https://www.tiktok.com/@_/video/<item_id>
// The placeholder username "@_" is accepted; TikTok resolves the
// item_id alone. This matches the empirically-verified probe shape
// in scripts/_tiktok-oembed-probe.mts — DO NOT rewrite with the URL
// constructor's automatic percent-encoding, which has not been
// tested against this endpoint.
//
// User-Agent string is the exact one used in both the local probe
// (scripts/_tiktok-oembed-probe.mts) and the Vercel-side probe
// (deleted commit 958441e) — preserved verbatim so production
// matches the verified-working request shape.
// ═══════════════════════════════════════════════════════════════════

/**
 * Raw TikTok oEmbed JSON response shape — empirically verified
 * 2026-05-31 against 3 different item_ids on the IMAA account.
 * All six fields below are populated for public TikTok videos;
 * thumbnail_url is signed (~24h TTL via `x-expires`).
 */
interface TiktokOembedResponse {
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
  author_name: string;
  author_unique_id: string;
  author_url: string;
  // (other fields present but unused: version, type, title, html, ...)
}

/**
 * Parsed + camelCase'd subset of TiktokOembedResponse for C3 consumption.
 * The mapping to TikTokCreativeUrls is done in the resolve route (C3) —
 * this helper stays single-responsibility (one HTTP call, one parse).
 */
export interface TiktokOembedResolved {
  thumbnailUrl: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  authorName: string;
  authorHandle: string;
  authorUrl: string;
  expiresAt: Date; // parsed from thumbnail_url's x-expires query param
}

const OEMBED_USER_AGENT = "Mozilla/5.0 (compatible; ArabiaDashOEmbedProbe/1.0)";
const OEMBED_TIMEOUT_MS = 10_000;

/**
 * Concurrency cap for path-D oEmbed batches in the resolve route.
 * Mirrors PATH_B_CONCURRENCY at route.ts:106 — same rationale
 * (TikTok's documented 600 req/min ÷ ~250ms per-call latency ≈
 *  generous headroom at 4 concurrent). See ADR-020 §ResolveConcurrency
 * for the original cap derivation; this constant exists so C3's
 * chunk-loop can import it without duplicating the math.
 */
export const OEMBED_CONCURRENCY = 4;

/**
 * Resolve a TikTok item_id to a public oEmbed payload (thumbnail +
 * creator info). See module comment above for the URL shape + UA
 * rationale.
 *
 * Two-tier error handling per ADR-020 §DCO-Identity Risks #2 + #4:
 *
 *   - PER-ITEM NULL (graceful) for 4xx/5xx/missing-thumbnail/timeout.
 *     A single dead item_id (private, deleted, geo-restricted, transient
 *     5xx) must not abort the whole batch — caller falls back to STATE 3
 *     placeholder + modal iframe.
 *
 *   - BUBBLE (throw) ONLY on HTTP 429. Rate-limit is an explicit signal
 *     that we're fanning out too aggressively; aborting the batch lets
 *     the resolve route's outer chunk-loop bubble to the caller, exactly
 *     like path-B's existing rate-limit pattern. Message includes
 *     "rate limit" so the existing isTiktokRateLimitError detector
 *     (errors.ts:118 — `msg.toLowerCase().includes("rate limit")`)
 *     matches it without modification.
 */
export async function resolveOembed(
  itemId: string
): Promise<TiktokOembedResolved | null> {
  const url = `https://www.tiktok.com/oembed?url=https://www.tiktok.com/@_/video/${itemId}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": OEMBED_USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
    });
  } catch {
    // Network failure / AbortError → per-item null. Don't bubble.
    return null;
  }

  if (response.status === 429) {
    throw new Error(
      `TikTok oEmbed rate limit (HTTP 429) for item_id ${itemId}`
    );
  }
  if (!response.ok) {
    // 4xx (item private/deleted/geo-restricted) or 5xx (TikTok-side
    // transient) → per-item null. Caller falls back to STATE 3.
    //
    // v1 accepted limitation: a TikTok-wide 5xx outage means the whole
    // batch returns nulls instead of bubbling early; bounded by cap=4
    // so worst case is ~4 futile in-flight calls before the rest of
    // the batch starts. A future "N consecutive 5xx → bubble" guard is
    // out of scope here.
    return null;
  }

  let json: TiktokOembedResponse;
  try {
    json = (await response.json()) as TiktokOembedResponse;
  } catch {
    return null;
  }

  if (!json.thumbnail_url || typeof json.thumbnail_url !== "string") {
    return null;
  }

  // Parse expiresAt from the signed thumbnail URL's x-expires query
  // param (epoch seconds). Mirrors normalize.ts:parseExpiresFromXExpiresQueryParam
  // — kept inline to avoid a circular import (api.ts ← normalize.ts).
  // Defensive default: now + 1h on parse failure (URL still works
  // within that envelope for most observed cases).
  let expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  try {
    const xExp = new URL(json.thumbnail_url).searchParams.get("x-expires");
    if (xExp) {
      const epoch = parseInt(xExp, 10);
      if (Number.isFinite(epoch) && epoch > 0) {
        expiresAt = new Date(epoch * 1000);
      }
    }
  } catch {
    // URL parse threw — fall through with the defensive default
  }

  return {
    thumbnailUrl: forceHttps(json.thumbnail_url),
    thumbnailWidth: json.thumbnail_width,
    thumbnailHeight: json.thumbnail_height,
    authorName: json.author_name,
    authorHandle: json.author_unique_id,
    authorUrl: forceHttps(json.author_url),
    expiresAt,
  };
}
