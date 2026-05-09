import type { DateRangeValue } from "@/lib/ads/types";

/**
 * Compute the previous period (same length as current), shifted to end one day
 * before `range`'s start. Returns null for 'lifetime' (no comparison).
 *
 * Example (today = 2026-05-10):
 *   computePreviousPeriod({ type: 'preset', preset: '30d' })
 *     → { since: '2026-03-12', until: '2026-04-10' }
 */
export function computePreviousPeriod(
  range: DateRangeValue
): { since: string; until: string } | null {
  const formatISO = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  if (range.type === "preset") {
    if (range.preset === "lifetime") return null;
    const daysMap: Record<string, number> = {
      "7d": 7,
      "14d": 14,
      "30d": 30,
      "90d": 90,
    };
    const days = daysMap[range.preset];
    if (!days) return null;

    const today = new Date();
    const prevEnd = new Date(today);
    prevEnd.setDate(today.getDate() - days);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevEnd.getDate() - (days - 1));

    return { since: formatISO(prevStart), until: formatISO(prevEnd) };
  }

  // Custom range: previous window of identical length, ending one day before `since`.
  const sinceDate = new Date(range.since);
  const untilDate = new Date(range.until);
  const days =
    Math.ceil(
      (untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

  const prevEnd = new Date(sinceDate);
  prevEnd.setDate(sinceDate.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - (days - 1));

  return { since: formatISO(prevStart), until: formatISO(prevEnd) };
}

/**
 * Compute percentage change from `previous` to `current`.
 * Returns isFinite=false when previous is 0 (can't compute %).
 */
export function computeDelta(
  current: number,
  previous: number
): { value: number; isFinite: boolean } {
  if (previous === 0) {
    return { value: 0, isFinite: false };
  }
  return { value: ((current - previous) / previous) * 100, isFinite: true };
}
