/**
 * Plan-based limits enforcement.
 *
 * Currently a single hard-coded constant — the full subscription
 * architecture (Personal/Pro/Agency) lives in Phase 10. Putting the
 * limit behind a function signature now means we change one place
 * later, not every call site.
 */

/**
 * Max workspaces per user. Unlimited today; Phase 10 will swap this for a
 * per-plan resolver once subscription tiers ship.
 */
// TODO(phase-10): Replace with getWorkspaceLimitForUser(userId)
// when subscription tiers are wired in.
export const WORKSPACE_LIMIT = Infinity;

/**
 * Returns max active accounts per platform for a given user.
 *
 * Architectural principle: NO hardcoded account limits in core
 * code. Limits come from the pricing/packaging layer.
 *
 * Phase 10 (Billing) will read this from the user's subscription
 * tier in DB. Async on purpose so the signature stays stable when
 * the DB read lands — call sites won't need to change.
 */
export async function getUserAccountsLimit(
  _userId: string
): Promise<number> {
  // TODO: Phase 10 — fetch from subscription tier
  // SELECT plan_tier FROM subscriptions WHERE user_id = $1
  // Map tier → limit (e.g., Free: 2, Pro: 10, Enterprise: unlimited)
  return 3; // current trial default
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
