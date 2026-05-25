/**
 * M7 pre-push probe — exercises the EXACT GAQL shape fetchKeywords
 * issues in production. Mirrors the M8 _verify-m8-fetchimages-shape.mjs
 * pattern: empirically prove the SELECT works against imaa before
 * shipping the cache-v9 bump.
 *
 * Tests:
 * - keyword_view FROM clause accepts our SELECT
 * - metrics return per-keyword (not aggregated)
 * - All 4 quality_info subfields are SELECTable in a single query
 * - match_type integer mapping resolves to EXACT/PHRASE/BROAD
 * - Sample real data from imaa Search campaigns
 *
 * Run + delete pattern. Not committed.
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
  .select("account_id, access_token, metadata")
  .eq("platform", "google")
  .eq("status", "active")
  .limit(1)
  .maybeSingle();

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

// EXACT query shape from src/lib/google-ads/keywords.ts fetchKeywords
// (statusFilter='enabled' default), scoped to a date range matching prod.
const dateFrom = "2026-04-26";
const dateTo = "2026-05-25";

const query = `
  SELECT
    ad_group.id,
    ad_group_criterion.criterion_id,
    ad_group_criterion.keyword.text,
    ad_group_criterion.keyword.match_type,
    ad_group_criterion.status,
    ad_group_criterion.quality_info.quality_score,
    ad_group_criterion.quality_info.creative_quality_score,
    ad_group_criterion.quality_info.post_click_quality_score,
    ad_group_criterion.quality_info.search_predicted_ctr,
    metrics.impressions,
    metrics.clicks,
    metrics.cost_micros,
    metrics.ctr,
    metrics.average_cpc
  FROM keyword_view
  WHERE ad_group_criterion.status = 'ENABLED'
    AND ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.negative = FALSE
    AND campaign.advertising_channel_type = 'SEARCH'
    AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
  LIMIT 10
`;

console.log("Probing exact fetchKeywords SELECT shape against imaa...");
console.log(query.trim());

try {
  const rows = await customer.query(query);
  console.log(`\n✓ Query accepted. ${rows.length} rows returned.`);
  if (rows.length === 0) {
    console.error("\n⚠ ZERO rows — unexpected for imaa (recon Q3b returned 30). Investigate.");
    process.exit(2);
  }
  console.log("\nSample row (validates entire shape end-to-end):");
  console.log(JSON.stringify(rows[0], null, 2));

  // Validate the fields we depend on populate
  const r0 = rows[0];
  const checks = {
    "ad_group.id present": r0.ad_group?.id !== undefined,
    "criterion_id present": r0.ad_group_criterion?.criterion_id !== undefined,
    "keyword.text non-empty": typeof r0.ad_group_criterion?.keyword?.text === "string" && r0.ad_group_criterion.keyword.text.length > 0,
    "match_type integer in {2,3,4}": [2, 3, 4].includes(r0.ad_group_criterion?.keyword?.match_type),
    "status integer in {2,3}": [2, 3].includes(r0.ad_group_criterion?.status),
    "metrics.impressions numeric": typeof r0.metrics?.impressions === "number" || typeof r0.metrics?.impressions === "string",
    "metrics.cost_micros numeric": typeof r0.metrics?.cost_micros === "number" || typeof r0.metrics?.cost_micros === "string",
  };
  console.log("\nField checks:");
  let allPass = true;
  for (const [name, pass] of Object.entries(checks)) {
    console.log(`  ${pass ? "✓" : "✗"} ${name}`);
    if (!pass) allPass = false;
  }

  if (!allPass) {
    console.error("\n→ FIELD CHECK FAILURES — DO NOT PUSH. Investigate.");
    process.exit(3);
  }

  console.log("\n→ SAFE TO PUSH. fetchKeywords SELECT shape is queryable in v23 + field types match expectations.");
} catch (e) {
  const msg = e?.errors
    ? e.errors.map((x) => `${x.message} [${JSON.stringify(x.error_code)}]`).join("; ")
    : e?.message;
  console.error(`\n✗ QUERY FAILED: ${msg}`);
  console.error("\n→ DO NOT PUSH. Investigate the GAQL shape.");
  process.exit(1);
}
