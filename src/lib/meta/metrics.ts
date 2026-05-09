import type { MetaInsight } from "./api";

const PURCHASE_ACTION_TYPES = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
  "onsite_web_app_purchase",
  "web_in_store_purchase",
  "web_app_in_store_purchase",
] as const;

const ADD_TO_CART_ACTION_TYPES = [
  "add_to_cart",
  "omni_add_to_cart",
  "offsite_conversion.fb_pixel_add_to_cart",
  "onsite_web_add_to_cart",
] as const;

const INITIATE_CHECKOUT_ACTION_TYPES = [
  "initiate_checkout",
  "omni_initiated_checkout",
  "onsite_web_initiate_checkout",
] as const;

const LEAD_ACTION_TYPES = [
  "lead",
  "offsite_conversion.fb_pixel_lead",
] as const;

/**
 * Sum action values for given action types from an insight.
 * Returns the highest value (deduplicated by Meta) - we use the standard 'purchase' type if available,
 * else the first matching one.
 */
function sumActionsByTypes(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: readonly string[]
): number {
  if (!actions) return 0;

  // Strategy: use the "best" single action type to avoid double counting
  // Priority: 'purchase' > 'omni_purchase' > 'offsite_conversion.fb_pixel_purchase' > others
  for (const type of types) {
    const match = actions.find((a) => a.action_type === type);
    if (match) {
      return parseFloat(match.value) || 0;
    }
  }
  return 0;
}

export function getPurchaseCount(insight: MetaInsight): number {
  return sumActionsByTypes(insight.actions, PURCHASE_ACTION_TYPES);
}

export function getRevenue(insight: MetaInsight): number {
  return sumActionsByTypes(insight.action_values, PURCHASE_ACTION_TYPES);
}

export function getAddToCartCount(insight: MetaInsight): number {
  return sumActionsByTypes(insight.actions, ADD_TO_CART_ACTION_TYPES);
}

export function getInitiateCheckoutCount(insight: MetaInsight): number {
  return sumActionsByTypes(insight.actions, INITIATE_CHECKOUT_ACTION_TYPES);
}

export function getLeadCount(insight: MetaInsight): number {
  return sumActionsByTypes(insight.actions, LEAD_ACTION_TYPES);
}

export function getSpend(insight: MetaInsight): number {
  return parseFloat(insight.spend) || 0;
}

export function getImpressions(insight: MetaInsight): number {
  return parseInt(insight.impressions) || 0;
}

export function getClicks(insight: MetaInsight): number {
  return parseInt(insight.clicks) || 0;
}

export function getCTR(insight: MetaInsight): number {
  return parseFloat(insight.ctr) || 0;
}

export function getCPC(insight: MetaInsight): number {
  return parseFloat(insight.cpc) || 0;
}

export function getCPM(insight: MetaInsight): number {
  return parseFloat(insight.cpm) || 0;
}

export function getReach(insight: MetaInsight): number {
  return parseInt(insight.reach || "0") || 0;
}

export function getFrequency(insight: MetaInsight): number {
  return parseFloat(insight.frequency || "0") || 0;
}

/**
 * Calculate ROAS: Revenue / Spend
 * Returns 0 if spend is 0 (avoid division by zero)
 */
export function getROAS(insight: MetaInsight): number {
  const spend = getSpend(insight);
  const revenue = getRevenue(insight);
  if (spend === 0) return 0;
  return revenue / spend;
}

/**
 * Cost per Purchase
 */
export function getCostPerPurchase(insight: MetaInsight): number {
  const spend = getSpend(insight);
  const purchases = getPurchaseCount(insight);
  if (purchases === 0) return 0;
  return spend / purchases;
}

/**
 * Aggregate multiple insights into one (sum spend/impressions/clicks/etc, recalculate ratios)
 */
export interface AggregatedMetrics {
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  reach: number;
  purchases: number;
  addToCart: number;
  initiateCheckout: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpm: number;
  roas: number;
  costPerPurchase: number;
  frequency: number;
}

export function aggregateInsights(insights: MetaInsight[]): AggregatedMetrics {
  const totals = insights.reduce(
    (acc, insight) => ({
      spend: acc.spend + getSpend(insight),
      revenue: acc.revenue + getRevenue(insight),
      impressions: acc.impressions + getImpressions(insight),
      clicks: acc.clicks + getClicks(insight),
      reach: acc.reach + getReach(insight),
      purchases: acc.purchases + getPurchaseCount(insight),
      addToCart: acc.addToCart + getAddToCartCount(insight),
      initiateCheckout:
        acc.initiateCheckout + getInitiateCheckoutCount(insight),
      leads: acc.leads + getLeadCount(insight),
    }),
    {
      spend: 0,
      revenue: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      purchases: 0,
      addToCart: 0,
      initiateCheckout: 0,
      leads: 0,
    }
  );

  const ctr =
    totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const cpm =
    totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
  const costPerPurchase =
    totals.purchases > 0 ? totals.spend / totals.purchases : 0;
  const frequency =
    totals.reach > 0 ? totals.impressions / totals.reach : 0;

  return {
    ...totals,
    ctr,
    cpc,
    cpm,
    roas,
    costPerPurchase,
    frequency,
  };
}
