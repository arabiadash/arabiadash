"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  presetToCustomRange,
  type UnifiedAdKeyword,
  type DateRange,
  type CustomDateRange,
} from "@/lib/ads/types";

/**
 * ADR-019 (M9.1) — useKeywords hook.
 *
 * Lazy-fetches per-ad_group keywords on modal open. Mirrors the
 * useSearchTerms shape + AbortController unmount-race protection.
 */

export interface UseKeywordsOptions {
  accountId: string;
  adGroupId: string;
  range?: DateRange;
  customRange?: CustomDateRange;
  enabled?: boolean;
}

export interface UseKeywordsReturn {
  keywords: UnifiedAdKeyword[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useKeywords(options: UseKeywordsOptions): UseKeywordsReturn {
  const {
    accountId,
    adGroupId,
    range = "30d",
    customRange,
    enabled = true,
  } = options;

  const [keywords, setKeywords] = useState<UnifiedAdKeyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const customSince = customRange?.since;
  const customUntil = customRange?.until;

  const buildUrl = useCallback(
    (forceRefresh: boolean): string => {
      const params = new URLSearchParams({
        account_id: accountId,
        ad_group_id: adGroupId,
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
      if (forceRefresh) params.set("refresh", "true");
      return `/api/ads/keywords?${params.toString()}`;
    },
    [accountId, adGroupId, customSince, customUntil, range]
  );

  const doFetch = useCallback(
    async (forceRefresh: boolean): Promise<void> => {
      if (!enabled || !accountId || !adGroupId) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const token = ++reqTokenRef.current;
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(buildUrl(forceRefresh), {
          signal: controller.signal,
        });
        if (token !== reqTokenRef.current) return;
        if (!res.ok) {
          try {
            const errData = await res.json();
            if (
              res.status === 401 &&
              errData?.error === "reauth_required"
            ) {
              setError("reauth_required");
            } else {
              console.warn(
                `[useKeywords] HTTP ${res.status}:`,
                errData?.error
              );
              setError("fetch_failed");
            }
          } catch {
            setError("fetch_failed");
          }
          return;
        }
        const data = await res.json();
        if (token !== reqTokenRef.current) return;
        if (Array.isArray(data.data)) {
          setKeywords(data.data);
        } else {
          setKeywords([]);
        }
      } catch (err) {
        if (token !== reqTokenRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.error("[useKeywords] Unexpected:", err);
        setError("fetch_failed");
      } finally {
        if (token === reqTokenRef.current) setLoading(false);
      }
    },
    [enabled, accountId, adGroupId, buildUrl]
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

  return {
    keywords,
    loading,
    error,
    refresh,
  };
}
