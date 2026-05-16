"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UnifiedAd, DateRangeValue } from "@/lib/ads/types";
import type { AdProvider } from "@/lib/ads/cache";

export type AdsSource =
  | "fresh"
  | "cache-fresh"
  | "cache-stale"
  | "rate-limited";

interface UseAdsOptions {
  range?: DateRangeValue;
  customRange?: { since: string; until: string };
  provider?: AdProvider;
  /**
   * Workspace-scoped account ID. Optional for single-account providers (Meta
   * picks the user's first active connection if omitted), required for
   * multi-account providers. Including it in the URL also acts as a
   * cache-scope: switching workspaces changes `accountId`, which forces a
   * re-fetch instead of showing stale data from the previous workspace.
   */
  accountId?: string;
  /**
   * Bypass the fetch entirely and return a synthetic "no connection" state.
   * Required to prevent cross-workspace data leak: without `accountId`,
   * the API's maybeSingle() fallback would return ads from another
   * workspace's Meta connection. Callers pass `skip: !accountId` for the
   * affected provider. Matches the useInsights skip pattern.
   */
  skip?: boolean;
}

interface UseAdsReturn {
  ads: UnifiedAd[];
  loading: boolean;
  error: string | null;
  source: AdsSource | null;
  fetchedAt: Date | null;
  revalidating: boolean;
  rateLimited: boolean;
  refresh: () => Promise<void>;
}

/**
 * Fetch ads (with creative + performance) for the current period from
 * /api/ads/creatives. SWR-aware: surfaces freshness so the UI can show
 * "آخر تحديث" badges and a manual refresh button.
 */
export function useAds(options: UseAdsOptions): UseAdsReturn {
  const [ads, setAds] = useState<UnifiedAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<AdsSource | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);

  const provider = options.provider ?? "meta";
  const accountId = options.accountId;
  const skip = options.skip ?? false;
  const customSince = options.customRange?.since;
  const customUntil = options.customRange?.until;
  const rangeType = options.range?.type;
  const rangePreset =
    options.range?.type === "preset" ? options.range.preset : undefined;
  const rangeSince =
    options.range?.type === "custom" ? options.range.since : undefined;
  const rangeUntil =
    options.range?.type === "custom" ? options.range.until : undefined;

  const buildParams = useCallback(
    (forceRefresh: boolean): URLSearchParams => {
      const params = new URLSearchParams();
      params.set("provider", provider);
      if (customSince && customUntil) {
        params.set("since", customSince);
        params.set("until", customUntil);
      } else if (rangeType === "custom" && rangeSince && rangeUntil) {
        params.set("since", rangeSince);
        params.set("until", rangeUntil);
      } else if (rangeType === "preset" && rangePreset) {
        params.set("range", rangePreset);
      } else {
        params.set("range", "30d");
      }
      if (accountId) params.set("account_id", accountId);
      if (forceRefresh) params.set("refresh", "true");
      return params;
    },
    [
      provider,
      accountId,
      customSince,
      customUntil,
      rangeType,
      rangePreset,
      rangeSince,
      rangeUntil,
    ]
  );

  // Track a request token so a stale in-flight refresh can't clobber a newer one.
  const reqTokenRef = useRef(0);

  const doFetch = useCallback(
    async (forceRefresh: boolean): Promise<void> => {
      // Defense-in-depth: guard inside doFetch (not just useEffect) so
      // refresh() — which calls doFetch directly — also respects skip.
      // Mirrors the useInsights pattern after its Phase 4.3 retrofit.
      if (skip) return;

      const token = ++reqTokenRef.current;
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/ads/creatives?${buildParams(forceRefresh).toString()}`
        );
        const data = await res.json();

        if (token !== reqTokenRef.current) return;

        if (res.status === 429) {
          setRateLimited(true);
          setError(data.error ?? "rate_limited");
          setAds([]);
          setSource(null);
          setFetchedAt(null);
          setRevalidating(false);
          return;
        }

        if (!res.ok) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        setAds(Array.isArray(data.data) ? data.data : []);
        setSource((data.source as AdsSource) ?? null);
        setFetchedAt(data.fetchedAt ? new Date(data.fetchedAt) : null);
        setRevalidating(Boolean(data.revalidating));
        setRateLimited(data.source === "rate-limited");
      } catch (err) {
        if (token !== reqTokenRef.current) return;
        console.error("[useAds] Error:", err);
        setError(err instanceof Error ? err.message : "fetch_failed");
        setAds([]);
        setSource(null);
        setFetchedAt(null);
        setRevalidating(false);
      } finally {
        if (token === reqTokenRef.current) setLoading(false);
      }
    },
    [buildParams, skip]
  );

  useEffect(() => {
    if (skip) return; // paused — no fetch (see `skip` JSDoc)
    void doFetch(false);
  }, [doFetch, skip]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  // When skip is on, surface a "no connection in this workspace" shape
  // regardless of any internal state left over from a previous unskipped
  // run. refresh is still exposed but is a no-op (doFetch checks skip).
  if (skip) {
    return {
      ads: [],
      loading: false,
      error: null,
      source: null,
      fetchedAt: null,
      revalidating: false,
      rateLimited: false,
      refresh,
    };
  }

  return {
    ads,
    loading,
    error,
    source,
    fetchedAt,
    revalidating,
    rateLimited,
    refresh,
  };
}
