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
      if (forceRefresh) params.set("refresh", "true");
      return params;
    },
    [
      provider,
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
    [buildParams]
  );

  useEffect(() => {
    void doFetch(false);
  }, [doFetch]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

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
