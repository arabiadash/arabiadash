"use client";

import { useState, useEffect } from "react";
import type { MetaInsight, DateRange } from "@/lib/meta/api";

interface UseInsightsReturn {
  insights: MetaInsight[];
  loading: boolean;
  error: string | null;
  cached: boolean;
  noConnection: boolean;
}

export function useInsights(
  range: DateRange = "30d",
  level: "account" | "campaign" = "account"
): UseInsightsReturn {
  const [insights, setInsights] = useState<MetaInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [noConnection, setNoConnection] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setNoConnection(false);

    fetch(`/api/meta/insights?range=${range}&level=${level}`)
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          if (data.error === "no_meta_connection") {
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
  }, [range, level]);

  return { insights, loading, error, cached, noConnection };
}
