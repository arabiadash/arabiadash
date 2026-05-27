"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  presetToCustomRange,
  type UnifiedAdSearchTerm,
  type DateRange,
  type CustomDateRange,
} from "@/lib/ads/types";

/**
 * ADR-019 (M9.1) — useSearchTerms hook.
 *
 * Lazy-fetches per-ad_group search terms on modal open. Replaces the
 * pre-M9.1 `ad.searchTerms` eager-payload reference.
 *
 * AbortController plumbing per ADR-019 §6 unmount-race gate: the in-
 * flight fetch is cancelled when the hook unmounts (modal closes
 * mid-fetch). Prevents "setState on unmounted component" warnings AND
 * stops zombie network requests that would otherwise complete + race
 * with the next modal open.
 *
 * Mirrors the useProviderAds shape — same loading/error/refresh
 * surface so the modal UI plumbs identically for both search terms
 * + keywords.
 */

export interface UseSearchTermsOptions {
  accountId: string;
  adGroupId: string;
  range?: DateRange;
  /** Takes precedence over `range` if provided. */
  customRange?: CustomDateRange;
  /**
   * Gate the fetch behind modal-open state. Defaults true. When
   * false, the hook returns the empty-initial state and fires no
   * request — useful for conditionally mounting the modal without
   * triggering work.
   */
  enabled?: boolean;
}

export interface UseSearchTermsReturn {
  searchTerms: UnifiedAdSearchTerm[];
  loading: boolean;
  /** "fetch_failed" / "reauth_required" / null. */
  error: string | null;
  /** Refetch with ?refresh=true. */
  refresh: () => Promise<void>;
}

export function useSearchTerms(
  options: UseSearchTermsOptions
): UseSearchTermsReturn {
  const {
    accountId,
    adGroupId,
    range = "30d",
    customRange,
    enabled = true,
  } = options;

  const [searchTerms, setSearchTerms] = useState<UnifiedAdSearchTerm[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Request-token guard — same pattern as useProviderAds. Increments
  // on every doFetch; only the latest token's resolution writes state.
  const reqTokenRef = useRef(0);
  // AbortController for in-flight request cancellation on unmount or
  // before a refresh. ADR-019 §6 BLOCKING requirement.
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
      return `/api/ads/search-terms?${params.toString()}`;
    },
    [accountId, adGroupId, customSince, customUntil, range]
  );

  const doFetch = useCallback(
    async (forceRefresh: boolean): Promise<void> => {
      if (!enabled || !accountId || !adGroupId) return;

      // Cancel any in-flight request before starting a new one.
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
                `[useSearchTerms] HTTP ${res.status}:`,
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
          setSearchTerms(data.data);
        } else {
          setSearchTerms([]);
        }
      } catch (err) {
        if (token !== reqTokenRef.current) return;
        // AbortError is the expected outcome of unmount-or-refresh
        // cancellation — do NOT surface it as a UI error.
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.error("[useSearchTerms] Unexpected:", err);
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
    // Cleanup: abort any in-flight request when the hook unmounts
    // (modal closes) OR when deps change (triggering a new doFetch).
    return () => {
      abortRef.current?.abort();
    };
  }, [doFetch, enabled]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  return {
    searchTerms,
    loading,
    error,
    refresh,
  };
}
