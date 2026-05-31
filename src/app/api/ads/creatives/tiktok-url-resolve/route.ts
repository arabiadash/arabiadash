import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getRefreshTokenForUser } from "@/lib/google-ads/credentials";
import {
  getFileVideoAdInfo,
  getIdentityVideoInfo,
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
// Types
// ═══════════════════════════════════════════════════════════════════

type CreativeKind =
  | "A_DIRECT_VIDEO"
  | "B_SPARK_AD"
  | "C_PURE_IMAGE_DEFERRED"
  | "UNKNOWN";

interface AdResolveRequest {
  ad_id: string;
  kind: CreativeKind;
  video_id?: string;
  item_id?: string;
  identity_type?: string;
  identity_id?: string;
}

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
  "C_PURE_IMAGE_DEFERRED",
  "UNKNOWN",
]);

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

  // Path B — Promise.all of N /identity/video/info/ calls. TikTok
  // doesn't expose a batch form for identity-video lookups, so each
  // Spark Ad costs one API call. Concurrency cap deferred — IMAA's
  // 17 path-B ads in one grid is well under TikTok's 600 req/min cap.
  if (pathBads.length > 0) {
    type PathBResult = {
      ad: AdResolveRequest;
      urls: TikTokCreativeUrls | null;
      error?: string;
      // Tagged when the error must bubble to the outer handler (auth /
      // rate-limit). The Promise.all return swallows these; we re-throw
      // after collecting via the throwOnBatchWide tag.
      bubble?: unknown;
    };
    const results: PathBResult[] = await Promise.all(
      pathBads.map(async (ad): Promise<PathBResult> => {
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
          return { ad, urls: null, error: "video_not_found" };
        } catch (err) {
          // Tag batch-wide errors for re-throw; mark individual errors
          // as resolve_failed without killing siblings.
          if (isTiktokRateLimitError(err) || classifyTiktokError(err)) {
            return { ad, urls: null, bubble: err };
          }
          console.warn(
            `[tiktok-url-resolve] path B fail ad ${ad.ad_id}:`,
            err instanceof Error ? err.message : "unknown"
          );
          return { ad, urls: null, error: "resolve_failed" };
        }
      })
    );
    // Re-throw the first batch-wide error encountered (rate-limit /
    // reauth) — these affect the whole TikTok API, not just one ad.
    const bubbled = results.find((r) => r.bubble);
    if (bubbled) {
      if (isTiktokRateLimitError(bubbled.bubble)) throw bubbled.bubble;
      const reauth = classifyTiktokError(bubbled.bubble);
      if (reauth) throw reauth;
      // Defensive: shouldn't happen since the inner try only tags these
      throw bubbled.bubble;
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
