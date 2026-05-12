"use client";

import { useState, useEffect } from "react";
import type { DateRangeValue } from "@/lib/ads/types";

const STORAGE_KEY = "arabiadash:dateRange";

const DEFAULT_VALUE: DateRangeValue = {
  type: "preset",
  preset: "7d",
};

function isValidDateRangeValue(v: unknown): v is DateRangeValue {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (obj.type === "preset") {
    return [
      "today",
      "yesterday",
      "7d",
      "14d",
      "this_month",
      "last_month",
      "30d",
      "90d",
      "lifetime",
    ].includes(obj.preset as string);
  }
  if (obj.type === "custom") {
    return typeof obj.since === "string" && typeof obj.until === "string";
  }
  return false;
}

/**
 * Persist DateRangeValue to localStorage with cross-tab sync.
 * - Reads on mount, writes on change, listens to `storage` events from other tabs.
 * - Falls back to DEFAULT_VALUE on parse errors or invalid stored shape.
 */
export function useDateRangeStorage(): [
  DateRangeValue,
  (value: DateRangeValue) => void,
] {
  // Always start with DEFAULT_VALUE on both server and client to prevent
  // hydration mismatch (React Error #418). Real value loaded after mount.
  const [value, setValue] = useState<DateRangeValue>(DEFAULT_VALUE);

  // Hydrate from localStorage after mount (client-only).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (isValidDateRangeValue(parsed)) {
        setValue(parsed);
      }
    } catch {
      // Ignore parse errors, keep DEFAULT_VALUE.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Storage full or disabled — silently ignore.
    }
  }, [value]);

  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (isValidDateRangeValue(parsed)) {
            setValue(parsed);
          }
        } catch {
          // Ignore invalid JSON from other tabs.
        }
      }
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return [value, setValue];
}
