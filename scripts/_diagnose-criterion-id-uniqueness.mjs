/**
 * Check if criterion_id is unique account-wide or just per-ad_group.
 * If per-ad_group, fetchPurchaseKeywordTotals's Map keyed by criterion_id
 * alone collides across ad_groups → wrong purchases attributed to keywords
 * with shared criterion_id values.
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

const dateFrom = "2025-11-26";
const dateTo = "2026-05-25";

// Get ALL ENABLED keywords across all Search campaigns
const query = `
  SELECT
    ad_group.id,
    ad_group.name,
    ad_group_criterion.criterion_id,
    ad_group_criterion.keyword.text
  FROM keyword_view
  WHERE ad_group_criterion.status = 'ENABLED'
    AND ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.negative = FALSE
    AND campaign.advertising_channel_type = 'SEARCH'
    AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
`;
const rows = await customer.query(query);
console.log(`Total rows: ${rows.length}`);

// Bucket by criterion_id — show all ad_groups it appears in
const byCriterion = new Map();
for (const r of rows) {
  const cid = String(r.ad_group_criterion?.criterion_id ?? "?");
  const ag = String(r.ad_group?.id ?? "?");
  const text = String(r.ad_group_criterion?.keyword?.text ?? "?");
  const e = byCriterion.get(cid) ?? new Set();
  e.add(`${ag}|${text}`);
  byCriterion.set(cid, e);
}

let collisions = 0;
const collisionExamples = [];
for (const [cid, set] of byCriterion) {
  if (set.size > 1) {
    collisions++;
    if (collisionExamples.length < 5) {
      collisionExamples.push({ cid, instances: [...set] });
    }
  }
}

console.log(`\nUnique criterion_ids: ${byCriterion.size}`);
console.log(`criterion_ids appearing in MULTIPLE ad_group+text combinations: ${collisions}`);

if (collisions > 0) {
  console.log("\n🎯 COLLISION FOUND. Sample:");
  for (const c of collisionExamples) {
    console.log(`  criterion_id=${c.cid} appears as:`);
    for (const inst of c.instances) {
      const [ag, text] = inst.split("|");
      console.log(`    ad_group ${ag} :: text="${text}"`);
    }
  }
  console.log("\n→ ROOT CAUSE: criterion_id is NOT unique account-wide.");
  console.log("  fetchPurchaseKeywordTotals's Map<criterion_id, ...> collides across ad_groups.");
  console.log("  Each keyword sharing a criterion_id receives SUM of all ad_groups' purchases.");
  console.log("  FIX: key the purchase Map by composite (ad_group_id + criterion_id).");
} else {
  console.log("\n✓ All criterion_ids unique — collision is NOT the cause. Look elsewhere.");
}
