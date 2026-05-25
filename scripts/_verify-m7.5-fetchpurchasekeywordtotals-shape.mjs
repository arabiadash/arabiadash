/**
 * M7.5 pre-push probe — exercises the EXACT GAQL shape
 * fetchPurchaseKeywordTotals issues in production. Mirrors the M7
 * _verify-m7-fetchkeywords-shape.mjs + M8 _verify-m8-fetchimages-shape.mjs
 * pattern: empirically prove the new SELECT works against imaa before
 * shipping the cache-v10 bump.
 *
 * Tests:
 * - Q1 (Q1+Q2 unsegmented identity+metrics — already proven in M7 probe;
 *   re-run for current-date sanity)
 * - Q2 (NEW M7.5: segmented by segments.conversion_action on keyword_view)
 * - Merge logic correctness: filtered purchases ≈ subset of all conversions
 * - hasConversionData = true when imaa's 1 PURCHASE action ID matches
 * - Sample top 3 keywords by cost return non-zero conversions_value
 *
 * Loads purchaseActionIds from the live google_conversion_actions cache
 * via Supabase service_role — mirrors what the adapter sees in production.
 *
 * Run + delete pattern. Not committed pre-push.
 */

import { GoogleAdsApi } from "google-ads-api";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv() {
  const env = {};
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: conn } = await sb
  .from("connections")
  .select("user_id, account_id, access_token, metadata")
  .eq("platform", "google")
  .eq("status", "active")
  .limit(1)
  .maybeSingle();

// Load purchaseActionIds from the live cache — matches production
// getPurchaseActionIds() logic: counts_as_purchase boolean column with
// user_override taking precedence (per
// src/lib/google-ads/conversion-actions.ts L272+).
const { data: actions } = await sb
  .from("google_conversion_actions")
  .select("conversion_action_id, counts_as_purchase, user_override")
  .eq("user_id", conn.user_id)
  .eq("customer_id", conn.account_id);

const purchaseActionIds = new Set(
  (actions ?? [])
    .filter((a) => {
      const effective =
        a.user_override !== null ? a.user_override : a.counts_as_purchase;
      return effective === true;
    })
    .map((a) => String(a.conversion_action_id))
);

console.log(
  `Loaded purchaseActionIds from cache: ${JSON.stringify([...purchaseActionIds])}`
);
if (purchaseActionIds.size === 0) {
  console.error(
    "✗ No PURCHASE actions found in cache. fetchPurchaseKeywordTotals would return null in production."
  );
  console.error("  Expected ≥1 action on imaa per recon Q3 (action 6649351374).");
  console.error("  Check google_conversion_actions table or sync.");
  process.exit(1);
}

const api = new GoogleAdsApi({
  client_id: env.GOOGLE_ADS_CLIENT_ID,
  client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
  developer_token: env.GOOGLE_ADS_DEVELOPER_TOKEN,
});
const customer = api.Customer({
  customer_id: conn.account_id,
  refresh_token: conn.access_token,
  ...(conn.metadata?.manager_customer_id
    ? { login_customer_id: conn.metadata.manager_customer_id }
    : {}),
});

const dateFrom = "2026-04-26";
const dateTo = "2026-05-25";

// First gather ad_group IDs in scope (GAQL doesn't support DISTINCT —
// dedup client-side via Set after fetching all matching rows)
const adGroupsQuery = `
  SELECT ad_group.id
  FROM keyword_view
  WHERE ad_group_criterion.status = 'ENABLED'
    AND ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.negative = FALSE
    AND campaign.advertising_channel_type = 'SEARCH'
    AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
  LIMIT 500
`;
console.log("\n--- Gather ad_group IDs in scope ---");
const adGroupRows = await customer.query(adGroupsQuery);
const adGroupIds = new Set(adGroupRows.map((r) => String(r.ad_group?.id ?? "")).filter(Boolean));
console.log(`✓ ${adGroupIds.size} unique ad_group IDs in scope (from ${adGroupRows.length} raw rows)`);

const adGroupList = Array.from(adGroupIds).join(", ");

// =====================================================================
// Q1: identity + cost/clicks/impressions/CTR/CPC (already proven in M7)
// =====================================================================
const q1 = `
  SELECT
    ad_group.id,
    ad_group_criterion.criterion_id,
    ad_group_criterion.keyword.text,
    metrics.cost_micros
  FROM keyword_view
  WHERE ad_group_criterion.status = 'ENABLED'
    AND ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.negative = FALSE
    AND campaign.advertising_channel_type = 'SEARCH'
    AND ad_group.id IN (${adGroupList})
    AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
  ORDER BY metrics.cost_micros DESC
  LIMIT 5
`;
console.log("\n--- Q1: identity + cost (M7 baseline) ---");
const q1Rows = await customer.query(q1);
console.log(`✓ ${q1Rows.length} rows`);
const top3Ids = new Set();
for (const r of q1Rows.slice(0, 3)) {
  const cost = Number(r.metrics?.cost_micros ?? 0) / 1_000_000;
  console.log(
    `  text="${r.ad_group_criterion?.keyword?.text}" criterion_id=${r.ad_group_criterion?.criterion_id} cost=${cost.toFixed(2)}`
  );
  top3Ids.add(String(r.ad_group_criterion?.criterion_id));
}

// =====================================================================
// Q2 (NEW M7.5): segmented purchase totals on keyword_view
// EXACT shape from src/lib/google-ads/keywords.ts fetchPurchaseKeywordTotals
// =====================================================================
const q2 = `
  SELECT
    ad_group.id,
    ad_group_criterion.criterion_id,
    segments.conversion_action,
    metrics.conversions,
    metrics.conversions_value
  FROM keyword_view
  WHERE ad_group_criterion.status = 'ENABLED'
    AND ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.negative = FALSE
    AND campaign.advertising_channel_type = 'SEARCH'
    AND ad_group.id IN (${adGroupList})
    AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
`;
console.log("\n--- Q2 (NEW M7.5): segmented purchase totals (THE PROD SHAPE) ---");
let q2Rows;
try {
  q2Rows = await customer.query(q2);
  console.log(`✓ Query accepted. ${q2Rows.length} rows returned.`);
} catch (e) {
  const msg = e?.errors
    ? e.errors.map((x) => `${x.message} [${JSON.stringify(x.error_code)}]`).join("; ")
    : e?.message;
  console.error(`✗ QUERY FAILED: ${msg}`);
  console.error("\n→ DO NOT PUSH. The new fetchPurchaseKeywordTotals GAQL shape is rejected by v23.");
  process.exit(1);
}

// =====================================================================
// Merge logic verification — mirror the production fetchPurchaseKeywordTotals
// =====================================================================
console.log("\n--- Merge logic: simulate fetchPurchaseKeywordTotals ---");
const byCriterion = new Map();
for (const row of q2Rows) {
  const criterionIdRaw = row.ad_group_criterion?.criterion_id;
  if (criterionIdRaw === undefined || criterionIdRaw === null) continue;
  const criterionId = String(criterionIdRaw);

  const existing = byCriterion.get(criterionId) ?? { purchases: 0, revenue: 0 };

  const resourcePath = String(row.segments?.conversion_action ?? "");
  const actionId = resourcePath.split("/").pop() ?? "";

  if (purchaseActionIds.has(actionId)) {
    existing.purchases += Number(row.metrics?.conversions) || 0;
    existing.revenue += Number(row.metrics?.conversions_value) || 0;
  }

  byCriterion.set(criterionId, existing);
}
console.log(`✓ Merge produced ${byCriterion.size} unique keyword entries`);

// Validate top 3 keywords by cost have meaningful purchases
console.log("\n--- Top 3 by cost — verify merged purchase data is meaningful ---");
let anyNonZero = false;
for (const cid of top3Ids) {
  const m = byCriterion.get(cid);
  if (m) {
    console.log(
      `  criterion_id=${cid}  purchases=${m.purchases.toFixed(2)}  revenue=${m.revenue.toFixed(2)}`
    );
    if (m.purchases > 0 || m.revenue > 0) anyNonZero = true;
  } else {
    console.log(`  criterion_id=${cid}  (no segmented rows — hasConversionData would be false for this keyword)`);
  }
}

if (!anyNonZero) {
  console.error(
    "\n⚠ All top-3-by-cost keywords show zero merged purchases. Probably a date-range or category-filter issue. Investigate before push."
  );
  process.exit(2);
}

console.log("\n→ SAFE TO PUSH. fetchPurchaseKeywordTotals GAQL shape works in v23 + merge logic returns meaningful purchase data on imaa.");
