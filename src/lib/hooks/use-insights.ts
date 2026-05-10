"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  presetToCustomRange,
  type UnifiedInsight,
  type DateRange,
  type CustomDateRange,
  type DateRangeValue,
  type TimeIncrement,
} from "@/lib/ads/types";
import type { AdProvider } from "@/lib/ads/cache";

export type InsightsSource =
  | "fresh"
  | "cache-fresh"
  | "cache-stale"
  | "rate-limited";

interface UseInsightsReturn {
  insights: UnifiedInsight[];
  loading: boolean;
  error: string | null;
  cached: boolean;
  noConnection: boolean;
  source: InsightsSource | null;
  fetchedAt: Date | null;
  revalidating: boolean;
  rateLimited: boolean;
  refresh: () => Promise<void>;
}

export interface UseInsightsOptions {
  range?: DateRange;
  customRange?: CustomDateRange; // takes precedence over `range` if provided
  level?: "account" | "campaign";
  provider?: AdProvider;
  timeIncrement?: TimeIncrement;
}

/**
 * Convert a DateRangePicker `DateRangeValue` to the slice of UseInsightsOptions
 * that controls the date range. Spread the result into useInsights options.
 */
export function dateRangeValueToOptions(
  value: DateRangeValue
): Pick<UseInsightsOptions, "range" | "customRange"> {
  if (value.type === "preset") {
    return { range: value.preset };
  }
  return {
    customRange: { since: value.since, until: value.until },
  };
}

export function useInsights(
  options: UseInsightsOptions = {}
): UseInsightsReturn {
  const {
    range = "30d",
    customRange,
    level = "account",
    provider = "meta",
    timeIncrement,
  } = options;

  const [insights, setInsights] = useState<UnifiedInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [noConnection, setNoConnection] = useState(false);
  const [source, setSource] = useState<InsightsSource | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);

  const customSince = customRange?.since;
  const customUntil = customRange?.until;

  const buildParams = useCallback(
    (forceRefresh: boolean): URLSearchParams => {
      const params = new URLSearchParams({ provider, level });

      let effectiveSince = customSince;
      let effectiveUntil = customUntil;

      if ((!effectiveSince || !effectiveUntil) && range !== "lifetime") {
        const converted = presetToCustomRange(range);
        effectiveSince = converted.since;
        effectiveUntil = converted.until;
      }

      if (effectiveSince && effectiveUntil) {
        params.set("since", effectiveSince);
        params.set("until", effectiveUntil);
      } else {
        params.set("range", range);
      }

      if (timeIncrement) {
        params.set("time_increment", String(timeIncrement));
      }

      if (forceRefresh) {
        params.set("refresh", "true");
      }

      return params;
    },
    [provider, level, customSince, customUntil, range, timeIncrement]
  );

  const reqTokenRef = useRef(0);

  const doFetch = useCallback(
    async (forceRefresh: boolean): Promise<void> => {
      const token = ++reqTokenRef.current;
      setLoading(true);
      setError(null);
      setNoConnection(false);

      try {
        const response = await fetch(
          `/api/ads/insights?${buildParams(forceRefresh).toString()}`
        );
        const data = await response.json();

        if (token !== reqTokenRef.current) return;

        if (response.status === 429) {
          setRateLimited(true);
          setError(data.error ?? "rate_limited");
          setInsights([]);
          setSource(null);
          setFetchedAt(null);
          setRevalidating(false);
          return;
        }

        if (!response.ok) {
          if (data.error === "no_connection") {
            setNoConnection(true);
            setInsights([]);
            return;
          }
          throw new Error(data.error || "Failed to fetch insights");
        }

        setInsights(data.data || []);
        setCached(data.source?.startsWith("cache-") ?? false);
        setSource((data.source as InsightsSource) ?? null);
        setFetchedAt(data.fetchedAt ? new Date(data.fetchedAt) : null);
        setRevalidating(Boolean(data.revalidating));
        setRateLimited(data.source === "rate-limited");
      } catch (err) {
        if (token !== reqTokenRef.current) return;
        console.error("[useInsights] Error:", err);
        setError(err instanceof Error ? err.message : "fetch_failed");
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
    insights,
    loading,
    error,
    cached,
    noConnection,
    source,
    fetchedAt,
    revalidating,
    rateLimited,
    refresh,
  };
}
