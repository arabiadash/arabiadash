import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Plan-tier limits enforcement.
 *
 * Industry-standard cross-platform pattern (Triple Whale, Northbeam):
 * limits apply to the TOTAL number of active ad accounts a user has
 * across all platforms (Meta + Google + future TikTok/Snap/Salla/Zid),
 * NOT per-platform. A trial user gets 3 ad accounts total, distributed
 * however they want.
 */

export type PlanTier = "trial" | "starter" | "growth" | "agency";

export interface PlanLimits {
  /** Active ad accounts across ALL platforms combined. */
  totalAccounts: number;
  workspaces: number;
  features: string[];
}

/**
 * Tier → limits. Sourced from research on competitor pricing:
 * - Triple Whale Starter: 3 accounts (~$149/mo)
 * - Northbeam: per-account pricing
 * - ArabiaDash trial matches Starter so new users get a real evaluation.
 *
 * Phase 10 (Billing) will introduce Stripe-backed tier lookup via
 * `getUserTier()` — currently stubbed to always return "trial" since no
 * subscriptions exist yet.
 *
 * `workspaces` for trial is intentionally Infinity (not the future-state
 * value of 1) to avoid retroactively limiting users who already have
 * multiple workspaces. Phase 10 will lower this when billing turns on.
 */
const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  trial: {
    totalAccounts: 3,
    workspaces: Infinity,
    features: [],
  },
  starter: {
    totalAccounts: 3,
    workspaces: 1,
    features: [],
  },
  growth: {
    totalAccounts: 10,
    workspaces: 2,
    features: ["smart_alerts"],
  },
  agency: {
    totalAccounts: Infinity,
    workspaces: Infinity,
    features: ["smart_alerts", "ai_recommendations"],
  },
};

/**
 * Resolve the user's current plan tier.
 *
 * Phase 10 (Billing) will replace this stub with a Stripe subscription
 * lookup. Until then everyone is on trial.
 */
export async function getUserTier(_userId: string): Promise<PlanTier> {
  // TODO Phase 10: read from user's Stripe subscription
  //   const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
  //   return mapStripeProductToTier(sub.items.data[0].price.product);
  return "trial";
}

export async function getUserPlanLimits(userId: string): Promise<PlanLimits> {
  const tier = await getUserTier(userId);
  return PLAN_LIMITS[tier];
}

/**
 * Count the user's currently-active connections across ALL platforms.
 * "Active" means status='active' — pending and inactive don't count
 * against the plan budget.
 */
export async function getTotalActiveAccounts(
  adminClient: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const { count, error } = await adminClient
    .from("connections")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) {
    console.error("[plans] getTotalActiveAccounts failed:", error);
    // Fail-safe: assume at limit so we don't over-provision on DB error.
    return Infinity;
  }

  return count ?? 0;
}

export interface AccountLimitCheck {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  tier: PlanTier;
}

/**
 * Centralized check: can the user add N more active accounts?
 * The selector UI uses this to drive its progress bar and upgrade prompt;
 * the /select-accounts endpoints use it to enforce the limit server-side.
 */
export async function canAddMoreAccounts(
  adminClient: SupabaseClient<Database>,
  userId: string,
  additionalCount: number = 1
): Promise<AccountLimitCheck> {
  const tier = await getUserTier(userId);
  const limits = PLAN_LIMITS[tier];
  const current = await getTotalActiveAccounts(adminClient, userId);
  const remaining =
    limits.totalAccounts === Infinity
      ? Infinity
      : Math.max(0, limits.totalAccounts - current);

  return {
    allowed: current + additionalCount <= limits.totalAccounts,
    current,
    limit: limits.totalAccounts,
    remaining,
    tier,
  };
}

// =====================================================================
// Backward-compat: deprecated exports for callers that haven't migrated
// to canAddMoreAccounts yet. C10 rebuilds the connections pages and
// removes these. Until then, keeping them avoids a massive C1 diff.
// =====================================================================

/** @deprecated Use getUserPlanLimits().workspaces */
export const WORKSPACE_LIMIT = PLAN_LIMITS.trial.workspaces;

/** @deprecated Use canAddMoreAccounts() — see PlanLimits service */
export const ACTIVE_ACCOUNTS_LIMIT = 3;

/** @deprecated Use canAddMoreAccounts() */
export async function getUserAccountsLimit(userId: string): Promise<number> {
  const tier = await getUserTier(userId);
  return PLAN_LIMITS[tier].totalAccounts;
}

/**
 * Standard error shape for limit-reached scenarios. Preserved for the
 * existing `/api/ads/connections/[id]` PATCH route which the frontend
 * parses for `message`/`current`/`limit`.
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
