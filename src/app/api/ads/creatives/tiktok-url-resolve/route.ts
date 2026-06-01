import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getRefreshTokenForUser } from "@/lib/google-ads/credentials";
import {
  getFileVideoAdInfo,
  getIdentityVideoInfo,
  resolveOembed,
  OEMBED_CONCURRENCY,
} from "@/lib/tiktok/api";
import {
  normalizeFileVideoAdInfoToCreative,
  normalizeIdentityVideoInfoToCreative,
  type TikTokCreativeUrls,
} from "@/lib/tiktok/normalize";
import { isReauthError } from "@/lib/google-ads/errors";
import {
  classifyTiktokError,
  isTiktokRateLimitError,
} from "@/lib/tiktok/errors";
import {
  type AdResolveRequest,
  type CreativeKind,
} from "@/lib/tiktok/url-resolve";

/**
 * TikTok URL-resolve route per ADR-020 §12c §2.
 *
 * Resolves SHORT-LIVED signed CDN URLs for TikTok creatives on demand.
 * Per §12c §2 the URLs (poster + playable MP4) expire in hours, so we
 * do NOT cache them — the client calls this endpoint at TikTokCreative
 * Card render time + uses the URLs immediately.
 *
 * Path routing per §12c §1 happens CLIENT-SIDE — the React card knows
 * its own UnifiedAdTiktok.type_data discriminators (from the parent
 * /api/ads/creatives response) and passes them in the request. This
 * keeps the route stateless + decoupled from the creatives_cache
 * schema (in particular, decoupled from the planned 2e v13→v14 bump).
 *
 * SECURITY — MULTI-TENANT OWNERSHIP GUARD:
 * Before any credential fetch or TikTok API call, the route MUST
 * verify that the authenticated user owns the requested account_id
 * via the connections table. The platform_credentials access_token
 * is per-USER (not per-account), so without the ownership check, user
 * A could read user B's creatives by passing user B's account_id.
 * The guard is the FIRST thing after auth, before getRefreshTokenForUser.
 *
 * Two HTTP methods:
 *   GET  /api/ads/creatives/tiktok-url-resolve?account_id=X&ad_id=Y&kind=...&...
 *        Single-ad resolve for the detail modal.
 *   POST /api/ads/creatives/tiktok-url-resolve
 *        Batch resolve for the eager grid (path A batches into one
 *        /file/video/ad/info/ call; path B Promise.all across N
 *        /identity/video/info/ calls).
 *
 * Both methods share the same internal resolve function.
 */

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// Types — AdResolveRequest + CreativeKind imported from
// @/lib/tiktok/url-resolve (shared with the React hooks per
// 2d-1 single-source-of-truth refactor). Local types below are
// route-only.
// ═══════════════════════════════════════════════════════════════════

interface ResolvedAd {
  kind: CreativeKind;
  urls: TikTokCreativeUrls | null;
}

interface PostBody {
  account_id?: unknown;
  ads?: unknown;
}

// ═══════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════

const VALID_KINDS: ReadonlySet<CreativeKind> = new Set<CreativeKind>([
  "A_DIRECT_VIDEO",
  "B_SPARK_AD",
  "D_DCO_OEMBED",
  "C_PURE_IMAGE_DEFERRED",
  "UNKNOWN",
]);

/**
 * Path-B concurrency cap per ADR-020 §ResolveConcurrency (2026-06-01).
 *
 * TikTok's /identity/video/info/ doesn't expose a batch form (one
 * item_id per call), so N path-B ads cost N API calls. The original
 * §12c §3 design used unbounded `Promise.all` which empirically tripped
 * TikTok's 40100 rate-limit at the lifetime scale (~110 simultaneous
 * Spark Ad lookups on IMAA — confirmed via browser DevTools 2026-06-01).
 *
 * Cap value math:
 *   - TikTok documented global cap: 600 req/min = 10 req/s averaged
 *   - Per-call latency observed ~200-500ms (smoke probe + adapter test)
 *   - 4 concurrent × 1/0.5s latency ≈ 8 req/s sustained = 480/min
 *   - 80% utilization of documented cap, 10× lower than the burst that
 *     triggered 40100 today
 *   - Combined with the React-layer pagination (visibleCount slice),
 *     default first page resolves in ~1.5s without hitting the limit
 */
const PATH_B_CONCURRENCY = 4;

/**
 * Validate an AdResolveRequest's kind ↔ field consistency.
 * Returns an error reason string if invalid, null if OK.
 * Per-ad-id validation: a bad request entry in batch mode gets
 * marked with this error in the response's `errors` map; doesn't
 * fail the whole batch.
 */
function validateAdRequest(ad: AdResolveRequest): string | null {
  if (!ad.ad_id || typeof ad.ad_id !== "string") {
    return "missing_ad_id";
  }
  if (!VALID_KINDS.has(ad.kind)) {
    return "invalid_kind";
  }
  if (ad.kind === "A_DIRECT_VIDEO") {
    if (!ad.video_id || typeof ad.video_id !== "string") {
      return "kind_A_requires_video_id";
    }
  }
  if (ad.kind === "B_SPARK_AD") {
    if (!ad.item_id || typeof ad.item_id !== "string") {
      return "kind_B_requires_item_id";
    }
    if (!ad.identity_type || typeof ad.identity_type !== "string") {
      return "kind_B_requires_identity_type";
    }
    if (!ad.identity_id || typeof ad.identity_id !== "string") {
      return "kind_B_requires_identity_id";
    }
  }
  if (ad.kind === "D_DCO_OEMBED") {
    if (!ad.item_id || typeof ad.item_id !== "string") {
      return "kind_D_requires_item_id";
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Internal resolver — shared by GET + POST handlers (DRY).
// Returns the per-ad result map + errors map for the input ads.
// Re-throws ReauthRequiredError + rate-limit errors so the outer
// handler can convert to 401/429 — those are batch-wide states.
// ═══════════════════════════════════════════════════════════════════

interface ResolverOutput {
  resolved: Record<string, ResolvedAd>;
  errors: Record<string, string>;
}

async function resolveAds(
  accessToken: string,
  advertiserId: string,
  ads: AdResolveRequest[]
): Promise<ResolverOutput> {
  const resolved: Record<string, ResolvedAd> = {};
  const errors: Record<string, string> = {};

  // Per-ad validation — invalid entries get error markers + null urls
  // but don't block the rest of the batch.
  const validAds: AdResolveRequest[] = [];
  for (const ad of ads) {
    const validationError = validateAdRequest(ad);
    if (validationError) {
      // Even invalid entries need an ad_id key so the caller can
      // correlate. If ad_id itself is missing, skip silently — no
      // way to correlate the error anyway.
      if (ad.ad_id) {
        resolved[ad.ad_id] = { kind: ad.kind ?? "UNKNOWN", urls: null };
        errors[ad.ad_id] = validationError;
      }
    } else {
      validAds.push(ad);
    }
  }

  // Group by kind for batching + routing.
  const pathAads = validAds.filter((a) => a.kind === "A_DIRECT_VIDEO");
  const pathBads = validAds.filter((a) => a.kind === "B_SPARK_AD");
  const pathDads = validAds.filter((a) => a.kind === "D_DCO_OEMBED");
  const pathCorUnknown = validAds.filter(
    (a) => a.kind === "C_PURE_IMAGE_DEFERRED" || a.kind === "UNKNOWN"
  );

  // C/UNKNOWN — null URLs, no API call. Card falls back to embed-
  // iframe / placeholder per 2d.
  for (const ad of pathCorUnknown) {
    resolved[ad.ad_id] = { kind: ad.kind, urls: null };
  }

  // Path A — single /file/video/ad/info/ call with all video_ids batched.
  // TikTok's endpoint accepts a video_ids[] array, so N path-A ads cost
  // ONE API call total. Saves quota + latency vs Promise.all of N calls.
  if (pathAads.length > 0) {
    const videoIds = pathAads.map((a) => a.video_id!);
    try {
      const rows = await getFileVideoAdInfo(accessToken, advertiserId, videoIds);
      const byVideoId = new Map(rows.map((r) => [r.video_id, r]));
      for (const ad of pathAads) {
        const row = byVideoId.get(ad.video_id!);
        if (row) {
          resolved[ad.ad_id] = {
            kind: ad.kind,
            urls: normalizeFileVideoAdInfoToCreative(row),
          };
        } else {
          resolved[ad.ad_id] = { kind: ad.kind, urls: null };
          errors[ad.ad_id] = "video_not_found";
        }
      }
    } catch (err) {
      // Re-throw rate-limit + reauth — these are batch-wide states the
      // outer handler converts to 429/401.
      if (isTiktokRateLimitError(err)) throw err;
      const reauth = classifyTiktokError(err);
      if (reauth) throw reauth;
      // Other failures — mark all path-A ads as failed but continue
      // path-B + C/UNKNOWN processing (they may still succeed).
      console.warn(
        "[tiktok-url-resolve] path A batch failed:",
        err instanceof Error ? err.message : "unknown"
      );
      for (const ad of pathAads) {
        resolved[ad.ad_id] = { kind: ad.kind, urls: null };
        errors[ad.ad_id] = "resolve_failed";
      }
    }
  }

  // Path B — chunked /identity/video/info/ calls per ADR-020
  // §ResolveConcurrency (2026-06-01). TikTok doesn't expose a batch
  // form for identity-video lookups (one item_id per call), so we
  // chunk the N path-B ads into windows of PATH_B_CONCURRENCY and
  // await each window sequentially. At any moment, ≤ PATH_B_CONCURRENCY
  // calls are in flight, keeping sustained rate ~8 req/s ≈ 480/min
  // (80% of TikTok's 600/min documented cap, 10× under the burst that
  // empirically tripped 40100 at lifetime scale).
  //
  // Fail-fast on batch-wide errors per §ResolveConcurrency: after each
  // chunk, if any per-ad result tagged a bubble (rate-limit / reauth),
  // throw immediately BEFORE starting the next chunk. Continuing to
  // fire chunks after a 40100 would generate more rate-limited calls
  // within the same sliding window — same lost time, more wasted quota.
  if (pathBads.length > 0) {
    type PathBResult = {
      ad: AdResolveRequest;
      urls: TikTokCreativeUrls | null;
      error?: string;
      // Tagged when the error must bubble to the outer handler (auth /
      // rate-limit). The chunk's Promise.all return swallows these;
      // we re-throw immediately after each chunk to fail-fast.
      bubble?: unknown;
    };
    const results: PathBResult[] = [];
    for (let i = 0; i < pathBads.length; i += PATH_B_CONCURRENCY) {
      const chunk = pathBads.slice(i, i + PATH_B_CONCURRENCY);
      const chunkResults: PathBResult[] = await Promise.all(
        chunk.map(async (ad): Promise<PathBResult> => {
          // PRIMARY — /identity/video/info/ (path B's canonical resolver).
          // Returns playableUrl + posterUrl + caption when the Spark Ad's
          // identity authorization is still intact.
          let primaryError: string | undefined;
          try {
            const detail = await getIdentityVideoInfo(
              accessToken,
              advertiserId,
              ad.identity_type!,
              ad.identity_id!,
              ad.item_id!
            );
            if (detail) {
              return {
                ad,
                urls: normalizeIdentityVideoInfoToCreative(detail),
              };
            }
            primaryError = "video_not_found";
          } catch (err) {
            // Batch-wide errors (rate-limit / reauth) bubble immediately.
            if (isTiktokRateLimitError(err) || classifyTiktokError(err)) {
              return { ad, urls: null, bubble: err };
            }
            console.warn(
              `[tiktok-url-resolve] path B primary fail ad ${ad.ad_id}:`,
              err instanceof Error ? err.message : "unknown"
            );
            primaryError = "resolve_failed";
          }

          // FALLBACK — public oEmbed (recovers BOTH poster AND creator
          // fields when /identity/video/info/ fails per-ad — e.g., Spark
          // Ad authorization expired, creator revoked permission, source
          // post moved). Empirically verified item_id 7426361262524665106
          // ("influancer OCT"): identity returned null, oEmbed returned
          // 200 + thumbnail + author info.
          //
          // ⚠️ HISTORICAL NOTE — fallback-only, not always-call.
          // An earlier iteration (commit 8b350e1, 2026-06-01) tried calling
          // oEmbed for EVERY path-B ad in parallel with the identity call.
          // The intent was to give every Spark Ad a creator-display name
          // on the card, not just the identity-failure cases. But on
          // IMAA's ~103 path-B ads, the burst of ~103 simultaneous oEmbed
          // calls (4 parallel × ~26 chunks) tripped an UNDOCUMENTED rate
          // limit on www.tiktok.com (consumer host) → HTTP 429 → entire
          // grid broken. Reverted to fallback-only here.
          //
          // The proper fix for "creator name on every Spark Ad" is
          // lazy-visible oEmbed (resolve only the on-screen slice,
          // ≤ CREATIVES_PAGE_SIZE) + creator-text-cache (cache author
          // name/handle persistently — they don't expire like the
          // poster URL). Tracked in gh issue #52.
          //
          // For now: oEmbed only fires when identity fails per-ad,
          // bounding upfront oEmbed calls to ≤ identity-failure-count
          // (~30-50 on IMAA worst case) — well under the rate limit.
          try {
            const oembed = await resolveOembed(ad.item_id!);
            if (oembed) {
              const urls: TikTokCreativeUrls = {
                posterUrl: oembed.thumbnailUrl,
                playableUrl: "", // no MP4 from oEmbed; iframe handles playback
                expiresAt: oembed.expiresAt,
                duration: 0,
                width: oembed.thumbnailWidth,
                height: oembed.thumbnailHeight,
                creatorName: oembed.authorName,
                creatorHandle: oembed.authorHandle,
                creatorUrl: oembed.authorUrl,
              };
              return {
                ad,
                urls,
                // Diagnostic marker so we can later quantify how often the
                // fallback fires (Vercel logs grep) — informs whether the
                // path-B identity-failure rate justifies the lazy-visible
                // refactor's complexity (#52).
                error: "identity_failed_oembed_fallback",
              };
            }
          } catch (err) {
            if (isTiktokRateLimitError(err)) {
              return { ad, urls: null, bubble: err };
            }
            console.warn(
              `[tiktok-url-resolve] path B oEmbed fallback unexpected throw ad ${ad.ad_id}:`,
              err instanceof Error ? err.message : "unknown"
            );
          }

          // Both primary and fallback returned nothing usable — STATE 3
          // placeholder + modal iframe.
          return { ad, urls: null, error: primaryError ?? "video_not_found" };
        })
      );
      results.push(...chunkResults);

      // Fail-fast: throw on the FIRST chunk that bubbles a batch-wide
      // error. Subsequent chunks are NOT fired — see §ResolveConcurrency
      // rationale. Per-ad logical failures (video_not_found,
      // resolve_failed) stay isolated and don't trigger this branch.
      const bubbled = chunkResults.find((r) => r.bubble);
      if (bubbled) {
        if (isTiktokRateLimitError(bubbled.bubble)) throw bubbled.bubble;
        const reauth = classifyTiktokError(bubbled.bubble);
        if (reauth) throw reauth;
        // Defensive: shouldn't happen since the inner try only tags these
        throw bubbled.bubble;
      }
    }
    for (const r of results) {
      resolved[r.ad.ad_id] = { kind: r.ad.kind, urls: r.urls };
      if (r.error) errors[r.ad.ad_id] = r.error;
    }
  }

  // Path D — chunked public oEmbed lookups per ADR-020 §DCO-Identity.
  // Verbatim mirror of path-B's chunk-loop shape: OEMBED_CONCURRENCY=4
  // (imported from api.ts), Promise.all per chunk, in-loop fail-fast
  // on tagged bubble. Differences from path-B:
  //   - No reauth path (oEmbed has no auth → classifyTiktokError can't
  //     match an oEmbed failure; we only check rate-limit on bubble).
  //   - Per-item failures (404/private/deleted/geo/5xx/timeout) are
  //     swallowed inside resolveOembed and surface here as `null` —
  //     mapped to error key "oembed_unresolved" so the Card falls to
  //     STATE 3 + modal iframe (per §DCO-Identity Risk #2).
  //   - resolveOembed throws ONLY on HTTP 429 with "rate limit" in the
  //     message → matched by the existing isTiktokRateLimitError
  //     detector at errors.ts:118 → batch bubbles via the same path
  //     as path-B's 40100. No oEmbed-specific detector needed.
  if (pathDads.length > 0) {
    type PathDResult = {
      ad: AdResolveRequest;
      urls: TikTokCreativeUrls | null;
      error?: string;
      bubble?: unknown;
    };
    const results: PathDResult[] = [];
    for (let i = 0; i < pathDads.length; i += OEMBED_CONCURRENCY) {
      const chunk = pathDads.slice(i, i + OEMBED_CONCURRENCY);
      const chunkResults: PathDResult[] = await Promise.all(
        chunk.map(async (ad): Promise<PathDResult> => {
          try {
            const oembed = await resolveOembed(ad.item_id!);
            if (oembed) {
              const urls: TikTokCreativeUrls = {
                posterUrl: oembed.thumbnailUrl,
                playableUrl: "", // no MP4 from oEmbed; modal iframe handles playback
                expiresAt: oembed.expiresAt,
                duration: 0, // not applicable to still image
                width: oembed.thumbnailWidth,
                height: oembed.thumbnailHeight,
                creatorName: oembed.authorName,
                creatorHandle: oembed.authorHandle,
                creatorUrl: oembed.authorUrl,
              };
              return { ad, urls };
            }
            return { ad, urls: null, error: "oembed_unresolved" };
          } catch (err) {
            if (isTiktokRateLimitError(err)) {
              return { ad, urls: null, bubble: err };
            }
            // Defensive — resolveOembed shouldn't throw on anything else
            // (all non-429 failures are swallowed to null internally).
            console.warn(
              `[tiktok-url-resolve] path D unexpected throw ad ${ad.ad_id}:`,
              err instanceof Error ? err.message : "unknown"
            );
            return { ad, urls: null, error: "resolve_failed" };
          }
        })
      );
      results.push(...chunkResults);

      // Fail-fast: same shape as path-B. Throw on the FIRST chunk that
      // bubbles rate-limit; subsequent chunks NOT fired.
      const bubbled = chunkResults.find((r) => r.bubble);
      if (bubbled) {
        if (isTiktokRateLimitError(bubbled.bubble)) throw bubbled.bubble;
        // Defensive: only rate-limit ever tags bubble in path D
        throw bubbled.bubble;
      }
    }
    for (const r of results) {
      resolved[r.ad.ad_id] = { kind: r.ad.kind, urls: r.urls };
      if (r.error) errors[r.ad.ad_id] = r.error;
    }
  }

  return { resolved, errors };
}

// ═══════════════════════════════════════════════════════════════════
// Auth + ownership guard — runs before any credential fetch.
// Returns the access_token + advertiser_id on success, or a
// NextResponse to short-circuit on failure.
// ═══════════════════════════════════════════════════════════════════

async function authorizeAndGetCreds(
  request: NextRequest,
  accountId: string
): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; response: NextResponse }
> {
  void request;

  // 1. AUTH — Supabase SSR user check.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  // 2. OWNERSHIP GUARD — MUST run before any credential fetch.
  //
  // Multi-tenant isolation: platform_credentials.access_token is
  // per-USER, not per-account. Without this check, user A could pass
  // user B's account_id and read creatives via the token bound to
  // user A's TikTok app authorization. The connections-table row
  // binds (user_id, account_id) explicitly — that's the only valid
  // proof this user owns this account_id.
  //
  // SELECT from connections WHERE user_id + platform=tiktok +
  // account_id + status=active. If no row → 403, halt before
  // credential fetch.
  const { data: connection } = await supabase
    .from("connections")
    .select("id")
    .eq("user_id", user.id)
    .eq("platform", "tiktok")
    .eq("account_id", accountId)
    .eq("status", "active")
    .maybeSingle();

  if (!connection) {
    // 403 rather than 404 — distinguishes "you don't own this" from
    // "no such ad". The client should never see this unless the UI
    // sends a wrong account_id (bug) or someone is probing for cross-
    // tenant leaks (security concern logged here for monitoring).
    console.warn(
      `[tiktok-url-resolve] ownership denied: user=${user.id} account_id=${accountId}`
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "account_not_owned" },
        { status: 403 }
      ),
    };
  }

  // 3. ONLY AFTER ownership confirmed — fetch credentials.
  const adminClient = createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const accessToken = await getRefreshTokenForUser(
    adminClient,
    user.id,
    "tiktok"
  );
  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "no_oauth_token" },
        { status: 401 }
      ),
    };
  }

  return { ok: true, accessToken };
}

// ═══════════════════════════════════════════════════════════════════
// Outer error mapping — ReauthRequiredError → 401, rate-limit → 429,
// other → 500.
// ═══════════════════════════════════════════════════════════════════

function mapErrorToResponse(err: unknown): NextResponse {
  if (isReauthError(err)) {
    return NextResponse.json(
      {
        error: "reauth_required",
        provider: err.provider,
        reason: err.reason,
        reauthUrl: err.reauthUrl,
        message: "انتهت صلاحية ربط حساب TikTok. يرجى إعادة الربط للمتابعة.",
      },
      { status: 401 }
    );
  }
  if (isTiktokRateLimitError(err)) {
    // Log the source error so future 429 investigations don't have to
    // guess which call tripped the rate-limit (the 401/429 paths
    // otherwise return without logging — caught us out during the
    // 8b350e1 always-call-oEmbed regression diagnosis, where the
    // bubbled oEmbed-429 throw was completely silent in logs).
    console.warn(
      "[tiktok-url-resolve] returning 429 rate_limited:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      {
        error: "rate_limited",
        message:
          "تم تجاوز الحد المسموح للاستفسارات من TikTok. الرجاء المحاولة بعد بضع دقائق.",
      },
      { status: 429 }
    );
  }
  console.error("[tiktok-url-resolve] Error:", err);
  return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
}

// ═══════════════════════════════════════════════════════════════════
// GET — single-ad resolve. Used by the detail modal.
// ═══════════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const accountId = params.get("account_id");
    const adId = params.get("ad_id");
    const kind = params.get("kind") as CreativeKind | null;

    if (!accountId) {
      return NextResponse.json(
        { error: "missing_account_id" },
        { status: 400 }
      );
    }
    if (!adId) {
      return NextResponse.json({ error: "missing_ad_id" }, { status: 400 });
    }
    if (!kind || !VALID_KINDS.has(kind)) {
      return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
    }

    const auth = await authorizeAndGetCreds(request, accountId);
    if (!auth.ok) return auth.response;

    const adRequest: AdResolveRequest = {
      ad_id: adId,
      kind,
      video_id: params.get("video_id") ?? undefined,
      item_id: params.get("item_id") ?? undefined,
      identity_type: params.get("identity_type") ?? undefined,
      identity_id: params.get("identity_id") ?? undefined,
    };

    // Validate the single ad request explicitly — return 400 for the
    // GET form (vs the per-entry errors map used by POST batch).
    const validationError = validateAdRequest(adRequest);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    const { resolved, errors } = await resolveAds(
      auth.accessToken,
      accountId,
      [adRequest]
    );

    const result = resolved[adId];
    const error = errors[adId];
    return NextResponse.json({
      ad_id: adId,
      kind: result?.kind ?? kind,
      urls: result?.urls ?? null,
      ...(error ? { error } : {}),
    });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST — batch resolve. Used by the eager grid lazy-load.
// ═══════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    let body: PostBody;
    try {
      body = (await request.json()) as PostBody;
    } catch {
      return NextResponse.json(
        { error: "invalid_json_body" },
        { status: 400 }
      );
    }

    const accountId = typeof body.account_id === "string" ? body.account_id : null;
    const adsInput = Array.isArray(body.ads) ? body.ads : null;

    if (!accountId) {
      return NextResponse.json(
        { error: "missing_account_id" },
        { status: 400 }
      );
    }
    if (!adsInput || adsInput.length === 0) {
      return NextResponse.json({ error: "missing_ads" }, { status: 400 });
    }

    const auth = await authorizeAndGetCreds(request, accountId);
    if (!auth.ok) return auth.response;

    // Coerce raw body entries to AdResolveRequest shape — defensive
    // against malformed inputs. Per-entry validation happens inside
    // resolveAds (records errors[ad_id]) rather than rejecting the
    // whole batch.
    const ads: AdResolveRequest[] = adsInput.map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        ad_id: typeof r.ad_id === "string" ? r.ad_id : "",
        kind: (typeof r.kind === "string" ? r.kind : "UNKNOWN") as CreativeKind,
        video_id: typeof r.video_id === "string" ? r.video_id : undefined,
        item_id: typeof r.item_id === "string" ? r.item_id : undefined,
        identity_type:
          typeof r.identity_type === "string" ? r.identity_type : undefined,
        identity_id:
          typeof r.identity_id === "string" ? r.identity_id : undefined,
      };
    });

    const { resolved, errors } = await resolveAds(
      auth.accessToken,
      accountId,
      ads
    );

    return NextResponse.json({ resolved, errors });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
