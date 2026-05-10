"use client";

import { useState, useEffect } from "react";
import type { UnifiedAd, DateRangeValue } from "@/lib/ads/types";
import type { AdProvider } from "@/lib/ads/cache";

interface UseAdsOptions {
  range?: DateRangeValue;
  customRange?: { since: string; until: string };
  provider?: AdProvider;
}

interface UseAdsReturn {
  ads: UnifiedAd[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetch ads (with creative + performance) for the current period from
 * /api/ads/creatives. Mirrors the URL-building logic from useInsights so
 * preset/custom range inputs are handled consistently.
 */
export function useAds(options: UseAdsOptions): UseAdsReturn {
  const [ads, setAds] = useState<UnifiedAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable primitives for deps (avoid re-fetch on object reference change)
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

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

    fetch(`/api/ads/creatives?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setAds(Array.isArray(data.data) ? data.data : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[useAds] Error:", err);
        setError(err instanceof Error ? err.message : "fetch_failed");
        setAds([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    provider,
    customSince,
    customUntil,
    rangeType,
    rangePreset,
    rangeSince,
    rangeUntil,
  ]);

  return { ads, loading, error };
}
