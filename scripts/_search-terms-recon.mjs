/**
 * M9 Search Terms — read-only recon probe against imaa
 * =====================================================
 *
 * Probes Google Ads `search_term_view` against the imaa 5473228670
 * account to inform ADR-018 (M9 Search Terms architecture).
 *
 * Questions (per M9-recon spec, 2026-05-28):
 *   Q1 — Inventory: top 100 search terms by spend, with match type
 *        + status + ad_group context + impressions/clicks/cost
 *   Q2 — Conversion data per search term (ADR-011 family — does
 *        metrics.conversions return per-term?)
 *   Q3 — Single-query Path A vs Path B verification (does
 *        metrics.conversions include non-purchase actions?)
 *   Q4 — Identity uniqueness: does the same search_term appear in
 *        multiple ad_groups? (composite-key requirement per M7.5
 *        memory_merger_composite_keys)
 *   Q5 — Volume sanity: total terms, terms with conversions, total cost
 *
 * READ-ONLY. No DB writes. Service-role used to read refresh_token
 * from platform_credentials.
 *
 * Usage:
 *   node scripts/_search-terms-recon.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { GoogleAdsApi, errors } from "google-ads-api";

function formatErr(err) {
  if (err instanceof errors.GoogleAdsFailure) {
    return err.errors
      ?.map((e) => `${e.message ?? "(no msg)"} [${JSON.stringify(e.error_code)}]`)
      .join("; ") ?? "GoogleAdsFailure (no detail)";
  }
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}
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

const TARGET_EMAIL = "alkhateib94@gmail.com";
const TARGET_CUSTOMER = "5473228670"; // imaa perfumes
const DATE_FROM = "2026-04-27";
const DATE_TO = "2026-05-26";

function section(title) {
  console.log(`\n${"=".repeat(74)}`);
  console.log(title);
  console.log("=".repeat(74));
}

function asPct(n, total) {
  if (!total) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Resolve refresh_token + login_customer_id for imaa
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
  if (!cred?.refresh_token) {
    console.error("no refresh_token");
    process.exit(1);
  }

  const { data: conn } = await sb
    .from("connections")
    .select("metadata")
    .eq("user_id", user.id)
    .eq("platform", "google")
    .eq("account_id", TARGET_CUSTOMER)
    .maybeSingle();
  // imaa is standalone (manager_customer_id=null per recon Q3). Mirror
  // production factory.ts: pass login_customer_id ONLY when metadata
  // actually carries one. Do NOT fall back to env GOOGLE_ADS_LOGIN_CUSTOMER_ID
  // — that's our own MCC, which we have no auth on for standalone accounts.
  const loginCustomerId = conn?.metadata?.manager_customer_id;
  console.log(`Using loginCustomerId: ${loginCustomerId ?? "(none — standalone)"}`);

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

  // ===================================================================
  // Q1 — Top 100 by spend
  // ===================================================================
  section("Q1 — Top 100 search terms by spend (last 30d)");
  console.log(`Date range: ${DATE_FROM} → ${DATE_TO}`);

  const q1 = `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      segments.keyword.info.text,
      segments.keyword.info.match_type,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc
    FROM search_term_view
    WHERE segments.date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'
      AND campaign.advertising_channel_type = 'SEARCH'
    ORDER BY metrics.cost_micros DESC
    LIMIT 100
  `;

  let q1Rows;
  try {
    q1Rows = await customer.query(q1);
  } catch (err) {
    console.error("Q1 FAILED:", formatErr(err));
    console.error("This is the SDK-vs-runtime trap test point.");
    console.error("If this fails, try alternative resource: keyword_view-style fallback.");
    process.exit(2);
  }
  console.log(`✓ Q1 succeeded — ${q1Rows.length} rows returned`);

  // Match type distribution
  const matchTypes = {};
  const statuses = {};
  const campaigns = new Map();
  let totalCost = 0;
  let totalImp = 0;
  let totalClk = 0;

  for (const r of q1Rows) {
    const mt = r.segments?.keyword?.info?.match_type;
    const st = r.search_term_view?.status;
    const cid = r.campaign?.id;
    const cname = r.campaign?.name;
    matchTypes[mt ?? "(undefined)"] = (matchTypes[mt ?? "(undefined)"] ?? 0) + 1;
    statuses[st ?? "(undefined)"] = (statuses[st ?? "(undefined)"] ?? 0) + 1;
    if (cid) {
      if (!campaigns.has(cid)) campaigns.set(cid, { name: cname, count: 0, cost: 0 });
      const c = campaigns.get(cid);
      c.count++;
      c.cost += Number(r.metrics?.cost_micros ?? 0);
    }
    totalCost += Number(r.metrics?.cost_micros ?? 0);
    totalImp += Number(r.metrics?.impressions ?? 0);
    totalClk += Number(r.metrics?.clicks ?? 0);
  }

  console.log(`\nMatch type distribution (raw SDK values):`);
  for (const [k, v] of Object.entries(matchTypes)) {
    console.log(`  ${k}: ${v} (${asPct(v, q1Rows.length)})`);
  }
  console.log(`\nStatus distribution (raw SDK values):`);
  for (const [k, v] of Object.entries(statuses)) {
    console.log(`  ${k}: ${v} (${asPct(v, q1Rows.length)})`);
  }
  console.log(`\nPer-campaign breakdown (top-100 sample):`);
  for (const [cid, c] of campaigns.entries()) {
    console.log(`  ${cid} ${c.name}: ${c.count} terms, ${(c.cost / 1e6).toFixed(2)} SAR`);
  }
  console.log(`\nTop 100 totals: cost=${(totalCost / 1e6).toFixed(2)} SAR, imp=${totalImp}, clk=${totalClk}`);

  console.log(`\nSample top 10 terms:`);
  for (let i = 0; i < Math.min(10, q1Rows.length); i++) {
    const r = q1Rows[i];
    console.log(
      `  ${(i + 1).toString().padStart(2)}. "${r.search_term_view?.search_term}" ` +
        `status=${r.search_term_view?.status} ` +
        `match=${r.segments?.keyword?.info?.match_type} ` +
        `kw="${r.segments?.keyword?.info?.text ?? "(none)"}" ` +
        `ag=${r.ad_group?.id} cost=${(Number(r.metrics?.cost_micros ?? 0) / 1e6).toFixed(2)} SAR ` +
        `imp=${r.metrics?.impressions} clk=${r.metrics?.clicks}`
    );
  }

  // ===================================================================
  // Q2 — Conversion data per search term
  // ===================================================================
  section("Q2 — Per-search-term conversion data (last 30d)");

  const q2 = `
    SELECT
      search_term_view.search_term,
      ad_group.id,
      metrics.conversions,
      metrics.conversions_value
    FROM search_term_view
    WHERE segments.date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'
      AND campaign.advertising_channel_type = 'SEARCH'
      AND metrics.conversions > 0
    ORDER BY metrics.conversions_value DESC
    LIMIT 20
  `;
  let q2Rows;
  try {
    q2Rows = await customer.query(q2);
  } catch (err) {
    console.error("Q2 FAILED:", formatErr(err));
    process.exit(3);
  }
  console.log(`✓ Q2 succeeded — ${q2Rows.length} rows with conversions > 0`);
  console.log(`\nTop 5 by revenue:`);
  for (let i = 0; i < Math.min(5, q2Rows.length); i++) {
    const r = q2Rows[i];
    console.log(
      `  ${i + 1}. "${r.search_term_view?.search_term}" ag=${r.ad_group?.id} ` +
        `conv=${Number(r.metrics?.conversions ?? 0).toFixed(2)} ` +
        `value=${Number(r.metrics?.conversions_value ?? 0).toFixed(2)} SAR`
    );
  }

  // ===================================================================
  // Q3 — Single-query vs Path B verification
  // ===================================================================
  section("Q3 — Path A inflation check (segmented conversions)");

  // List user's conversion actions first so we know what they look like.
  const { data: actions } = await sb
    .from("conversion_actions")
    .select("conversion_action_id, name, category, counts_as_purchase, user_override")
    .eq("user_id", user.id)
    .eq("account_id", TARGET_CUSTOMER)
    .order("name");

  console.log(`imaa configured conversion actions (${actions?.length ?? 0}):`);
  const purchaseIds = new Set();
  if (actions) {
    for (const a of actions) {
      const isP =
        a.user_override === true ||
        (a.user_override !== false && a.counts_as_purchase === true);
      if (isP) purchaseIds.add(String(a.conversion_action_id));
      console.log(
        `  - ${a.conversion_action_id} "${a.name}" category=${a.category} ` +
          `counts_as_purchase=${a.counts_as_purchase} override=${a.user_override} ${isP ? "← PURCHASE" : ""}`
      );
    }
  }

  const q3 = `
    SELECT
      search_term_view.search_term,
      ad_group.id,
      segments.conversion_action,
      metrics.conversions,
      metrics.conversions_value
    FROM search_term_view
    WHERE segments.date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'
      AND campaign.advertising_channel_type = 'SEARCH'
      AND metrics.conversions > 0
    ORDER BY metrics.conversions_value DESC
    LIMIT 50
  `;
  let q3Rows;
  try {
    q3Rows = await customer.query(q3);
  } catch (err) {
    console.error("Q3 FAILED:", formatErr(err));
    process.exit(4);
  }
  console.log(`✓ Q3 succeeded — ${q3Rows.length} segmented rows`);

  // Compare Path A (raw sum) vs Path B (purchaseIds-filtered)
  let pathATotalConv = 0;
  let pathATotalRev = 0;
  let pathBTotalConv = 0;
  let pathBTotalRev = 0;
  const actionsSeen = new Map();
  for (const r of q3Rows) {
    const conv = Number(r.metrics?.conversions ?? 0);
    const val = Number(r.metrics?.conversions_value ?? 0);
    const actionPath = String(r.segments?.conversion_action ?? "");
    const actionId = actionPath.split("/").pop() ?? "";
    pathATotalConv += conv;
    pathATotalRev += val;
    if (purchaseIds.has(actionId)) {
      pathBTotalConv += conv;
      pathBTotalRev += val;
    }
    if (!actionsSeen.has(actionId))
      actionsSeen.set(actionId, { conv: 0, val: 0 });
    actionsSeen.get(actionId).conv += conv;
    actionsSeen.get(actionId).val += val;
  }
  console.log(`\nPath A (raw metrics.conversions sum): ${pathATotalConv.toFixed(2)} conv, ${pathATotalRev.toFixed(2)} SAR`);
  console.log(`Path B (filtered to purchaseIds): ${pathBTotalConv.toFixed(2)} conv, ${pathBTotalRev.toFixed(2)} SAR`);
  const inflationConv = pathBTotalConv > 0 ? (pathATotalConv / pathBTotalConv).toFixed(2) : "N/A";
  console.log(`Inflation factor (Path A / Path B): ${inflationConv}x`);
  console.log(`\nAction breakdown:`);
  for (const [aid, v] of actionsSeen.entries()) {
    const isP = purchaseIds.has(aid);
    console.log(`  ${aid} ${isP ? "PURCHASE" : "(other)"}: ${v.conv.toFixed(2)} conv, ${v.val.toFixed(2)} SAR`);
  }

  // ===================================================================
  // Q4 — Identity uniqueness (composite-key requirement)
  // ===================================================================
  section("Q4 — Identity uniqueness check (same search_term across ad_groups?)");

  // GAQL doesn't support HAVING — pull all + analyze in JS
  const q4 = `
    SELECT
      search_term_view.search_term,
      ad_group.id
    FROM search_term_view
    WHERE segments.date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'
      AND campaign.advertising_channel_type = 'SEARCH'
    LIMIT 5000
  `;
  let q4Rows;
  try {
    q4Rows = await customer.query(q4);
  } catch (err) {
    console.error("Q4 FAILED:", formatErr(err));
    process.exit(5);
  }
  console.log(`✓ Q4 succeeded — ${q4Rows.length} rows scanned`);

  const termToAdGroups = new Map();
  for (const r of q4Rows) {
    const term = r.search_term_view?.search_term;
    const ag = r.ad_group?.id;
    if (!term || !ag) continue;
    if (!termToAdGroups.has(term)) termToAdGroups.set(term, new Set());
    termToAdGroups.get(term).add(String(ag));
  }

  const collisions = [];
  for (const [term, agSet] of termToAdGroups.entries()) {
    if (agSet.size > 1) collisions.push({ term, agCount: agSet.size });
  }
  collisions.sort((a, b) => b.agCount - a.agCount);

  console.log(`Distinct terms: ${termToAdGroups.size}`);
  console.log(`Terms appearing in >1 ad_group: ${collisions.length}`);
  if (collisions.length > 0) {
    console.log(`\n🚨 COMPOSITE KEY REQUIRED — top 20 colliding terms:`);
    for (const c of collisions.slice(0, 20)) {
      console.log(`  "${c.term}" → ${c.agCount} ad_groups`);
    }
    console.log(`\nLesson per feedback_merger_composite_keys.md:`);
    console.log(`  Map key MUST be \`${"${"}adGroupId|searchTerm${"}"}\`, not searchTerm alone.`);
  } else {
    console.log(`\n✓ NO COLLISIONS in scanned sample. Simple key (search_term) safe.`);
    console.log(`  CAVEAT: sample is ${q4Rows.length} rows; larger date ranges could surface collisions.`);
    console.log(`  Recommend composite key anyway per Memory #28 (defensive for new accounts).`);
  }

  // ===================================================================
  // Q5 — Volume sanity
  // ===================================================================
  section("Q5 — Volume sanity (visual-verification feasibility)");

  // Single aggregated query
  const q5 = `
    SELECT
      metrics.cost_micros,
      metrics.conversions,
      metrics.impressions
    FROM search_term_view
    WHERE segments.date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'
      AND campaign.advertising_channel_type = 'SEARCH'
  `;
  let q5Rows;
  try {
    q5Rows = await customer.query(q5);
  } catch (err) {
    console.error("Q5 FAILED:", formatErr(err));
    process.exit(6);
  }

  let totalQ5Cost = 0;
  let totalQ5Conv = 0;
  let totalQ5Imp = 0;
  let termsWithConv = 0;
  for (const r of q5Rows) {
    const cost = Number(r.metrics?.cost_micros ?? 0);
    const conv = Number(r.metrics?.conversions ?? 0);
    const imp = Number(r.metrics?.impressions ?? 0);
    totalQ5Cost += cost;
    totalQ5Conv += conv;
    totalQ5Imp += imp;
    if (conv > 0) termsWithConv++;
  }
  console.log(`Total search-term rows (last 30d): ${q5Rows.length}`);
  console.log(`Terms with conversions > 0: ${termsWithConv}`);
  console.log(`Total cost: ${(totalQ5Cost / 1e6).toFixed(2)} SAR`);
  console.log(`Total impressions: ${totalQ5Imp.toLocaleString("en-US")}`);
  console.log(`Total conversions: ${totalQ5Conv.toFixed(2)}`);
  if (termsWithConv < 10) {
    console.log(`\n⚠️  termsWithConv < 10 — visual verification will be sparse. Flag for user.`);
  } else {
    console.log(`\n✓ Volume sufficient for visual verification post-deploy.`);
  }

  console.log("\n=== DONE ===\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
