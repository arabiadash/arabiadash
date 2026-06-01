"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnifiedAdTiktok } from "@/lib/ads/types";
import type { TikTokCreativeUrls } from "@/lib/tiktok/normalize";
import {
  buildAdResolveRequest,
  type AdResolveRequest,
} from "@/lib/tiktok/url-resolve";

/**
 * useTiktokCreativeUrls hooks per ADR-020 §12c §2.
 *
 * Resolves SHORT-LIVED signed CDN URLs for TikTok creatives on demand.
 * URLs expire in ~1 hour (live-verified 2026-05-31 smoke test), so this
 * hook is the FIRST on-mount async URL-resolution pattern in the
 * dashboard — Meta/Google use eager-fetched URLs from their creatives
 * payload, but TikTok's signed URLs would 403 within an hour of cache
 * write, so we resolve on every render cycle (tab mount + modal open).
 *
 * Architecture (per ADR-020 §12c §2 + 2c route):
 *   - creatives_cache stores ONLY discriminators (videoId, tiktok_item_id,
 *     identity_type, identity_id)
 *   - These hooks call /api/ads/creatives/tiktok-url-resolve at render
 *     time, the route fetches fresh signed URLs from TikTok, returns
 *     them to the client which uses them immediately
 *   - Resolved URLs are kept in component state, used immediately, then
 *     discarded on unmount (no hook-layer cache; the 1-hour TTL doesn't
 *     justify cross-mount memoization)
 *
 * Snapchat (Phase 8) reuse note:
 *   This is the first instance of the on-mount URL-resolution pattern.
 *   Snapchat will likely face the same signed-URL TTL issue (most ad
 *   platforms use signed CDNs for creative media). When Phase 8 lands,
 *   evaluate extracting a generic
 *   `useExpiringUrlResolver<TPayload, TResult>` factory — but DON'T
 *   pre-generalize now (Memory #27 long-term-fit principle: one
 *   instance isn't enough to know the abstraction shape; wait for the
 *   second platform to clarify it).
 *
 * AbortController + request-token guard mirror useSearchTerms /
 * useKeywords per ADR-019 §6 (the unmount-race gate). AbortError is
 * silently handled — expected outcome of unmount-or-refresh
 * cancellation. The token guard prevents stale resolutions from
 * writing state when a more recent request has been kicked off.
 *
 * Two hooks (clean separation by use case):
 *   - useTiktokCreativeUrlsBatch: grid view — one POST batch for N ads
 *   - useTiktokCreativeUrl:       detail modal — single GET, always fresh
 */

// ═══════════════════════════════════════════════════════════════════
// Shared error union — matches /api/ads/creatives/tiktok-url-resolve
// status codes (per route's mapErrorToResponse).
// ═══════════════════════════════════════════════════════════════════

export type CreativeUrlError =
  | "fetch_failed"
  | "reauth_required"
  | "rate_limited";

// ═══════════════════════════════════════════════════════════════════
// Internal — wire shapes returned by the route
// ═══════════════════════════════════════════════════════════════════

interface BatchResponseBody {
  resolved: Record<
    string,
    { kind: string; urls: TikTokCreativeUrls | null }
  >;
  errors: Record<string, string>;
}

interface SingleResponseBody {
  ad_id: string;
  kind: string;
  urls: TikTokCreativeUrls | null;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Internal — helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the query string for the GET form. The route accepts the same
 * fields the AdResolveRequest interface defines; optional fields are
 * elided when absent.
 */
function buildSingleGetUrl(
  accountId: string,
  payload: AdResolveRequest
): string {
  const params = new URLSearchParams({
    account_id: accountId,
    ad_id: payload.ad_id,
    kind: payload.kind,
  });
  if (payload.video_id) params.set("video_id", payload.video_id);
  if (payload.item_id) params.set("item_id", payload.item_id);
  if (payload.identity_type) params.set("identity_type", payload.identity_type);
  if (payload.identity_id) params.set("identity_id", payload.identity_id);
  return `/api/ads/creatives/tiktok-url-resolve?${params.toString()}`;
}

/**
 * Classify an HTTP response into the CreativeUrlError union. Returns
 * null when ok=true (caller proceeds to read body). Distinguishes
 * 401 reauth (specific error body) from generic 401, and surfaces
 * 429 separately so the UI can show a rate-limit message.
 */
async function classifyResponseError(
  res: Response
): Promise<CreativeUrlError | null> {
  if (res.ok) return null;
  if (res.status === 401) {
    try {
      const body = await res.clone().json();
      if (body?.error === "reauth_required") return "reauth_required";
    } catch {
      // body wasn't JSON or didn't carry our reauth shape — fall through
    }
    return "fetch_failed";
  }
  if (res.status === 429) return "rate_limited";
  return "fetch_failed";
}

// ═══════════════════════════════════════════════════════════════════
// useTiktokCreativeUrlsBatch — grid view (one POST resolves N ads)
// ═══════════════════════════════════════════════════════════════════

export interface UseTiktokCreativeUrlsBatchOptions {
  /** TikTok advertiser_id (bare numeric). Must be owned by the auth'd user. */
  accountId: string;
  /**
   * TikTok ads to resolve URLs for. The hook builds the request payload
   * internally via buildAdResolveRequest (preserves the kind↔IDs
   * invariant from normalize.ts's routeCreativeByIdentityType).
   */
  ads: UnifiedAdTiktok[];
  /**
   * Skip the fetch entirely when false. Default true. Useful for
   * conditionally mounting the consuming component without firing
   * a request (e.g. before the user opens the TikTok tab).
   */
  enabled?: boolean;
}

export interface UseTiktokCreativeUrlsBatchReturn {
  /**
   * ad_id → resolved URLs OR null. Null means: route returned null
   * (path C/UNKNOWN, or path-A/B endpoint returned no data).
   * Absent keys mean: fetch hasn't completed yet (loading=true) OR
   * the ad wasn't in the input set.
   */
  urls: Record<string, TikTokCreativeUrls | null>;
  /**
   * ad_id → per-ad error reason (the route's `errors` map). Per-ad
   * failures are isolated — don't kill the batch. Use to render
   * placeholder UI for the specific ad.
   */
  errors: Record<string, string>;
  loading: boolean;
  /**
   * Batch-wide error (auth / rate limit / network). Distinct from
   * per-ad `errors` map — when set, NO ad resolved (the whole batch
   * failed at the route/auth layer).
   */
  error: CreativeUrlError | null;
  /** Refetch all URLs (e.g. when user dismisses an expired-URL state). */
  refresh: () => Promise<void>;
}

/**
 * Phase 1A (2026-06-01) — hard cap on oEmbed calls per fetch + additive
 * resolved map + auto-staged batches.
 *
 * THE PROBLEM: TikTok's www.tiktok.com (consumer oEmbed host) has an
 * UNDOCUMENTED rate limit. Empirically: commit 8b350e1's "always-call
 * oEmbed for every path-B Spark Ad" sent ~115 oEmbed calls in one
 * burst on IMAA's lifetime view → HTTP 429 → entire batch errored →
 * grid broken. Even the post-1f11888 fallback-only design tripped 429
 * on lifetime when ~30-50 path-B identity failures fired their
 * fallbacks together.
 *
 * THE FIX: cap each POST to ≤ MAX_OEMBED_PER_FETCH unresolved ads.
 * Combined with additive in-memory state (never re-fetch already
 * resolved), this bounds oEmbed calls per fetch to ~20 regardless
 * of total ad count. For "Show all" with 100+ ads, the hook auto-
 * stages bounded batches of 20 with 500 ms gaps (gentle pacing).
 * On 429 inside a capped batch, back off 2 s and retry once; if still
 * 429, give up silently (cards beyond resolved stay STATE 3/4
 * placeholder per the graceful-degradation requirement — no
 * batch-wide error state thrown).
 *
 * Resolved map persists across adsKey changes (filter / range toggles
 * within session) — in-memory, cheap. Cleared only on refresh() so
 * the user can force re-fetch from the tab header button.
 *
 * For ads beyond the cap on initial load:
 *   - Cards render as before (the hook leaves urls[adId] undefined,
 *     Card falls to STATE 3/4 placeholder + ad.name title).
 *   - Subsequent "Load more" interactions (visibleCount grows →
 *     adsKey changes → useEffect re-fires) pick up the next batch
 *     of unresolved ads (capped 20 again).
 *
 * Phase 2 (#52, pre-launch) will add a server-side creator-text-cache
 * keyed on tiktok_item_id, amortizing oEmbed calls across customers.
 * That makes oEmbed sustainable at multi-tenant scale.
 */
const MAX_OEMBED_PER_FETCH = 20;
const INTER_BATCH_DELAY_MS = 500;
const BACKOFF_ON_429_MS = 2000;

export function useTiktokCreativeUrlsBatch(
  options: UseTiktokCreativeUrlsBatchOptions
): UseTiktokCreativeUrlsBatchReturn {
  const { accountId, ads, enabled = true } = options;

  const [urls, setUrls] = useState<Record<string, TikTokCreativeUrls | null>>(
    {}
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CreativeUrlError | null>(null);

  // Mirror refs for the resolved + errors maps. Reading from refs
  // inside doFetch's loop avoids closure-stale issues when the loop
  // iterates across multiple batches (state setter is async; ref
  // lets the next iteration see the just-merged values without
  // depending on a re-render).
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const errorsRef = useRef(errors);
  errorsRef.current = errors;

  // Request-token guard per ADR-019 §6 — increments on every doFetch;
  // only the latest token's resolution writes state. Prevents stale
  // resolutions from racing past a newer request.
  const reqTokenRef = useRef(0);
  // AbortController for in-flight cancellation on unmount or before
  // refresh — same pattern as useSearchTerms.
  const abortRef = useRef<AbortController | null>(null);

  // Derived dep key — sorted comma-join of ad ids. Stable across parent
  // re-renders that don't change the ad set; only re-fires the effect
  // when the underlying ads change. Avoids the "ads array identity
  // changes every render" issue without forcing the parent to memoize.
  const adsKey = useMemo(
    () => ads.map((a) => a.id).sort().join(","),
    [ads]
  );

  // Orchestration (token guard + abort + try/catch + AbortError silent)
  // mirrors useTiktokCreativeUrl's doFetch below. Intentional inline
  // duplication per 2d-1 — no premature shared-helper abstraction
  // until Snapchat (Phase 8) gives a 2nd case to clarify the right
  // generic shape. If you change token/abort handling here, mirror
  // it in the sibling hook.
  const doFetch = useCallback(
    async (forceRefresh: boolean): Promise<void> => {
      if (!enabled || !accountId || ads.length === 0) {
        // Clean defaults on empty input. forceRefresh also clears.
        setUrls({});
        setErrors({});
        urlsRef.current = {};
        errorsRef.current = {};
        setError(null);
        setLoading(false);
        return;
      }

      // Cancel any in-flight before starting a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const token = ++reqTokenRef.current;
      setLoading(true);
      setError(null);

      // forceRefresh: clear resolved + errors so the loop picks up
      // every ad again from scratch (matches user's "refresh" intent).
      if (forceRefresh) {
        setUrls({});
        setErrors({});
        urlsRef.current = {};
        errorsRef.current = {};
      }

      try {
        // Auto-stage loop — fetch capped batches until all ads are
        // either resolved (urls map) or errored (errors map). Each
        // iteration fetches up to MAX_OEMBED_PER_FETCH unresolved ads.
        // Bounded by ads.length / cap iterations max.
        let backoffPending = false;

        while (true) {
          if (token !== reqTokenRef.current || controller.signal.aborted) return;

          const currentUrls = urlsRef.current;
          const currentErrors = errorsRef.current;
          const unresolved = ads.filter(
            (a) => !(a.id in currentUrls) && !(a.id in currentErrors)
          );

          if (unresolved.length === 0) break; // all done — exit loop

          const toResolve = unresolved.slice(0, MAX_OEMBED_PER_FETCH);
          const payload = toResolve.map(buildAdResolveRequest);

          const res = await fetch("/api/ads/creatives/tiktok-url-resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: accountId, ads: payload }),
            signal: controller.signal,
          });
          if (token !== reqTokenRef.current) return;

          const errKind = await classifyResponseError(res);
          if (errKind) {
            if (errKind === "rate_limited" && !backoffPending) {
              // First 429 in this run: backoff and retry once. Surfaces
              // the rate-limit pressure to the next iteration without
              // immediately marking ads errored — gives TikTok a chance
              // to recover before we give up.
              backoffPending = true;
              await new Promise((resolve) =>
                setTimeout(resolve, BACKOFF_ON_429_MS)
              );
              continue;
            }
            if (errKind === "rate_limited") {
              // Second consecutive 429 after backoff. Stop the loop
              // SILENTLY — do NOT set batch-wide error state. Cards
              // beyond resolved stay STATE 3/4 placeholder (graceful
              // degradation per Phase 1A requirement). User can retry
              // via the tab refresh button (forceRefresh).
              console.warn(
                "[useTiktokCreativeUrlsBatch] sustained 429 after backoff — stopping auto-stage, " +
                  `${unresolved.length} ads remain unresolved (will retry on next adsKey change or refresh)`
              );
              return;
            }
            // Non-rate-limit errors (reauth, fetch_failed) ARE batch-
            // wide and need UI surfacing.
            setError(errKind);
            return;
          }

          // Successful batch — merge into refs + state additively.
          // Reading raw response keeps the loop iteration's view fresh.
          backoffPending = false;
          const body = (await res.json()) as BatchResponseBody;
          if (token !== reqTokenRef.current) return;

          const batchUrls: Record<string, TikTokCreativeUrls | null> = {};
          for (const [adId, entry] of Object.entries(body.resolved ?? {})) {
            batchUrls[adId] = entry?.urls ?? null;
          }
          const batchErrors = body.errors ?? {};

          // Merge: previous + this batch. Refs FIRST so the next loop
          // iteration's filter sees the just-resolved ads (state setter
          // is async; ref is synchronous).
          urlsRef.current = { ...urlsRef.current, ...batchUrls };
          errorsRef.current = { ...errorsRef.current, ...batchErrors };
          setUrls(urlsRef.current);
          setErrors(errorsRef.current);

          // Brief delay between batches — politeness toward TikTok's
          // oEmbed endpoint + leaves headroom for the next interaction.
          // Skipped when nothing more to fetch (loop exits via the
          // unresolved.length check at the top).
          const remaining = ads.filter(
            (a) =>
              !(a.id in urlsRef.current) && !(a.id in errorsRef.current)
          ).length;
          if (remaining > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, INTER_BATCH_DELAY_MS)
            );
          }
        }
      } catch (err) {
        if (token !== reqTokenRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          return; // expected — unmount / new-refresh cancellation
        }
        console.error("[useTiktokCreativeUrlsBatch] Unexpected:", err);
        setError("fetch_failed");
      } finally {
        if (token === reqTokenRef.current) setLoading(false);
      }
    },
    // adsKey is the stable derivation of `ads`; depending on it instead
    // of `ads` directly prevents re-fires on parent re-renders that
    // produce a new array identity with the same id set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, accountId, adsKey]
  );

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void doFetch(false);
    return () => {
      abortRef.current?.abort();
    };
  }, [doFetch, enabled]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  return { urls, errors, loading, error, refresh };
}

// ═══════════════════════════════════════════════════════════════════
// useTiktokCreativeUrl — modal single-fetch (always fresh GET)
// ═══════════════════════════════════════════════════════════════════

export interface UseTiktokCreativeUrlOptions {
  accountId: string;
  ad: UnifiedAdTiktok;
  /** Default true — modal sets true when opened, false when closed. */
  enabled?: boolean;
}

export interface UseTiktokCreativeUrlReturn {
  urls: TikTokCreativeUrls | null;
  loading: boolean;
  error: CreativeUrlError | null;
  refresh: () => Promise<void>;
}

export function useTiktokCreativeUrl(
  options: UseTiktokCreativeUrlOptions
): UseTiktokCreativeUrlReturn {
  const { accountId, ad, enabled = true } = options;

  const [urls, setUrls] = useState<TikTokCreativeUrls | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CreativeUrlError | null>(null);

  const reqTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Build the payload once per ad change. JSON-key serializes the full
  // routing-affecting payload (kind + IDs) so any discriminator change
  // re-fires the effect — defensive against an ad mutating identity_*
  // after initial creatives load (rare but possible across re-fetches).
  const adPayload = useMemo(() => buildAdResolveRequest(ad), [ad]);
  const adKey = useMemo(() => JSON.stringify(adPayload), [adPayload]);

  // Orchestration (token guard + abort + try/catch + AbortError silent)
  // mirrors useTiktokCreativeUrlsBatch's doFetch above. Intentional
  // inline duplication per 2d-1 — no premature shared-helper
  // abstraction until Snapchat (Phase 8) gives a 2nd case to clarify
  // the right generic shape. If you change token/abort handling here,
  // mirror it in the sibling hook.
  const doFetch = useCallback(
    async (forceRefresh: boolean): Promise<void> => {
      void forceRefresh;

      if (!enabled || !accountId) {
        setUrls(null);
        setError(null);
        setLoading(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const token = ++reqTokenRef.current;
      setLoading(true);
      setError(null);

      try {
        const url = buildSingleGetUrl(accountId, adPayload);
        const res = await fetch(url, { signal: controller.signal });
        if (token !== reqTokenRef.current) return;

        const errKind = await classifyResponseError(res);
        if (errKind) {
          setError(errKind);
          return;
        }

        const body = (await res.json()) as SingleResponseBody;
        if (token !== reqTokenRef.current) return;
        setUrls(body.urls ?? null);
      } catch (err) {
        if (token !== reqTokenRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[useTiktokCreativeUrl] Unexpected:", err);
        setError("fetch_failed");
      } finally {
        if (token === reqTokenRef.current) setLoading(false);
      }
    },
    // adKey carries the full routing payload; adPayload is captured
    // from closure (used inside the body). Depending on adKey ensures
    // any identity-* change triggers re-fetch; depending on adPayload
    // separately would cause an extra re-render cycle since useMemo
    // identity changes alongside adKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, accountId, adKey]
  );

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void doFetch(false);
    return () => {
      abortRef.current?.abort();
    };
  }, [doFetch, enabled]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  return { urls, loading, error, refresh };
}
