/**
 * PMax recon script — Phase 4.8 M7 Stage 3
 * Date: 2026-05-24
 *
 * Diagnostic script. Read-only GAQL only. Not production code — the leading
 * underscore in the filename marks it as a one-off recon artifact.
 *
 * Runs 5 SELECT queries against the imaa Google Ads account to inform the
 * PMax architecture decision. See docs/recon/pmax-recon-2026-05-24.md
 * (Stage 1) and docs/recon/pmax-recon-stage-2-3-2026-05-24.md (this run's
 * output) for context.
 *
 * Usage:
 *   node scripts/_pmax-recon.mjs
 *
 * Credential sourcing (in order of preference):
 *   1. CUSTOMER_ID + REFRESH_TOKEN env vars (manual override) +
 *      optional MANAGER_CUSTOMER_ID
 *   2. Supabase service_role lookup of the first active google connection
 *      (may fail if GRANT SELECT not present on connections table)
 *
 * Always loads from .env.local: GOOGLE_ADS_CLIENT_ID,
 * GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { GoogleAdsApi } from "google-ads-api";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// =================================================================
// env loader (no dotenv dep — keep package.json untouched)
// =================================================================
function loadEnv() {
  const env = {};
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      env[key] = value;
    }
  } catch (err) {
    console.error("Failed to read .env.local:", err.message);
    process.exit(1);
  }
  return env;
}

const env = loadEnv();

const clientId = env.GOOGLE_ADS_CLIENT_ID;
const clientSecret = env.GOOGLE_ADS_CLIENT_SECRET;
const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;

if (!clientId || !clientSecret || !developerToken) {
  console.error("Missing one of: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN");
  process.exit(1);
}

// =================================================================
// Credential resolution: env vars first, supabase fallback
// =================================================================
async function resolveCredentials() {
  if (process.env.CUSTOMER_ID && process.env.REFRESH_TOKEN) {
    console.log("→ Using credentials from CUSTOMER_ID + REFRESH_TOKEN env vars");
    return {
      customerId: process.env.CUSTOMER_ID,
      refreshToken: process.env.REFRESH_TOKEN,
      loginCustomerId: process.env.MANAGER_CUSTOMER_ID || undefined,
      source: "env",
    };
  }

  console.log("→ Looking up first active google connection via supabase service_role");
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (and no CUSTOMER_ID/REFRESH_TOKEN env override)");
    process.exit(1);
  }

  const sb = createClient(supabaseUrl, serviceRole);
  const { data, error } = await sb
    .from("connections")
    .select("account_id, access_token, metadata")
    .eq("platform", "google")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Supabase lookup failed:", error.message);
    console.error("Fallback: set CUSTOMER_ID, REFRESH_TOKEN, MANAGER_CUSTOMER_ID env vars and re-run.");
    process.exit(1);
  }
  if (!data) {
    console.error("No active google connection found in supabase");
    process.exit(1);
  }

  const metadata = data.metadata || {};
  return {
    customerId: data.account_id,
    refreshToken: data.access_token,
    loginCustomerId:
      typeof metadata.manager_customer_id === "string"
        ? metadata.manager_customer_id
        : undefined,
    source: "supabase",
  };
}

// =================================================================
// runQuery — wraps customer.query() with error capture per kickoff
//   - print query name + status
//   - on error: print message + continue (kickoff: don't halt)
// =================================================================
async function runQuery(customer, label, query) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Query: ${label}`);
  console.log("=".repeat(70));
  console.log("GAQL:");
  console.log(query.trim());
  console.log();

  try {
    const rows = await customer.query(query);
    console.log(`✓ Returned ${rows.length} rows`);
    return { ok: true, rows };
  } catch (err) {
    const message = err?.errors
      ? err.errors
          .map(
            (e) =>
              `${e.message ?? "(no message)"} [${JSON.stringify(e.error_code)}]`
          )
          .join("; ")
      : err?.message || String(err);
    console.log(`✗ FAILED: ${message}`);
    return { ok: false, error: message };
  }
}

// =================================================================
// Aggregation helper for Query 3 (manual GROUP BY)
// =================================================================
function aggregateAssetBreakdown(rows) {
  const byFieldType = new Map();
  const byPerformanceLabel = new Map();
  const byAssetType = new Map();

  for (const row of rows) {
    const ft = row.asset_group_asset?.field_type ?? "(unknown)";
    const pl = row.asset_group_asset?.performance_label ?? "(unknown)";
    const at = row.asset?.type ?? "(unknown)";

    byFieldType.set(ft, (byFieldType.get(ft) ?? 0) + 1);
    byPerformanceLabel.set(pl, (byPerformanceLabel.get(pl) ?? 0) + 1);
    byAssetType.set(at, (byAssetType.get(at) ?? 0) + 1);
  }

  const toObj = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
  return {
    countByFieldType: toObj(byFieldType),
    countByPerformanceLabel: toObj(byPerformanceLabel),
    countByAssetType: toObj(byAssetType),
  };
}

// =================================================================
// MAIN
// =================================================================
async function main() {
  const creds = await resolveCredentials();
  console.log(`\nCredential source: ${creds.source}`);
  console.log(`customer_id:       ${creds.customerId}`);
  console.log(`login_customer_id: ${creds.loginCustomerId ?? "(none — standalone)"}`);

  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const customer = api.Customer({
    customer_id: creds.customerId,
    refresh_token: creds.refreshToken,
    ...(creds.loginCustomerId ? { login_customer_id: creds.loginCustomerId } : {}),
  });

  const results = {};

  // ---------------------------------------------------------------
  // Q1: PMax campaigns
  // ---------------------------------------------------------------
  results.q1_pmax_campaigns = await runQuery(
    customer,
    "Q1 — PMax campaigns",
    `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type
      FROM campaign
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
    `
  );
  if (results.q1_pmax_campaigns.ok) {
    console.log("\nRows:");
    console.log(JSON.stringify(results.q1_pmax_campaigns.rows, null, 2));
  }

  // ---------------------------------------------------------------
  // Q2: asset_group + ad_strength + primary_status
  // ---------------------------------------------------------------
  results.q2_asset_groups = await runQuery(
    customer,
    "Q2 — Asset groups + ad_strength",
    `
      SELECT
        campaign.id,
        campaign.name,
        asset_group.id,
        asset_group.name,
        asset_group.ad_strength,
        asset_group.primary_status
      FROM asset_group
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
    `
  );
  if (results.q2_asset_groups.ok) {
    console.log("\nRows:");
    console.log(JSON.stringify(results.q2_asset_groups.rows, null, 2));
    const adStrengthCounts = new Map();
    const statusCounts = new Map();
    for (const row of results.q2_asset_groups.rows) {
      const ad_strength = row.asset_group?.ad_strength ?? "(unknown)";
      const status = row.asset_group?.primary_status ?? "(unknown)";
      adStrengthCounts.set(ad_strength, (adStrengthCounts.get(ad_strength) ?? 0) + 1);
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }
    console.log("\nAd-strength distribution:");
    console.log(JSON.stringify(Object.fromEntries(adStrengthCounts), null, 2));
    console.log("\nPrimary-status distribution:");
    console.log(JSON.stringify(Object.fromEntries(statusCounts), null, 2));
  }

  // ---------------------------------------------------------------
  // Q3: asset breakdown (LIMIT 50) + manual GROUP BY
  // Field name corrected per Stage 1 docs: `asset.image_asset.full_size.url`
  // (the nested `.full_size.url` form, NOT `.full_size_image_url` which is
  // the M5 pattern that works for ad-level image_asset but not the
  // PMax asset_group_asset join).
  //
  // If this still rejects: try removing fields one at a time to isolate —
  // (a) drop `asset.image_asset.full_size.url`, keep performance_label
  // (b) drop performance_label, keep image URL
  // GAQL bundles all rejected fields into one error message; isolation
  // identifies the actual culprit.
  // ---------------------------------------------------------------
  results.q3_asset_breakdown = await runQuery(
    customer,
    "Q3 — Asset breakdown (LIMIT 50)",
    `
      SELECT
        asset_group_asset.field_type,
        asset.type,
        asset_group_asset.performance_label,
        asset.text_asset.text,
        asset.image_asset.full_size.url
      FROM asset_group_asset
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      LIMIT 50
    `
  );
  if (results.q3_asset_breakdown.ok) {
    console.log("\nFirst 10 rows:");
    console.log(JSON.stringify(results.q3_asset_breakdown.rows.slice(0, 10), null, 2));
    const agg = aggregateAssetBreakdown(results.q3_asset_breakdown.rows);
    console.log("\nManual GROUP BY aggregation:");
    console.log(JSON.stringify(agg, null, 2));
    results.q3_aggregation = agg;
  }

  // ---------------------------------------------------------------
  // Q4: asset_group metrics, 30-day
  // ---------------------------------------------------------------
  results.q4_metrics = await runQuery(
    customer,
    "Q4 — Asset group metrics, last 30 days",
    `
      SELECT
        asset_group.id,
        asset_group.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM asset_group
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        AND segments.date DURING LAST_30_DAYS
    `
  );
  if (results.q4_metrics.ok) {
    console.log("\nRows:");
    console.log(JSON.stringify(results.q4_metrics.rows, null, 2));
  }

  // ---------------------------------------------------------------
  // Q5: retail PMax detection (shopping_setting)
  // Per kickoff: if this fails, continue + report — known fragile field
  // ---------------------------------------------------------------
  results.q5_retail = await runQuery(
    customer,
    "Q5 — Retail PMax check (shopping_setting)",
    `
      SELECT
        campaign.id,
        campaign.name,
        campaign.shopping_setting.merchant_id,
        campaign.shopping_setting.feed_label
      FROM campaign
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
    `
  );
  if (results.q5_retail.ok) {
    console.log("\nRows:");
    console.log(JSON.stringify(results.q5_retail.rows, null, 2));
  }

  // ---------------------------------------------------------------
  // Q6 — Phase 2 field-isolation iterations (M-PMax Commit 4)
  //
  // Per ADR-013 field-isolation discipline: each new SELECT field is
  // tested in an additive sequence. If iteration N fails, stop adding
  // and report the boundary. Q3 already proved field_type / asset.type
  // / text_asset.text / image_asset.full_size.url work and that
  // performance_label rejects — Q6 widens scope to asset.id and
  // youtube_video_asset.youtube_video_id which the implementation
  // (fetchAssetGroupAssets) needs.
  // ---------------------------------------------------------------
  results.q6a_base = await runQuery(
    customer,
    "Q6a — asset_group_asset BASE (6 fields)",
    `
      SELECT
        asset_group.id,
        asset_group.name,
        asset_group_asset.field_type,
        asset.id,
        asset.type,
        asset.text_asset.text
      FROM asset_group_asset
      WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      LIMIT 50
    `
  );
  if (results.q6a_base.ok) {
    console.log("\nFirst 3 rows:");
    console.log(JSON.stringify(results.q6a_base.rows.slice(0, 3), null, 2));
  }

  if (results.q6a_base.ok) {
    results.q6b_image = await runQuery(
      customer,
      "Q6b — base + asset.image_asset.full_size.url",
      `
        SELECT
          asset_group.id,
          asset_group.name,
          asset_group_asset.field_type,
          asset.id,
          asset.type,
          asset.text_asset.text,
          asset.image_asset.full_size.url
        FROM asset_group_asset
        WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        LIMIT 50
      `
    );
    if (results.q6b_image.ok) {
      console.log("\nFirst 3 rows:");
      console.log(JSON.stringify(results.q6b_image.rows.slice(0, 3), null, 2));
    }
  } else {
    console.log("\n[Q6b skipped — Q6a failed]");
    results.q6b_image = { ok: false, error: "skipped (Q6a failed)" };
  }

  if (results.q6b_image.ok) {
    results.q6c_video = await runQuery(
      customer,
      "Q6c — base + image + asset.youtube_video_asset.youtube_video_id",
      `
        SELECT
          asset_group.id,
          asset_group.name,
          asset_group_asset.field_type,
          asset.id,
          asset.type,
          asset.text_asset.text,
          asset.image_asset.full_size.url,
          asset.youtube_video_asset.youtube_video_id
        FROM asset_group_asset
        WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        LIMIT 50
      `
    );
    if (results.q6c_video.ok) {
      console.log("\nFirst 3 rows:");
      console.log(JSON.stringify(results.q6c_video.rows.slice(0, 3), null, 2));
    }
  } else {
    console.log("\n[Q6c skipped — Q6b failed]");
    results.q6c_video = { ok: false, error: "skipped (Q6b failed)" };
  }

  // Q6d intentionally SKIPPED — performance_label confirmed rejected
  // in Stage 3 Q3. Re-testing here would just re-confirm the trap.

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(
    JSON.stringify(
      {
        q1_pmax_campaigns: results.q1_pmax_campaigns.ok
          ? results.q1_pmax_campaigns.rows.length
          : `FAILED: ${results.q1_pmax_campaigns.error}`,
        q2_asset_groups: results.q2_asset_groups.ok
          ? results.q2_asset_groups.rows.length
          : `FAILED: ${results.q2_asset_groups.error}`,
        q3_asset_breakdown_rows: results.q3_asset_breakdown.ok
          ? results.q3_asset_breakdown.rows.length
          : `FAILED: ${results.q3_asset_breakdown.error}`,
        q3_aggregation: results.q3_aggregation ?? null,
        q4_metrics_rows: results.q4_metrics.ok
          ? results.q4_metrics.rows.length
          : `FAILED: ${results.q4_metrics.error}`,
        q5_retail_pmax: results.q5_retail.ok
          ? results.q5_retail.rows.length > 0 &&
            results.q5_retail.rows.some(
              (r) => r.campaign?.shopping_setting?.merchant_id
            )
            ? "YES (retail PMax detected)"
            : "NO (standard PMax)"
          : `FAILED: ${results.q5_retail.error}`,
        q6a_base: results.q6a_base.ok
          ? `${results.q6a_base.rows.length} rows`
          : `FAILED: ${results.q6a_base.error}`,
        q6b_image: results.q6b_image.ok
          ? `${results.q6b_image.rows.length} rows`
          : `FAILED: ${results.q6b_image.error}`,
        q6c_video: results.q6c_video.ok
          ? `${results.q6c_video.rows.length} rows`
          : `FAILED: ${results.q6c_video.error}`,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("Unexpected fatal error:", err);
  process.exit(1);
});
