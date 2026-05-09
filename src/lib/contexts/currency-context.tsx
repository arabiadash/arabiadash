"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Currency } from "@/lib/currency";

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (currency: Currency) => Promise<void>;
  loading: boolean;
  derivedFromMeta: boolean;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("USD");
  const [loading, setLoading] = useState(true);
  const [derivedFromMeta, setDerivedFromMeta] = useState(true);

  useEffect(() => {
    fetch("/api/user/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.preferred_currency) {
          setCurrencyState(data.preferred_currency);
          setDerivedFromMeta(data.derived_from_meta || false);
        }
      })
      .catch((err) => console.error("[CurrencyProvider] Load failed:", err))
      .finally(() => setLoading(false));
  }, []);

  const setCurrency = useCallback(async (newCurrency: Currency) => {
    setCurrencyState(newCurrency);
    setDerivedFromMeta(false);

    try {
      const response = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferred_currency: newCurrency }),
      });

      if (!response.ok) {
        throw new Error("Failed to save preference");
      }
    } catch (err) {
      console.error("[CurrencyProvider] Save failed:", err);
    }
  }, []);

  return (
    <CurrencyContext.Provider
      value={{ currency, setCurrency, loading, derivedFromMeta }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return ctx;
}
