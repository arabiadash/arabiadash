/**
 * M7.5 Keywords Conversion Metrics recon
 * Date: 2026-05-25
 *
 * READ-ONLY GAQL probes. Critical question: does keyword_view support
 * conversion metrics directly, OR does it need an ADR-011-style
 * two-query merge (like fetchPurchaseAdTotals / fetchPurchaseAssetGroupTotals)?
 *
 * Q1: Direct conversion metrics on keyword_view
 * Q2: Date-range sensitivity check (if Q1 returns 0s)
 * Q3: segments.conversion_action support (gates ADR-011 pattern)
 * Q4: Account-level conversion sanity (does imaa have any conversions?)
 * Q5: Cross-check pattern used by existing campaigns/insights code
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

async function run(label, q) {
  console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}`);
  console.log(q.trim());
  try {
    const rows = await customer.query(q);
    console.log(`\n✓ ${rows.length} rows`);
    return { ok: true, rows };
  } catch (e) {
    const msg = e?.errors
      ? e.errors.map((x) => `${x.message} [${JSON.stringify(x.error_code)}]`).join("; ")
      : e?.message;
    console.log(`\n✗ FAILED: ${msg}`);
    return { ok: false, error: msg };
  }
}

// ─── Q1 — Direct conversion metrics on keyword_view (the critical test) ───
const q1 = await run(
  "Q1 — Direct conversion metrics on keyword_view",
  `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.all_conversions,
      metrics.all_conversions_value
    FROM keyword_view
    WHERE ad_group_criterion.status = 'ENABLED'
      AND ad_group_criterion.negative = FALSE
      AND segments.date BETWEEN '2026-04-26' AND '2026-05-25'
    ORDER BY metrics.cost_micros DESC
    LIMIT 20
  `
);
if (q1.ok && q1.rows.length > 0) {
  console.log("\nTop 5 by cost — verify conversions populate per keyword:");
  let convMaxSeen = 0;
  let convValueMaxSeen = 0;
  for (const r of q1.rows.slice(0, 5)) {
    const cost = Number(r.metrics?.cost_micros ?? 0) / 1_000_000;
    const conv = Number(r.metrics?.conversions ?? 0);
    const convVal = Number(r.metrics?.conversions_value ?? 0);
    const allConv = Number(r.metrics?.all_conversions ?? 0);
    const allConvVal = Number(r.metrics?.all_conversions_value ?? 0);
    convMaxSeen = Math.max(convMaxSeen, conv);
    convValueMaxSeen = Math.max(convValueMaxSeen, convVal);
    console.log(
      `  "${r.ad_group_criterion?.keyword?.text}"`
    );
    console.log(
      `    cost=${cost.toFixed(2)}  conversions=${conv}  conversions_value=${convVal}`
    );
    console.log(
      `    all_conversions=${allConv}  all_conversions_value=${allConvVal}`
    );
  }
  console.log(
    `\nSignal across top 20: max conversions=${q1.rows.reduce((m, r) => Math.max(m, Number(r.metrics?.conversions ?? 0)), 0)}, max conversions_value=${q1.rows.reduce((m, r) => Math.max(m, Number(r.metrics?.conversions_value ?? 0)), 0)}`
  );
}

// ─── Q3 — segments.conversion_action support on keyword_view ───
// (run regardless of Q1 result — confirms whether ADR-011 pattern viable)
const q3 = await run(
  "Q3 — segments.conversion_action support on keyword_view",
  `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      segments.conversion_action,
      segments.conversion_action_category,
      metrics.conversions,
      metrics.conversions_value
    FROM keyword_view
    WHERE ad_group_criterion.status = 'ENABLED'
      AND segments.date BETWEEN '2026-04-26' AND '2026-05-25'
    LIMIT 20
  `
);
if (q3.ok && q3.rows.length > 0) {
  console.log("\nSample 3 rows (conversion_action segmentation):");
  for (const r of q3.rows.slice(0, 3)) {
    console.log(
      `  text="${r.ad_group_criterion?.keyword?.text}"  action=${r.segments?.conversion_action}  category=${r.segments?.conversion_action_category}  conv=${r.metrics?.conversions}  val=${r.metrics?.conversions_value}`
    );
  }
  const uniqueActions = new Set(
    q3.rows.map((r) => r.segments?.conversion_action).filter(Boolean)
  );
  console.log(`\nDistinct conversion actions seen: ${uniqueActions.size}`);
  for (const a of uniqueActions) {
    const tail = String(a).split("/").pop();
    console.log(`  ${tail}`);
  }
}

// ─── Q4 — Account-level sanity: does imaa have ANY conversions at all? ───
const q4 = await run(
  "Q4 — Account-level conversion sanity",
  `
    SELECT
      metrics.conversions,
      metrics.conversions_value,
      metrics.all_conversions,
      metrics.all_conversions_value
    FROM customer
    WHERE segments.date BETWEEN '2026-04-26' AND '2026-05-25'
  `
);
if (q4.ok && q4.rows.length > 0) {
  const r = q4.rows[0];
  console.log(
    `\nAccount-wide last 30d:  conversions=${r.metrics?.conversions}  conversions_value=${r.metrics?.conversions_value}  all_conversions=${r.metrics?.all_conversions}  all_conversions_value=${r.metrics?.all_conversions_value}`
  );
}

// ─── Q5 — Cross-check: what does the existing fetchCampaigns return? ───
// Mirrors the pattern used by Reports campaign-level KPIs (the 335K revenue
// number the user mentioned). Tests whether the SAME data path used for
// campaigns can be reused for keywords.
const q5 = await run(
  "Q5 — Campaign-level conversions (the existing data path)",
  `
    SELECT
      campaign.id,
      campaign.name,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE campaign.advertising_channel_type = 'SEARCH'
      AND segments.date BETWEEN '2026-04-26' AND '2026-05-25'
    ORDER BY metrics.cost_micros DESC
    LIMIT 5
  `
);
if (q5.ok && q5.rows.length > 0) {
  console.log("\nSearch campaigns top 5 by cost (compare conversions to Q1 totals):");
  for (const r of q5.rows) {
    const cost = Number(r.metrics?.cost_micros ?? 0) / 1_000_000;
    console.log(
      `  "${r.campaign?.name}"  cost=${cost.toFixed(2)}  conv=${r.metrics?.conversions}  conv_value=${r.metrics?.conversions_value}`
    );
  }
}

console.log(`\n${"=".repeat(70)}\nSUMMARY\n${"=".repeat(70)}`);
console.log(`Q1 keyword_view direct metrics: ${q1.ok ? q1.rows.length + " rows" : "FAILED"}`);
console.log(`Q3 segments.conversion_action:  ${q3.ok ? q3.rows.length + " rows" : "FAILED"}`);
console.log(`Q4 account-wide sanity:         ${q4.ok ? "OK" : "FAILED"}`);
console.log(`Q5 campaign-level baseline:     ${q5.ok ? q5.rows.length + " rows" : "FAILED"}`);
