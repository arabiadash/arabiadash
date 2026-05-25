/**
 * Keywords recon — Phase 4.8 M7 Stage 1
 * Date: 2026-05-26
 *
 * READ-ONLY GAQL probes for the M7 keywords surface.
 *
 * Q1: keyword inventory on imaa Search campaigns
 * Q2: quality_info subfield availability (probe per-field for SDK traps)
 * Q3: per-keyword metrics — test ad_group_criterion vs keyword_view
 * Q4: negative keywords count
 * Q5: per-ad-group keyword distribution (sizing decision)
 * Q6: integer-drift check on KeywordMatchType + CriterionStatus suffixes
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

// ─── Q1 — inventory + match types + status ───
const q1 = await run(
  "Q1 — keyword inventory across Search campaigns",
  `
    SELECT
      campaign.id, campaign.name,
      ad_group.id, ad_group.name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.type,
      ad_group_criterion.status,
      ad_group_criterion.negative,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.resource_name
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
      AND campaign.advertising_channel_type = 'SEARCH'
      AND ad_group_criterion.negative = FALSE
    LIMIT 200
  `
);
if (q1.ok && q1.rows.length > 0) {
  const byCampaign = {};
  const byMatch = {};
  const byStatus = {};
  for (const r of q1.rows) {
    const c = r.campaign?.name ?? "?";
    const mt = r.ad_group_criterion?.keyword?.match_type ?? "?";
    const st = r.ad_group_criterion?.status ?? "?";
    byCampaign[c] = (byCampaign[c] ?? 0) + 1;
    byMatch[mt] = (byMatch[mt] ?? 0) + 1;
    byStatus[st] = (byStatus[st] ?? 0) + 1;
  }
  console.log("\nBy campaign:", byCampaign);
  console.log("By match_type (integer):", byMatch);
  console.log("By status (integer):", byStatus);
  console.log("\nSample 5 keywords:");
  for (const r of q1.rows.slice(0, 5)) {
    console.log(
      `  text="${r.ad_group_criterion?.keyword?.text}"  match_type=${r.ad_group_criterion?.keyword?.match_type}  status=${r.ad_group_criterion?.status}  resource_name="${r.ad_group_criterion?.resource_name}"`
    );
  }
}

// ─── Q2 — quality_info subfields, isolated per-field to catch SDK traps ───
console.log(`\n${"─".repeat(70)}\nQ2 — quality_info subfield availability (per-field isolation)\n${"─".repeat(70)}`);
const qualityFields = [
  "ad_group_criterion.quality_info.quality_score",
  "ad_group_criterion.quality_info.creative_quality_score",
  "ad_group_criterion.quality_info.post_click_quality_score",
  "ad_group_criterion.quality_info.search_predicted_ctr",
];
for (const field of qualityFields) {
  const result = await run(
    `Q2.${field.split(".").pop()}`,
    `
      SELECT
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ${field}
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status = 'ENABLED'
      LIMIT 5
    `
  );
  if (result.ok && result.rows.length > 0) {
    console.log("Sample:", JSON.stringify(result.rows[0].ad_group_criterion?.quality_info, null, 2));
  }
}

// ─── Q3 — per-keyword metrics: ad_group_criterion vs keyword_view ───
const q3a = await run(
  "Q3a — metrics FROM ad_group_criterion (user-spec'd path)",
  `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status = 'ENABLED'
      AND segments.date BETWEEN '2026-04-26' AND '2026-05-25'
    ORDER BY metrics.cost_micros DESC
    LIMIT 30
  `
);
if (q3a.ok && q3a.rows.length > 0) {
  console.log("\nTop 5 by cost (from ad_group_criterion):");
  for (const r of q3a.rows.slice(0, 5)) {
    const cost = Number(r.metrics?.cost_micros ?? 0) / 1_000_000;
    console.log(
      `  "${r.ad_group_criterion?.keyword?.text}"  cost=${cost.toFixed(2)}  clicks=${r.metrics?.clicks}  impressions=${r.metrics?.impressions}  conversions=${r.metrics?.conversions}`
    );
  }
}

const q3b = await run(
  "Q3b — same metrics FROM keyword_view (docs-recommended path)",
  `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM keyword_view
    WHERE ad_group_criterion.status = 'ENABLED'
      AND segments.date BETWEEN '2026-04-26' AND '2026-05-25'
    ORDER BY metrics.cost_micros DESC
    LIMIT 30
  `
);
if (q3b.ok && q3b.rows.length > 0) {
  console.log("\nTop 5 by cost (from keyword_view):");
  for (const r of q3b.rows.slice(0, 5)) {
    const cost = Number(r.metrics?.cost_micros ?? 0) / 1_000_000;
    console.log(
      `  "${r.ad_group_criterion?.keyword?.text}"  cost=${cost.toFixed(2)}  clicks=${r.metrics?.clicks}  impressions=${r.metrics?.impressions}`
    );
  }
}

// ─── Q4 — negative keywords ───
const q4 = await run(
  "Q4 — negative keywords on Search campaigns",
  `
    SELECT
      campaign.name,
      ad_group.name,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.negative
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
      AND campaign.advertising_channel_type = 'SEARCH'
      AND ad_group_criterion.negative = TRUE
    LIMIT 100
  `
);
if (q4.ok) {
  console.log(`\n${q4.rows.length} negative keywords (if 0, defer scope confirmed)`);
}

// ─── Q5 — per-ad_group keyword distribution (sizing decision) ───
const q5 = await run(
  "Q5 — keyword count per ad_group (GROUP BY proxy via manual aggregation)",
  `
    SELECT
      ad_group.id, ad_group.name,
      ad_group_criterion.criterion_id
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
      AND ad_group_criterion.status != 'REMOVED'
      AND campaign.advertising_channel_type = 'SEARCH'
      AND ad_group_criterion.negative = FALSE
    LIMIT 1000
  `
);
if (q5.ok && q5.rows.length > 0) {
  const counts = new Map();
  for (const r of q5.rows) {
    const k = String(r.ad_group?.id ?? "?") + "|" + (r.ad_group?.name ?? "?");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  console.log("\nKeyword count per ad_group:");
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)} keywords  ad_group="${k.split("|")[1]}"`);
  }
  const values = [...counts.values()];
  console.log(`\nStats: min=${Math.min(...values)} max=${Math.max(...values)} ad_groups=${values.length}`);
}

// ─── Q6 — integer-drift check via resource_name suffix ───
console.log(`\n${"─".repeat(70)}\nQ6 — integer-drift check (resource_name suffix walk)\n${"─".repeat(70)}`);
if (q1.ok && q1.rows.length > 0) {
  // Build (match_type_int, status_int) per row, infer integer→string from
  // any suffix-bearing field. ad_group_criterion.resource_name has
  // pattern `customers/X/adGroupCriteria/AG_ID~CRITERION_ID` — no field_type
  // suffix. So integer drift here can only be confirmed against the proto
  // docs, not by suffix walk. Report what integers we see.
  const byMatch = new Map();
  const byStatus = new Map();
  for (const r of q1.rows) {
    const mt = r.ad_group_criterion?.keyword?.match_type;
    const st = r.ad_group_criterion?.status;
    if (mt != null) byMatch.set(mt, (byMatch.get(mt) ?? 0) + 1);
    if (st != null) byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
  }
  console.log("\nObserved match_type integers (vs public-docs proto):");
  console.log("  Public docs: UNSPECIFIED=0, UNKNOWN=1, EXACT=2, PHRASE=3, BROAD=4");
  for (const [int, n] of byMatch.entries()) {
    console.log(`  integer ${int}: ${n} rows`);
  }
  console.log("\nObserved status integers (vs public-docs proto):");
  console.log("  Public docs: UNSPECIFIED=0, UNKNOWN=1, ENABLED=2, PAUSED=3, REMOVED=4");
  for (const [int, n] of byStatus.entries()) {
    console.log(`  integer ${int}: ${n} rows`);
  }
  console.log(
    "\nNote: ad_group_criterion.resource_name has no field_type suffix to corroborate. Integer→string mapping must be verified against an authoritative source (e.g., google-ads-api SDK fields.d.ts) OR by issuing a string-equality filter to test reverse compatibility."
  );

  // Test reverse: query with string match_type filter, see if rows match
  const probe = await run(
    "Q6 reverse — does string filter 'EXACT' return the same rows?",
    `
      SELECT ad_group_criterion.criterion_id
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.keyword.match_type = 'EXACT'
      LIMIT 5
    `
  );
  if (probe.ok) {
    console.log(`String filter 'EXACT' matched ${probe.rows.length} rows — if matches integer 2 count above, mapping confirmed.`);
  }
}

console.log(`\n${"=".repeat(70)}\nSUMMARY\n${"=".repeat(70)}`);
console.log(`Q1 inventory:           ${q1.ok ? q1.rows.length : "FAIL"} keywords`);
console.log(`Q3a metrics ad_group_criterion: ${q3a.ok ? q3a.rows.length + " rows" : "FAIL"}`);
console.log(`Q3b metrics keyword_view:       ${q3b.ok ? q3b.rows.length + " rows" : "FAIL"}`);
console.log(`Q4 negatives:           ${q4.ok ? q4.rows.length : "FAIL"} rows`);
console.log(`Q5 ad_groups indexed:   ${q5.ok ? q5.rows.length + " rows" : "FAIL"}`);
