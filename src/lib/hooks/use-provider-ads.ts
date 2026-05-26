"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  presetToCustomRange,
  type UnifiedAd,
  type DateRange,
  type CustomDateRange,
} from "@/lib/ads/types";
import type { AdProvider } from "@/lib/ads/cache";

export interface UseProviderAdsOptions {
  /**
   * Ad provider to query. Determines which adapter the server picks via
   * getAdapterForProvider, and which `?provider=` value is sent.
   */
  provider: AdProvider;
  /**
   * Workspace-scoped account IDs for the provider. The hook fires one
   * `/api/ads/creatives` request per account in parallel and concatenates
   * the results. NO upper limit — pricing-tier caps live in plans.ts.
   *
   * Empty array → hook returns a synthetic "no connection" state without
   * firing any requests (mirrors useProviderInsights skip pattern).
   */
  accountIds: string[];
  range?: DateRange;
  /** Takes precedence over `range` if provided. */
  customRange?: CustomDateRange;
}

export interface UseProviderAdsReturn {
  /** Concatenated ads across all accountIds. NO aggregation. */
  ads: UnifiedAd[];
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
 * Multi-account variant of useAds. Used by the Reports Google tab to pull
 * Google ads across N accounts and merge the results client-side without
 * violating React's hooks rules.
 *
 * Mirrors the useProviderInsights pattern (Phase 4.7):
 *   - Single useEffect (no hooks-in-loop)
 *   - Skip check inside doFetch AND in useEffect (refresh() bypasses
 *     useEffect-only guards — Phase 4.3 retrofit lesson)
 *   - Stable serialization of accountIds in deps to avoid re-fetch
 *     churn when the parent recreates the array each render
 *   - Partial-failure tolerance: one bad account doesn't blank the rest
 *
 * No currency conversion happens here. Each ad row carries its source
 * currency from the adapter (Phase 4.8 M5 Commit 1B); callers convert
 * during display.
 */
export function useProviderAds(
  options: UseProviderAdsOptions
): UseProviderAdsReturn {
  const { provider, accountIds, range = "30d", customRange } = options;

  const [ads, setAds] = useState<UnifiedAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable serialization of accountIds: dedupe + sort + join. Prevents
  // useEffect re-firing when the parent recreates the array with the
  // same logical contents.
  const stableIds = Array.from(new Set(accountIds)).sort().join(",");
  const customSince = customRange?.since;
  const customUntil = customRange?.until;

  const reqTokenRef = useRef(0);

  const buildUrl = useCallback(
    (accountId: string, forceRefresh: boolean): string => {
      const params = new URLSearchParams({
        provider,
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

      if (forceRefresh) {
        params.set("refresh", "true");
      }

      return `/api/ads/creatives?${params.toString()}`;
    },
    [provider, customSince, customUntil, range]
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

        const allAds: UnifiedAd[] = [];
        let hadFailure = false;

        // Iterate with index so we can stamp each response's source
        // accountId onto its rows — the merge loses request→row
        // provenance otherwise, and downstream per-account groupings
        // need it.
        for (let idx = 0; idx < responses.length; idx++) {
          const result = responses[idx];
          const sourceAccountId = ids[idx];

          if (result.status === "rejected") {
            hadFailure = true;
            console.warn(
              "[useProviderAds] fetch rejected:",
              result.reason
            );
            continue;
          }

          const response = result.value;
          if (!response.ok) {
            hadFailure = true;
            try {
              const errData = await response.json();
              // ADR-017: surface reauth_required so the UI can render the
              // Arabic reauth CTA. Setting error inside the loop is safe
              // because the final state write happens after the loop.
              if (
                response.status === 401 &&
                errData?.error === "reauth_required"
              ) {
                setError("reauth_required");
                if (token === reqTokenRef.current) setLoading(false);
                return;
              }
              console.warn(
                `[useProviderAds] HTTP ${response.status}:`,
                errData?.error
              );
            } catch {
              console.warn(`[useProviderAds] HTTP ${response.status}`);
            }
            continue;
          }

          try {
            const data = await response.json();
            if (Array.isArray(data.data)) {
              allAds.push(
                ...data.data.map((row: UnifiedAd) => ({
                  ...row,
                  accountId: sourceAccountId,
                }))
              );
            }
          } catch (parseErr) {
            hadFailure = true;
            console.warn(
              "[useProviderAds] response parse failed:",
              parseErr
            );
          }
        }

        if (token !== reqTokenRef.current) return;

        setAds(allAds);
        if (hadFailure && allAds.length === 0) {
          setError("fetch_failed");
        } else if (hadFailure) {
          setError("partial_failure");
        } else {
          setError(null);
        }
      } catch (err) {
        if (token !== reqTokenRef.current) return;
        console.error("[useProviderAds] Unexpected error:", err);
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
    // because doFetch internally calls setLoading/setAds. This is
    // the established useAds/useProviderInsights pattern (request-token
    // guards already prevent cascading renders); intentionally consistent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void doFetch(false);
  }, [doFetch, stableIds]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  // Synthetic "no connection" return when the workspace has zero
  // accounts for this provider. Avoids firing any requests; mirrors
  // useProviderInsights.
  if (accountIds.length === 0) {
    return {
      ads: [],
      loading: false,
      error: null,
      noConnection: true,
      refresh: async () => {},
    };
  }

  return {
    ads,
    loading,
    error,
    noConnection: false,
    refresh,
  };
}
