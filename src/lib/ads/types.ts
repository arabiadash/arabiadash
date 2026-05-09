import type { AdProvider } from "./cache";

// =================================================================
// Unified Campaign (works for any ad platform)
// =================================================================
export interface UnifiedCampaign {
  id: string;
  provider: AdProvider;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  objective: string;

  // Budget (optional - some platforms don't expose it)
  dailyBudget?: number;
  lifetimeBudget?: number;

  // Dates
  startTime?: string;
  stopTime?: string;
  createdTime: string;
  updatedTime: string;
}

// =================================================================
// Unified Insight (works for any ad platform)
// =================================================================
export interface UnifiedInsight {
  // Identifiers
  campaignId?: string;
  campaignName?: string;
  provider: AdProvider;

  // Performance metrics (all numbers, not strings)
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;

  // Calculated rates
  ctr: number; // %
  cpc: number;
  cpm: number;

  // Conversion metrics
  purchases: number;
  revenue: number;
  roas: number; // calculated: revenue / spend

  // Funnel metrics (for advanced analysis)
  addToCart: number;
  initiateCheckout: number;
  leads: number;

  // Cost per
  costPerPurchase: number;
  costPerLead: number;

  // Date range
  dateStart: string;
  dateStop: string;
}

// =================================================================
// Unified Account Info
// =================================================================
export interface UnifiedAccount {
  id: string;
  provider: AdProvider;
  name: string;
  currency: string;
  timezone: string;
  status?: "active" | "inactive" | "unknown";
}

// =================================================================
// Date Range
// =================================================================
export type DateRange = "7d" | "14d" | "30d" | "90d" | "lifetime";

// Custom range with arbitrary start/end dates (ISO YYYY-MM-DD strings)
export interface CustomDateRange {
  since: string;
  until: string;
}

// Union of preset or custom range
export type DateRangeInput = DateRange | CustomDateRange;

// Type guard: true if input is a CustomDateRange object (not a preset string)
export function isCustomRange(
  range: DateRangeInput
): range is CustomDateRange {
  return (
    typeof range === "object" && "since" in range && "until" in range
  );
}

// Tagged union used by UI components (DateRangePicker) to describe the
// current selection. Distinct from DateRangeInput so UI state stays explicit.
export type DateRangeValue =
  | { type: "preset"; preset: DateRange }
  | { type: "custom"; since: string; until: string };

const ARABIC_DAY_NAMES = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

/**
 * Format a chart x-axis label: combines day name + short date for short ranges,
 * or date only for longer ranges (saves horizontal space).
 *
 * - daysCount ≤ 14 → "الأحد 27/4"
 * - daysCount > 14 → "27/4"
 */
export function formatChartDayLabel(
  dateStr: string,
  daysCount: number
): string {
  const date = new Date(dateStr);
  const dayShort = `${date.getDate()}/${date.getMonth() + 1}`;
  if (daysCount <= 14) {
    return `${ARABIC_DAY_NAMES[date.getDay()]} ${dayShort}`;
  }
  return dayShort;
}

/**
 * Format a chart tooltip label: always shows day name + short date.
 * Example: "الإثنين 23/4"
 */
export function formatChartTooltipLabel(dateStr: string): string {
  const date = new Date(dateStr);
  return `${ARABIC_DAY_NAMES[date.getDay()]} ${date.getDate()}/${
    date.getMonth() + 1
  }`;
}

/**
 * Convert a preset to actual since/until dates ending TODAY (inclusive).
 * Returns null for 'lifetime' (caller should fall back to Meta's preset).
 *
 * Example (today = 2026-05-09):
 *   presetToCustomRange('7d')  → { since: '2026-05-03', until: '2026-05-09' }
 *   presetToCustomRange('30d') → { since: '2026-04-10', until: '2026-05-09' }
 *
 * Why: Meta's `last_30d` preset excludes today's data. By computing explicit
 * dates ending today, we include today's (partial) data in the response.
 */
export function presetToCustomRange(
  preset: DateRange
): CustomDateRange | null {
  if (preset === "lifetime") return null;

  const daysMap: Record<Exclude<DateRange, "lifetime">, number> = {
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90,
  };
  const days = daysMap[preset];

  const today = new Date();
  const since = new Date(today);
  since.setDate(today.getDate() - (days - 1));

  const formatISO = (d: Date) => d.toISOString().split("T")[0];

  return {
    since: formatISO(since),
    until: formatISO(today),
  };
}

export type TimeIncrement = 1 | 7 | "all_days";

export type InsightLevel = "account" | "campaign" | "adset" | "ad";

// =================================================================
// Provider Adapter Interface
// =================================================================
export interface AdProviderAdapter {
  readonly provider: AdProvider;

  // Get all campaigns for the account
  getCampaigns(): Promise<UnifiedCampaign[]>;

  // Get insights aggregated at account level
  getAccountInsights(
    range: DateRangeInput,
    timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]>;

  // Get insights broken down by campaign
  getCampaignInsights(
    range: DateRangeInput,
    timeIncrement?: TimeIncrement
  ): Promise<UnifiedInsight[]>;

  // Get account information
  getAccount(): Promise<UnifiedAccount>;
}
