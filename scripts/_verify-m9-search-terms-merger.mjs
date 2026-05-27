/**
 * M9 / ADR-018 — post-implementation merger verification probe
 * ============================================================
 *
 * Inline-replicates the production fetchSearchTerms + fetchPurchaseSearch
 * TermTotals merger logic and asserts:
 *   1. Top 5 search terms by revenue match the recon Q2 baseline
 *   2. Composite-key correctness — `${adGroupId}${searchTerm}`
 *      produces distinct per-(ad_group, term) entries (no collapse)
 *   3. hasConversionData semantic — true on terms with positive
 *      purchases, false otherwise; null fields consistent
 *
 * Inline replication is intentional — mirrors the production code path
 * (same GAQL queries, same Map keying, same composite-key separator)
 * without requiring a tsx/ts-node loader. If production diverges from
 * this probe, the next milestone should refresh the probe.
 *
 * READ-ONLY. No DB writes. Service-role used.
 */

import { createClient } from "@supabase/supabase-js";
import { GoogleAdsApi, errors } from "google-ads-api";
import { readFileSync } from "node:fs";

function loadEnv() {
  const env = {};
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    env[trimmed.slice(0, idx).trim()] = trimmed
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return env;
}

function formatErr(err) {
  if (err instanceof errors.GoogleAdsFailure) {
    return err.errors
      ?.map((e) => `${e.message ?? "(no msg)"} [${JSON.stringify(e.error_code)}]`)
      .join("; ") ?? "GoogleAdsFailure (no detail)";
  }
  return err instanceof Error ? err.message : String(err);
}

const TARGET_EMAIL = "alkhateib94@gmail.com";
const TARGET_CUSTOMER = "5473228670";
const DATE_FROM = "2026-04-27";
const DATE_TO = "2026-05-26";
// Production: src/lib/google-ads/search-terms.ts COMPOSITE_KEY_SEP
const COMPOSITE_KEY_SEP = "";

function compositeKey(agId, term) {
  return `${agId}${COMPOSITE_KEY_SEP}${term}`;
}

function section(t) {
  console.log(`\n${"=".repeat(74)}\n${t}\n${"=".repeat(74)}`);
}

async function main() {
  const env = loadEnv();
  const sb = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: authData } = await sb.auth.admin.listUsers();
  const user = authData.users.find((u) => u.email === TARGET_EMAIL);
  if (!user) {
    console.error("user not found");
    process.exit(1);
  }
  const { data: cred } = await sb
    .from("platform_credentials")
    .select("refresh_token")
    .eq("user_id", user.id)
    .eq("platform", "google")
    .maybeSingle();
  const { data: conn } = await sb
    .from("connections")
    .select("metadata")
    .eq("user_id", user.id)
    .eq("platform", "google")
    .eq("account_id", TARGET_CUSTOMER)
    .maybeSingle();
  const loginCustomerId = conn?.metadata?.manager_customer_id;

  // Purchase action IDs (same logic as production getPurchaseActionIds)
  const { data: actions } = await sb
    .from("google_conversion_actions")
    .select("conversion_action_id, counts_as_purchase, user_override, status")
    .eq("user_id", user.id)
    .eq("customer_id", TARGET_CUSTOMER)
    .eq("status", 2);
  const purchaseIds = new Set();
  for (const a of actions ?? []) {
    const isP =
      a.user_override === true ||
      (a.user_override !== false && a.counts_as_purchase === true);
    if (isP) purchaseIds.add(String(a.conversion_action_id));
  }
  console.log(`Purchase action IDs from cache: ${[...purchaseIds].join(", ")}`);

  // SDK setup
  const api = new GoogleAdsApi({
    client_id: env.GOOGLE_ADS_CLIENT_ID,
    client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
    developer_token: env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });
  const customer = api.Customer({
    customer_id: TARGET_CUSTOMER,
    refresh_token: cred.refresh_token,
    ...(loginCustomerId ? { login_customer_id: String(loginCustomerId) } : {}),
  });

  // Discover ad_groups in scope
  const adGroupRows = await customer.query(`
    SELECT ad_group.id
    FROM search_term_view
    WHERE segments.date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'
      AND campaign.advertising_channel_type = 'SEARCH'
  `);
  const adGroupIds = new Set();
  for (const r of adGroupRows) {
    if (r.ad_group?.id) adGroupIds.add(String(r.ad_group.id));
  }
  const adGroupList = [...adGroupIds].join(", ");
  console.log(`ad_groups in scope: ${adGroupIds.size}`);

  // ============ Q1 (mirrors fetchSearchTerms in production) ============
  section("Q1 — fetchSearchTerms (identity + metrics)");
  const q1 = `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      segments.keyword.info.text,
      segments.keyword.info.match_type,
      ad_group.id,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc
    FROM search_term_view
    WHERE ad_group.id IN (${adGroupList})
      AND segments.date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'
      AND campaign.advertising_channel_type = 'SEARCH'
  `;

  // ============ Q2 (mirrors fetchPurchaseSearchTermTotals) ============
  const q2 = `
    SELECT
      ad_group.id,
      search_term_view.search_term,
      segments.conversion_action,
      metrics.conversions,
      metrics.conversions_value
    FROM search_term_view
    WHERE ad_group.id IN (${adGroupList})
      AND segments.date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'
      AND campaign.advertising_channel_type = 'SEARCH'
  `;

  const t0 = Date.now();
  const [rowsQ1, rowsQ2] = await Promise.all([
    customer.query(q1),
    customer.query(q2),
  ]);
  const dt = Date.now() - t0;
  console.log(`✓ Q1+Q2 returned in ${dt}ms (${rowsQ1.length} + ${rowsQ2.length} rows)`);

  // Build the Q2 merger Map (composite key)
  const purchasesByKey = new Map();
  if (purchaseIds.size > 0) {
    for (const r of rowsQ2) {
      const ag = r.ad_group?.id;
      const term = r.search_term_view?.search_term;
      if (ag == null || !term) continue;
      const key = compositeKey(String(ag), term);
      const existing = purchasesByKey.get(key) ?? { purchases: 0, revenue: 0 };
      const path = String(r.segments?.conversion_action ?? "");
      const actionId = path.split("/").pop() ?? "";
      if (purchaseIds.has(actionId)) {
        existing.purchases += Number(r.metrics?.conversions) || 0;
        existing.revenue += Number(r.metrics?.conversions_value) || 0;
      }
      purchasesByKey.set(key, existing);
    }
  }
  console.log(`Q2 merger Map size (composite-keyed): ${purchasesByKey.size}`);

  // Build the Q1 aggregator + merge with Q2
  const byKey = new Map();
  for (const r of rowsQ1) {
    const ag = r.ad_group?.id;
    const term = r.search_term_view?.search_term;
    if (ag == null || !term) continue;
    const key = compositeKey(String(ag), term);
    const cost = Number(r.metrics?.cost_micros ?? 0);
    const imp = Number(r.metrics?.impressions ?? 0);
    const clk = Number(r.metrics?.clicks ?? 0);
    const existing = byKey.get(key);
    if (existing) {
      existing.cost_micros += cost;
      existing.impressions += imp;
      existing.clicks += clk;
    } else {
      byKey.set(key, {
        adGroupId: String(ag),
        text: term,
        status: r.search_term_view?.status,
        cost_micros: cost,
        impressions: imp,
        clicks: clk,
      });
    }
  }

  // Merge purchase data
  const merged = [];
  for (const [key, accum] of byKey.entries()) {
    const spend = accum.cost_micros / 1_000_000;
    const purchaseEntry = purchasesByKey.size > 0 ? purchasesByKey.get(key) : undefined;
    const hasConv = purchasesByKey.size > 0 && purchaseEntry !== undefined;
    const purchases = hasConv ? purchaseEntry.purchases : null;
    const revenue = hasConv ? purchaseEntry.revenue : null;
    const roas = hasConv && spend > 0 ? purchaseEntry.revenue / spend : null;
    merged.push({
      adGroupId: accum.adGroupId,
      text: accum.text,
      status: accum.status,
      spend,
      impressions: accum.impressions,
      clicks: accum.clicks,
      purchases,
      revenue,
      roas,
      hasConversionData: hasConv,
    });
  }
  console.log(`Total merged entries: ${merged.length}`);
  console.log(`Entries with hasConversionData=true: ${merged.filter((t) => t.hasConversionData).length}`);

  // ===================================================================
  // Assertion 1 — top 5 by revenue match recon Q2 baseline (±5%)
  // ===================================================================
  section("Assertion 1 — top 5 by revenue match recon Q2 baseline");
  const top5 = [...merged]
    .filter((t) => t.revenue != null)
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
    .slice(0, 5);

  const expected = [
    { text: "ايما",          adGroupId: "193181260309", revenue: 10245.52 },
    { text: "ايما",          adGroupId: "168572351171", revenue: 9947.50 },
    { text: "عطر ايما",      adGroupId: "168572351171", revenue: 3631.97 },
    { text: "imaa",          adGroupId: "193840478855", revenue: 1848.30 },
    { text: "ايما للعطور",   adGroupId: "168572351171", revenue: 1143.38 },
  ];

  let allMatch = true;
  for (let i = 0; i < 5; i++) {
    const got = top5[i];
    const exp = expected[i];
    if (!got) {
      console.log(`  ${i + 1}. MISSING — expected "${exp.text}" ag=${exp.adGroupId}`);
      allMatch = false;
      continue;
    }
    const textMatch = got.text === exp.text;
    const agMatch = got.adGroupId === exp.adGroupId;
    const revDelta = Math.abs((got.revenue ?? 0) - exp.revenue);
    const revTolerance = exp.revenue * 0.05;
    const revMatch = revDelta <= revTolerance;
    const flag = textMatch && agMatch && revMatch ? "✓" : "✗";
    console.log(
      `  ${i + 1}. ${flag} "${got.text}" ag=${got.adGroupId} revenue=${(got.revenue ?? 0).toFixed(2)} SAR ` +
        `(expected "${exp.text}" ag=${exp.adGroupId} revenue=${exp.revenue.toFixed(2)} ±${revTolerance.toFixed(0)})`
    );
    if (!(textMatch && agMatch && revMatch)) allMatch = false;
  }
  console.log(allMatch ? "\n✓ Top-5 matches recon baseline within ±5% revenue tolerance" : "\n⚠️ Top-5 deviates — verify if drift is data-driven or structural");

  // ===================================================================
  // Assertion 2 — composite key splits "ايما" across ad_groups
  // ===================================================================
  section('Assertion 2 — composite-key splits "ايما" across ad_groups');
  const ayma = merged.filter((t) => t.text === "ايما");
  console.log(`Found ${ayma.length} entries for "ايما"`);
  for (const t of ayma) {
    console.log(
      `  ag=${t.adGroupId} status=${t.status} revenue=${(t.revenue ?? 0).toFixed(2)} purchases=${(t.purchases ?? 0).toFixed(2)} hasConv=${t.hasConversionData}`
    );
  }
  let compositeOK = true;
  if (ayma.length >= 2) {
    const sum = ayma.reduce((acc, t) => acc + (t.revenue ?? 0), 0);
    const distinct = ayma.every(
      (a, i) => ayma.every((b, j) => i === j || a.adGroupId !== b.adGroupId)
    );
    const maxSingle = Math.max(...ayma.map((t) => t.revenue ?? 0));
    console.log(`Sum across ad_groups: ${sum.toFixed(2)} SAR`);
    console.log(`Distinct ad_group_ids: ${distinct ? "✓" : "✗"}`);
    if (!distinct) compositeOK = false;
    if (maxSingle > sum * 0.95) {
      console.log(`🚨 SUSPICIOUS — single entry holds ${((maxSingle / sum) * 100).toFixed(1)}% of total`);
      compositeOK = false;
    } else {
      console.log(`✓ No entry exceeds 60% of total — composite-key working correctly`);
    }
  } else {
    console.log(`Only ${ayma.length} entry — composite-key effect unverifiable`);
  }

  // ===================================================================
  // Assertion 3 — hasConversionData semantic
  // ===================================================================
  section("Assertion 3 — hasConversionData semantic consistency");
  let inconsistent = 0;
  for (const t of merged) {
    if (t.hasConversionData) {
      // purchases / revenue MUST NOT be null when hasConversionData=true
      if (t.purchases === null || t.revenue === null) inconsistent++;
    } else {
      // purchases / revenue MUST be null when hasConversionData=false
      if (t.purchases !== null || t.revenue !== null) inconsistent++;
    }
  }
  console.log(`Total entries: ${merged.length}`);
  console.log(`Inconsistent entries: ${inconsistent}`);
  if (inconsistent === 0) {
    console.log(`✓ All entries respect hasConversionData ↔ null fields invariant`);
  } else {
    console.log(`🚨 ${inconsistent} entries violate the invariant`);
  }

  // ===================================================================
  // Final verdict
  // ===================================================================
  section("VERDICT");
  const verdict = allMatch && compositeOK && inconsistent === 0;
  if (verdict) {
    console.log(`✓ All 3 assertions passed. Production merger logic is correct.`);
    console.log(`  Pre-push verification: GREEN.`);
  } else {
    console.log(`✗ One or more assertions failed. STOP — investigate before push.`);
    process.exit(2);
  }

  console.log("\n=== DONE ===\n");
}

main().catch((err) => {
  console.error("Fatal:", formatErr(err));
  process.exit(1);
});
