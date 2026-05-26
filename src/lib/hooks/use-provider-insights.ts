"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  presetToCustomRange,
  type UnifiedInsight,
  type DateRange,
  type CustomDateRange,
  type TimeIncrement,
} from "@/lib/ads/types";
import type { AdProvider } from "@/lib/ads/cache";

export interface UseProviderInsightsOptions {
  /**
   * Ad provider to query. Determines which adapter the server picks via
   * getAdapterForProvider, and which `?provider=` value is sent.
   */
  provider: AdProvider;
  /**
   * Workspace-scoped account IDs for the provider. The hook fires one
   * `/api/ads/insights` request per account in parallel and concatenates
   * the results. NO upper limit — pricing-tier caps live in plans.ts.
   *
   * Empty array → hook returns a synthetic "no connection" state without
   * firing any requests (mirrors the Phase 4.2/4.3 skip pattern).
   */
  accountIds: string[];
  range?: DateRange;
  /** Takes precedence over `range` if provided. */
  customRange?: CustomDateRange;
  level?: "account" | "campaign";
  timeIncrement?: TimeIncrement;
}

export interface UseProviderInsightsReturn {
  /** Concatenated insights across all accountIds. NO aggregation. */
  insights: UnifiedInsight[];
  /** True until every account's fetch resolves (success or failure). */
  loading: boolean;
  /**
   * "fetch_failed" if all accounts failed; "partial_failure" if some
   * succeeded; null otherwise. Server-side per-account errors are
   * logged via console.warn so partial degradation stays visible.
   */
  error: string | null;
  /** True when accountIds is empty — no provider connections in workspace. */
  noConnection: boolean;
  /** Re-fetch all accounts in parallel with ?refresh=true. */
  refresh: () => Promise<void>;
}

/**
 * Multi-account variant of useInsights. Used by the dashboard to pull
 * Google data (typically 3+ accounts per workspace) and aggregate it
 * client-side without violating React's hooks rules.
 *
 * Pattern matches Phase 4.3's useAds:
 *   - Single useEffect (no hooks-in-loop)
 *   - Skip check inside doFetch AND in useEffect (Phase 4.3 retrofit
 *     lesson: refresh() bypasses useEffect-only guards)
 *   - Stable serialization of accountIds in deps to avoid re-fetch
 *     churn when the parent recreates the array each render
 *   - Partial-failure tolerance: one bad account doesn't blank the rest
 *
 * No currency conversion happens here. Each insight row carries its
 * source currency from the adapter (Phase 4.7 commit C0); callers
 * convert during aggregation.
 */
export function useProviderInsights(
  options: UseProviderInsightsOptions
): UseProviderInsightsReturn {
  const {
    provider,
    accountIds,
    range = "30d",
    customRange,
    level = "account",
    timeIncrement,
  } = options;

  const [insights, setInsights] = useState<UnifiedInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable serialization of accountIds: dedupe + sort + join. Prevents
  // useEffect re-firing when the parent recreates the array with the
  // same logical contents (e.g. after a re-render where connections is
  // a new useMemo result with identical entries).
  const stableIds = Array.from(new Set(accountIds)).sort().join(",");
  const customSince = customRange?.since;
  const customUntil = customRange?.until;

  const reqTokenRef = useRef(0);

  const buildUrl = useCallback(
    (accountId: string, forceRefresh: boolean): string => {
      const params = new URLSearchParams({
        provider,
        level,
        account_id: accountId,
      });

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

      return `/api/ads/insights?${params.toString()}`;
    },
    [provider, level, customSince, customUntil, range, timeIncrement]
  );

  const doFetch = useCallback(
    async (forceRefresh: boolean): Promise<void> => {
      // CRITICAL: skip check at TOP of doFetch (Phase 4.3 retrofit lesson).
      // refresh() calls doFetch directly without going through useEffect,
      // so the useEffect skip alone is insufficient.
      const ids = stableIds ? stableIds.split(",") : [];
      if (ids.length === 0) return;

      const token = ++reqTokenRef.current;
      setLoading(true);
      setError(null);

      try {
        // Promise.allSettled: one bad account doesn't blank the rest.
        const responses = await Promise.allSettled(
          ids.map((id) => fetch(buildUrl(id, forceRefresh)))
        );

        if (token !== reqTokenRef.current) return;

        const allInsights: UnifiedInsight[] = [];
        let hadFailure = false;

        // Iterate with index so we can stamp each response's source
        // accountId onto its rows — the merge here loses request→row
        // provenance otherwise, and downstream per-account breakdowns
        // (Phase 4.8 M1 Google accounts table) need it. The Phase 4.7 D2
        // "data self-describes" principle extended to provenance.
        for (let idx = 0; idx < responses.length; idx++) {
          const result = responses[idx];
          const sourceAccountId = ids[idx];

          if (result.status === "rejected") {
            hadFailure = true;
            console.warn(
              "[useProviderInsights] fetch rejected:",
              result.reason
            );
            continue;
          }

          const response = result.value;
          if (!response.ok) {
            hadFailure = true;
            try {
              const errData = await response.json();
              // ADR-017: surface reauth_required for the Arabic CTA banner.
              if (
                response.status === 401 &&
                errData?.error === "reauth_required"
              ) {
                setError("reauth_required");
                if (token === reqTokenRef.current) setLoading(false);
                return;
              }
              console.warn(
                `[useProviderInsights] HTTP ${response.status}:`,
                errData?.error
              );
            } catch {
              console.warn(`[useProviderInsights] HTTP ${response.status}`);
            }
            continue;
          }

          try {
            const data = await response.json();
            if (Array.isArray(data.data)) {
              allInsights.push(
                ...data.data.map((row: UnifiedInsight) => ({
                  ...row,
                  accountId: sourceAccountId,
                }))
              );
            }
          } catch (parseErr) {
            hadFailure = true;
            console.warn(
              "[useProviderInsights] response parse failed:",
              parseErr
            );
          }
        }

        if (token !== reqTokenRef.current) return;

        setInsights(allInsights);
        if (hadFailure && allInsights.length === 0) {
          setError("fetch_failed");
        } else if (hadFailure) {
          setError("partial_failure");
        } else {
          setError(null);
        }
      } catch (err) {
        if (token !== reqTokenRef.current) return;
        console.error("[useProviderInsights] Unexpected error:", err);
        setError(err instanceof Error ? err.message : "fetch_failed");
      } finally {
        if (token === reqTokenRef.current) setLoading(false);
      }
    },
    [stableIds, buildUrl]
  );

  useEffect(() => {
    // Belt-and-suspenders skip — doFetch checks too, but bailing here
    // saves the function-call overhead on every empty-ids render.
    if (!stableIds) return;
    // react-hooks/set-state-in-effect: the lint rule flags doFetch
    // because doFetch internally calls setLoading/setInsights. This is
    // the established useInsights/useAds pattern (request-token guards
    // already prevent cascading renders); intentionally consistent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void doFetch(false);
  }, [doFetch, stableIds]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  // Synthetic "no connection" return when the workspace has zero
  // accounts for this provider. Avoids firing any requests; mirrors
  // the noConnection: true shape used by useInsights's skip path.
  if (accountIds.length === 0) {
    return {
      insights: [],
      loading: false,
      error: null,
      noConnection: true,
      refresh: async () => {},
    };
  }

  return {
    insights,
    loading,
    error,
    noConnection: false,
    refresh,
  };
}
