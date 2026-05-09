"use client";

import { useCurrency } from "@/lib/contexts/currency-context";
import { CURRENCY_LABELS, SUPPORTED_CURRENCIES } from "@/lib/currency";

export function CurrencyToggle() {
  const { currency, setCurrency, loading } = useCurrency();

  if (loading) {
    return (
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg animate-pulse">
        <div className="w-12 h-7 bg-gray-200 rounded"></div>
        <div className="w-12 h-7 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
      {SUPPORTED_CURRENCIES.map((c) => (
        <button
          key={c}
          onClick={() => setCurrency(c)}
          className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${
            currency === c
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
          aria-label={`Switch to ${CURRENCY_LABELS[c].nameAr}`}
        >
          {CURRENCY_LABELS[c].symbol}
        </button>
      ))}
    </div>
  );
}
