/**
 * Plan-based limits enforcement.
 *
 * Currently a single hard-coded constant — the full subscription
 * architecture (Personal/Pro/Agency) lives in Phase 10. Putting the
 * limit behind a function signature now means we change one place
 * later, not every call site.
 */

/** Max active ad-platform connections per user. */
export const ACTIVE_ACCOUNTS_LIMIT = 3;

/**
 * How many active accounts is this user allowed?
 *
 * Async on purpose: Phase 10 will read the user's plan from DB,
 * we want the signature stable so call sites don't need to change.
 */
export async function getUserAccountsLimit(
  _userId: string
): Promise<number> {
  return ACTIVE_ACCOUNTS_LIMIT;
}

/**
 * Standard error shape for limit-reached scenarios.
 */
export interface AccountLimitError {
  error: "limit_reached";
  message: string;
  current: number;
  limit: number;
}

export function buildLimitError(
  current: number,
  limit: number
): AccountLimitError {
  return {
    error: "limit_reached",
    message: `تم الوصول للحد الأقصى من الحسابات المفعّلة (${current}/${limit}). قم بإلغاء تفعيل حساب آخر قبل تفعيل هذا.`,
    current,
    limit,
  };
}
