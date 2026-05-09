/**
 * Currency conversion using hardcoded peg rate.
 * 1 USD = 3.75 SAR (Saudi Riyal pegged to USD since 1986)
 *
 * For future variable currencies, integrate ExchangeRate-API.
 */

export const SUPPORTED_CURRENCIES = ["USD", "SAR"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const USD_TO_SAR_RATE = 3.75;
export const SAR_TO_USD_RATE = 1 / USD_TO_SAR_RATE;

export const CURRENCY_LABELS: Record<
  Currency,
  { symbol: string; name: string; nameAr: string }
> = {
  USD: { symbol: "$", name: "US Dollar", nameAr: "دولار أمريكي" },
  SAR: { symbol: "ر.س", name: "Saudi Riyal", nameAr: "ريال سعودي" },
};

/**
 * Convert amount from one currency to another.
 * Returns the same amount if from === to.
 */
export function convertCurrency(
  amount: number,
  from: Currency,
  to: Currency
): number {
  if (from === to) return amount;
  if (from === "USD" && to === "SAR") return amount * USD_TO_SAR_RATE;
  if (from === "SAR" && to === "USD") return amount * SAR_TO_USD_RATE;
  return amount;
}

/**
 * Format amount with proper currency symbol and locale.
 * Uses Arabic numerals for SAR display.
 *
 * Examples:
 *   formatCurrency(1234.56, 'USD') → "$1,234.56"
 *   formatCurrency(4630.20, 'SAR') → "4,630.20 ر.س"
 */
export function formatCurrency(
  amount: number,
  currency: Currency,
  options?: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    compact?: boolean;
  }
): string {
  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    compact = false,
  } = options || {};

  const safeAmount = Object.is(amount, -0) ? 0 : amount;

  if (compact) {
    return formatCompact(safeAmount, currency);
  }

  if (currency === "USD") {
    return `$${safeAmount.toLocaleString("en-US", {
      minimumFractionDigits,
      maximumFractionDigits,
    })}`;
  }

  return `${safeAmount.toLocaleString("en-US", {
    minimumFractionDigits,
    maximumFractionDigits,
  })} ر.س`;
}

/**
 * Format large numbers compactly: 1.5M, 234K, etc.
 */
function formatCompact(amount: number, currency: Currency): string {
  const symbol = currency === "USD" ? "$" : "";
  const suffix = currency === "SAR" ? " ر.س" : "";

  const absAmount = Math.abs(amount);
  let formatted: string;

  if (absAmount >= 1_000_000) {
    formatted = `${(amount / 1_000_000).toFixed(2)}M`;
  } else if (absAmount >= 1_000) {
    formatted = `${(amount / 1_000).toFixed(1)}K`;
  } else {
    formatted = amount.toFixed(2);
  }

  return `${symbol}${formatted}${suffix}`;
}

/**
 * Convert + Format in one step (convenience).
 *
 * Example:
 *   formatAndConvert(1000, 'USD', 'SAR') → "3,750.00 ر.س"
 */
export function formatAndConvert(
  amount: number,
  from: Currency,
  to: Currency,
  options?: Parameters<typeof formatCurrency>[2]
): string {
  const converted = convertCurrency(amount, from, to);
  return formatCurrency(converted, to, options);
}
