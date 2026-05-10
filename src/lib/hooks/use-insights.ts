"use client";

import { useState, useEffect } from "react";
import {
  presetToCustomRange,
  type UnifiedInsight,
  type DateRange,
  type CustomDateRange,
  type DateRangeValue,
  type TimeIncrement,
} from "@/lib/ads/types";
import type { AdProvider } from "@/lib/ads/cache";

interface UseInsightsReturn {
  insights: UnifiedInsight[];
  loading: boolean;
  error: string | null;
  cached: boolean;
  noConnection: boolean;
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
 *
 * Example:
 *   const [picked, setPicked] = useState<DateRangeValue>({ type: 'preset', preset: '30d' });
 *   const insights = useInsights({ ...dateRangeValueToOptions(picked), level: 'account' });
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

  // Stable primitives for dep array (avoid re-fetch when caller passes a new
  // customRange object reference with the same values).
  const customSince = customRange?.since;
  const customUntil = customRange?.until;

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setNoConnection(false);

    const params = new URLSearchParams({ provider, level });

    // Resolve effective dates. Order:
    //   1. explicit customRange from caller → use as-is
    //   2. preset (except 'lifetime') → convert to since/until ending today
    //   3. 'lifetime' preset → pass through to backend (uses Meta's `maximum`)
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

    fetch(`/api/ads/insights?${params.toString()}`)
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          if (data.error === "no_connection") {
            if (!cancelled) {
              setNoConnection(true);
              setInsights([]);
            }
            return;
          }
          throw new Error(data.error || "Failed to fetch insights");
        }

        if (!cancelled) {
          setInsights(data.data || []);
          setCached(data.cached || false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[useInsights] Error:", err);
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [range, customSince, customUntil, level, provider, timeIncrement]);

  return { insights, loading, error, cached, noConnection };
}
