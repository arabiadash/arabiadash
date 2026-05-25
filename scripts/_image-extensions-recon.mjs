/**
 * Image Extensions recon — Phase 4.8 M8 Stage 3
 * Date: 2026-05-26
 *
 * READ-ONLY GAQL probe. Surfaces:
 *   Q1: Inventory of all image-type assets on the account
 *   Q2: Image assets linked to Search campaigns via campaign_asset
 *   Q3: Image assets linked to ad_groups (cross-channel via ad_group_asset)
 *   Q4: Does the account have any active Display/Video campaigns?
 *
 * Companion to ADR-013/M-PMax recon — mirrors _pmax-recon.mjs style.
 *
 * Credential sourcing: same as _pmax-recon.mjs (env override or supabase
 * service_role lookup of first active google connection).
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
const clientId = env.GOOGLE_ADS_CLIENT_ID;
const clientSecret = env.GOOGLE_ADS_CLIENT_SECRET;
const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
if (!clientId || !clientSecret || !developerToken) {
  console.error("Missing GOOGLE_ADS_* env vars");
  process.exit(1);
}

async function resolveCredentials() {
  if (process.env.CUSTOMER_ID && process.env.REFRESH_TOKEN) {
    return {
      customerId: process.env.CUSTOMER_ID,
      refreshToken: process.env.REFRESH_TOKEN,
      loginCustomerId: process.env.MANAGER_CUSTOMER_ID || undefined,
    };
  }
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb
    .from("connections")
    .select("account_id, access_token, metadata")
    .eq("platform", "google")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    console.error("supabase lookup failed:", error?.message ?? "no row");
    process.exit(1);
  }
  return {
    customerId: data.account_id,
    refreshToken: data.access_token,
    loginCustomerId:
      typeof data.metadata?.manager_customer_id === "string"
        ? data.metadata.manager_customer_id
        : undefined,
  };
}

async function runQuery(customer, label, query) {
  console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}`);
  console.log(query.trim());
  try {
    const rows = await customer.query(query);
    console.log(`\n✓ ${rows.length} rows`);
    return { ok: true, rows };
  } catch (err) {
    const msg = err?.errors
      ? err.errors.map((e) => `${e.message ?? "(no msg)"} [${JSON.stringify(e.error_code)}]`).join("; ")
      : err?.message || String(err);
    console.log(`\n✗ FAILED: ${msg}`);
    return { ok: false, error: msg };
  }
}

async function main() {
  const creds = await resolveCredentials();
  console.log(`customer_id=${creds.customerId}  login_customer_id=${creds.loginCustomerId ?? "(standalone)"}`);

  const api = new GoogleAdsApi({ client_id: clientId, client_secret: clientSecret, developer_token: developerToken });
  const customer = api.Customer({
    customer_id: creds.customerId,
    refresh_token: creds.refreshToken,
    ...(creds.loginCustomerId ? { login_customer_id: creds.loginCustomerId } : {}),
  });

  // ─────────────────────────────────────────────────────────────────
  // Q1 — inventory of all image-type assets
  // ─────────────────────────────────────────────────────────────────
  const q1 = await runQuery(
    customer,
    "Q1 — Image-type assets on the account",
    `
      SELECT
        asset.id,
        asset.type,
        asset.name,
        asset.image_asset.full_size_image_url,
        asset.image_asset.file_size,
        asset.image_asset.mime_type
      FROM asset
      WHERE asset.type IN ('IMAGE', 'LANDSCAPE_LOGO', 'LOGO')
      LIMIT 100
    `
  );
  if (q1.ok && q1.rows.length > 0) {
    console.log("\nSample (first 3):");
    console.log(JSON.stringify(q1.rows.slice(0, 3), null, 2));
    const byType = {};
    for (const r of q1.rows) {
      const t = r.asset?.type ?? "?";
      byType[t] = (byType[t] ?? 0) + 1;
    }
    console.log("\nBreakdown by asset.type:", byType);
  }

  // ─────────────────────────────────────────────────────────────────
  // Q2 — Search campaign-level image linkages (active only)
  // ─────────────────────────────────────────────────────────────────
  const q2 = await runQuery(
    customer,
    "Q2 — campaign_asset image links on SEARCH (ENABLED only)",
    `
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        campaign_asset.status,
        campaign_asset.field_type,
        campaign_asset.asset,
        asset.id,
        asset.type
      FROM campaign_asset
      WHERE asset.type = 'IMAGE'
        AND campaign.advertising_channel_type = 'SEARCH'
        AND campaign_asset.status = 'ENABLED'
      LIMIT 200
    `
  );
  if (q2.ok && q2.rows.length > 0) {
    console.log("\nSample (first 3):");
    console.log(JSON.stringify(q2.rows.slice(0, 3), null, 2));
    const byCampaign = {};
    const byFieldType = {};
    for (const r of q2.rows) {
      const c = r.campaign?.name ?? "?";
      const ft = r.campaign_asset?.field_type ?? "?";
      byCampaign[c] = (byCampaign[c] ?? 0) + 1;
      byFieldType[ft] = (byFieldType[ft] ?? 0) + 1;
    }
    console.log("\nBreakdown by campaign:", byCampaign);
    console.log("Breakdown by field_type:", byFieldType);
  }

  // ─────────────────────────────────────────────────────────────────
  // Q3 — ad_group-level image linkages (any channel, active only)
  // ─────────────────────────────────────────────────────────────────
  const q3 = await runQuery(
    customer,
    "Q3 — ad_group_asset image links (ENABLED only)",
    `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.campaign,
        ad_group_asset.status,
        ad_group_asset.field_type,
        ad_group_asset.asset,
        asset.id,
        asset.type
      FROM ad_group_asset
      WHERE asset.type = 'IMAGE'
        AND ad_group_asset.status = 'ENABLED'
      LIMIT 200
    `
  );
  if (q3.ok && q3.rows.length > 0) {
    console.log("\nSample (first 3):");
    console.log(JSON.stringify(q3.rows.slice(0, 3), null, 2));
    const byFieldType = {};
    for (const r of q3.rows) {
      const ft = r.ad_group_asset?.field_type ?? "?";
      byFieldType[ft] = (byFieldType[ft] ?? 0) + 1;
    }
    console.log("\nBreakdown by field_type:", byFieldType);
  }

  // ─────────────────────────────────────────────────────────────────
  // Q4 — does the account have Display/Video campaigns?
  // ─────────────────────────────────────────────────────────────────
  const q4 = await runQuery(
    customer,
    "Q4 — Display/Video ads on the account (ENABLED only)",
    `
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        ad_group_ad.ad.id,
        ad_group_ad.ad.type
      FROM ad_group_ad
      WHERE campaign.advertising_channel_type IN ('DISPLAY', 'VIDEO')
        AND ad_group_ad.status = 'ENABLED'
      LIMIT 100
    `
  );
  if (q4.ok) {
    if (q4.rows.length === 0) {
      console.log("\n→ No Display/Video ads found on this account.");
    } else {
      const byType = {};
      const byChannel = {};
      for (const r of q4.rows) {
        const t = r.ad_group_ad?.ad?.type ?? "?";
        const c = r.campaign?.advertising_channel_type ?? "?";
        byType[t] = (byType[t] ?? 0) + 1;
        byChannel[c] = (byChannel[c] ?? 0) + 1;
      }
      console.log("\nBreakdown by ad.type:", byType);
      console.log("Breakdown by channel:", byChannel);
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // Stage 2 — hypothesis testing (added 2026-05-26 post-contradiction)
  //
  // Q2/Q3 returned 0 MARKETING_IMAGE rows, but the user verified in the
  // Google Ads UI that campaign 23583176100 has 9 marketing images
  // attached. The images exist; we need to find them.
  // ═════════════════════════════════════════════════════════════════
  const TARGET_CAMPAIGN_ID = "23583176100";

  // ─────────────────────────────────────────────────────────────────
  // H1 — Q2b: full field_type breakdown on campaign_asset, scoped to
  //          the target campaign, no field_type filter, no status filter
  // ─────────────────────────────────────────────────────────────────
  const q2b = await runQuery(
    customer,
    `Q2b — campaign_asset on campaign ${TARGET_CAMPAIGN_ID} (all images, all statuses)`,
    `
      SELECT
        campaign.id,
        campaign.name,
        campaign_asset.field_type,
        campaign_asset.status,
        asset.type,
        asset.id
      FROM campaign_asset
      WHERE asset.type = 'IMAGE'
        AND campaign.id = ${TARGET_CAMPAIGN_ID}
      LIMIT 100
    `
  );
  if (q2b.ok && q2b.rows.length > 0) {
    const byFT = {};
    const byStatus = {};
    for (const r of q2b.rows) {
      const ft = r.campaign_asset?.field_type ?? "?";
      const st = r.campaign_asset?.status ?? "?";
      byFT[ft] = (byFT[ft] ?? 0) + 1;
      byStatus[st] = (byStatus[st] ?? 0) + 1;
    }
    console.log("\nBreakdown by field_type:", byFT);
    console.log("Breakdown by status:", byStatus);
  }

  // ─────────────────────────────────────────────────────────────────
  // H2 — Q5: ad_group_ad_asset_view — images attached at the ad level
  //         (Google sometimes stores 'campaign-level' images here)
  // ─────────────────────────────────────────────────────────────────
  const q5 = await runQuery(
    customer,
    `Q5 — ad_group_ad_asset_view on campaign ${TARGET_CAMPAIGN_ID} (IMAGE assets, ENABLED)`,
    `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad_asset_view.field_type,
        ad_group_ad_asset_view.status,
        ad_group_ad_asset_view.asset,
        asset.type,
        asset.id
      FROM ad_group_ad_asset_view
      WHERE asset.type = 'IMAGE'
        AND campaign.id = ${TARGET_CAMPAIGN_ID}
        AND ad_group_ad_asset_view.status = 'ENABLED'
      LIMIT 100
    `
  );
  if (q5.ok && q5.rows.length > 0) {
    const byFT = {};
    for (const r of q5.rows) {
      const ft = r.ad_group_ad_asset_view?.field_type ?? "?";
      byFT[ft] = (byFT[ft] ?? 0) + 1;
    }
    console.log("\nBreakdown by field_type:", byFT);
    console.log("Sample (first 2):");
    console.log(JSON.stringify(q5.rows.slice(0, 2), null, 2));
  }

  // ─────────────────────────────────────────────────────────────────
  // H3 — Q6: confirm RSA-type ads exist on the campaign + grab one ad_id
  // ─────────────────────────────────────────────────────────────────
  const q6 = await runQuery(
    customer,
    `Q6 — RSA ads on campaign ${TARGET_CAMPAIGN_ID} (sniff structure + harvest ad_id)`,
    `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.type
      FROM ad_group_ad
      WHERE campaign.id = ${TARGET_CAMPAIGN_ID}
        AND ad_group_ad.status = 'ENABLED'
        AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
      LIMIT 5
    `
  );
  let probeAdId;
  if (q6.ok && q6.rows.length > 0) {
    probeAdId = String(q6.rows[0].ad_group_ad?.ad?.id ?? "");
    console.log(`\n→ Harvested ad_id for Q6b probe: ${probeAdId}`);
  }

  // Q6b — try selecting responsive_search_ad.images for a specific ad
  let q6b = { ok: false, error: "skipped (no ad_id)" };
  if (probeAdId) {
    q6b = await runQuery(
      customer,
      `Q6b — responsive_search_ad.images SELECT on ad ${probeAdId} (SDK-vs-runtime trap test)`,
      `
        SELECT
          ad_group_ad.ad.id,
          ad_group_ad.ad.responsive_search_ad.images
        FROM ad_group_ad
        WHERE ad_group_ad.ad.id = ${probeAdId}
      `
    );
    if (q6b.ok && q6b.rows.length > 0) {
      console.log("\nQ6b raw response (first row):");
      console.log(JSON.stringify(q6b.rows[0], null, 2));
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // H4 — Q7: customer_asset (account-level) — image extensions inherited
  //          to every campaign
  // ─────────────────────────────────────────────────────────────────
  const q7 = await runQuery(
    customer,
    "Q7 — customer_asset image links (account-level, all statuses)",
    `
      SELECT
        customer_asset.field_type,
        customer_asset.status,
        customer_asset.asset,
        asset.type,
        asset.id
      FROM customer_asset
      WHERE asset.type = 'IMAGE'
      LIMIT 100
    `
  );
  if (q7.ok && q7.rows.length > 0) {
    const byFT = {};
    const byStatus = {};
    for (const r of q7.rows) {
      const ft = r.customer_asset?.field_type ?? "?";
      const st = r.customer_asset?.status ?? "?";
      byFT[ft] = (byFT[ft] ?? 0) + 1;
      byStatus[st] = (byStatus[st] ?? 0) + 1;
    }
    console.log("\nBreakdown by field_type:", byFT);
    console.log("Breakdown by status:", byStatus);
    console.log("Sample (first 2):");
    console.log(JSON.stringify(q7.rows.slice(0, 2), null, 2));
  }

  // ─────────────────────────────────────────────────────────────────
  // Q8 — all distinct ad.type values on the target campaign
  //      (manual aggregation — GAQL has no GROUP BY)
  // ─────────────────────────────────────────────────────────────────
  const q8 = await runQuery(
    customer,
    `Q8 — distinct ad.type counts on campaign ${TARGET_CAMPAIGN_ID}`,
    `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.status
      FROM ad_group_ad
      WHERE campaign.id = ${TARGET_CAMPAIGN_ID}
      LIMIT 500
    `
  );
  if (q8.ok && q8.rows.length > 0) {
    const byType = {};
    const byStatus = {};
    for (const r of q8.rows) {
      const t = r.ad_group_ad?.ad?.type ?? "?";
      const s = r.ad_group_ad?.status ?? "?";
      byType[t] = (byType[t] ?? 0) + 1;
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }
    console.log("\nBreakdown by ad.type:", byType);
    console.log("Breakdown by status:", byStatus);
  }

  // ─────────────────────────────────────────────────────────────────
  // Q9 — final hypothesis-killer: read resource_name suffixes for ALL
  // ENABLED campaign_asset rows on the target. The suffix is the
  // authoritative field-type label (the integer drifts; the suffix
  // doesn't). campaign.id MUST be in SELECT when in WHERE per the
  // per-resource GAQL semantic (also seen in fetchPurchaseProductGroupTotals).
  // ─────────────────────────────────────────────────────────────────
  const q9 = await runQuery(
    customer,
    `Q9 — ENABLED campaign_asset on ${TARGET_CAMPAIGN_ID} (resource_name suffix = authoritative label)`,
    `
      SELECT
        campaign.id,
        campaign_asset.resource_name,
        campaign_asset.field_type,
        asset.id,
        asset.type
      FROM campaign_asset
      WHERE campaign.id = ${TARGET_CAMPAIGN_ID}
        AND campaign_asset.status = 'ENABLED'
    `
  );
  if (q9.ok && q9.rows.length > 0) {
    console.log("\nAll ENABLED rows on this campaign (suffix = authoritative label):");
    const bySuffix = {};
    for (const r of q9.rows) {
      const rn = r.campaign_asset?.resource_name ?? "";
      const suffix = rn.split("~").slice(-1)[0];
      console.log(
        `  field_type_int=${r.campaign_asset?.field_type}  suffix="${suffix}"  asset.id=${r.asset?.id}  asset.type_int=${r.asset?.type}`
      );
      bySuffix[suffix] = (bySuffix[suffix] ?? 0) + 1;
    }
    console.log("\nCounts by suffix:", bySuffix);
  }

  // ═════════════════════════════════════════════════════════════════
  // Stage 3 — campaign-wide image inventory (added 2026-05-26)
  //
  // Q2 returned 40 ENABLED image rows across the 4 Brand campaigns.
  // Stage 1 misread these as "all logos" via integer-to-string mapping;
  // Stage 2 proved (on the target campaign) that integer 26 = AD_IMAGE
  // on this account, not LANDSCAPE_LOGO. Q10 re-walks Q2 with
  // resource_name suffix decoding to get the authoritative split per
  // campaign.
  // ═════════════════════════════════════════════════════════════════
  const q10 = await runQuery(
    customer,
    "Q10 — ENABLED image links across all SEARCH campaigns (suffix-decoded)",
    `
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        campaign_asset.field_type,
        campaign_asset.status,
        campaign_asset.resource_name,
        asset.type,
        asset.id
      FROM campaign_asset
      WHERE asset.type = 'IMAGE'
        AND campaign_asset.status = 'ENABLED'
        AND campaign.advertising_channel_type = 'SEARCH'
      ORDER BY campaign.id
    `
  );

  if (q10.ok && q10.rows.length > 0) {
    // Per-campaign per-suffix aggregation
    /** @type {Map<string, {name: string, bySuffix: Map<string, number>, adImageAssetIds: string[]}>} */
    const byCampaign = new Map();
    /** @type {Set<string>} */
    const allSuffixes = new Set();

    for (const r of q10.rows) {
      const campaignId = String(r.campaign?.id ?? "?");
      const campaignName = String(r.campaign?.name ?? "?");
      const rn = String(r.campaign_asset?.resource_name ?? "");
      const suffix = rn.split("~").slice(-1)[0] || "(empty)";
      const assetId = String(r.asset?.id ?? "?");

      allSuffixes.add(suffix);

      let entry = byCampaign.get(campaignId);
      if (!entry) {
        entry = { name: campaignName, bySuffix: new Map(), adImageAssetIds: [] };
        byCampaign.set(campaignId, entry);
      }
      entry.bySuffix.set(suffix, (entry.bySuffix.get(suffix) ?? 0) + 1);
      if (suffix === "AD_IMAGE") entry.adImageAssetIds.push(assetId);
    }

    // Build columns from observed suffixes, with known ones first
    const KNOWN = ["AD_IMAGE", "BUSINESS_LOGO", "LANDSCAPE_LOGO"];
    const seen = Array.from(allSuffixes);
    const unknownSuffixes = seen.filter((s) => !KNOWN.includes(s));
    const columns = [...KNOWN.filter((s) => seen.includes(s)), ...unknownSuffixes];

    // Render table
    console.log("\n┌─────────────────────────────────────────────────────────────────");
    console.log("│ Per-campaign ENABLED image inventory (suffix-decoded)");
    console.log("└─────────────────────────────────────────────────────────────────");
    const headerCells = ["Campaign", ...columns, "Total"];
    console.log("\n" + headerCells.map((c) => c.padEnd(16)).join("│ "));
    console.log(headerCells.map(() => "─".repeat(15)).join("┼─"));

    let totals = Object.fromEntries(columns.map((c) => [c, 0]));
    let grandTotal = 0;

    for (const [, entry] of byCampaign) {
      const cells = [
        (entry.name || "?").slice(0, 14),
        ...columns.map((c) => String(entry.bySuffix.get(c) ?? 0)),
        String(Array.from(entry.bySuffix.values()).reduce((a, b) => a + b, 0)),
      ];
      console.log(cells.map((c) => String(c).padEnd(16)).join("│ "));
      for (const c of columns) {
        const n = entry.bySuffix.get(c) ?? 0;
        totals[c] += n;
        grandTotal += n;
      }
    }
    const totalCells = [
      "TOTAL",
      ...columns.map((c) => String(totals[c])),
      String(grandTotal),
    ];
    console.log(headerCells.map(() => "─".repeat(15)).join("┼─"));
    console.log(totalCells.map((c) => String(c).padEnd(16)).join("│ "));

    // Anomalies
    console.log("\n─ Anomalies + observations ─");
    if (unknownSuffixes.length > 0) {
      console.log(`⚠  Unexpected suffix(es) beyond known 3: ${unknownSuffixes.join(", ")}`);
    } else {
      console.log("✓ No unexpected field_type suffixes — all rows fit AD_IMAGE / BUSINESS_LOGO / LANDSCAPE_LOGO");
    }
    const zeroImageCampaigns = [];
    for (const [, entry] of byCampaign) {
      const hasAdImage = (entry.bySuffix.get("AD_IMAGE") ?? 0) > 0;
      if (!hasAdImage) zeroImageCampaigns.push(entry.name);
    }
    if (zeroImageCampaigns.length > 0) {
      console.log(`⚠  Campaigns with ZERO AD_IMAGE entries (coverage gap): ${zeroImageCampaigns.join(", ")}`);
    } else {
      console.log("✓ Every Search campaign has at least one AD_IMAGE entry");
    }

    // AD_IMAGE asset.id list per campaign (for spot-checking in the Google Ads UI)
    console.log("\n─ AD_IMAGE asset.id list (for UI spot-check) ─");
    for (const [, entry] of byCampaign) {
      if (entry.adImageAssetIds.length === 0) continue;
      console.log(`  ${entry.name}:  ${entry.adImageAssetIds.join(", ")}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}\nSUMMARY\n${"=".repeat(70)}`);
  console.log(`Q1 inventory:           ${q1.ok ? q1.rows.length : "FAIL"} image-type assets total`);
  console.log(`Q2 SEARCH campaign link:${q2.ok ? q2.rows.length : "FAIL"} active image links on Search campaigns`);
  console.log(`Q3 ad_group link:       ${q3.ok ? q3.rows.length : "FAIL"} active image links on ad groups`);
  console.log(`Q4 Display/Video ads:   ${q4.ok ? q4.rows.length : "FAIL"} (0 = pure Search/PMax account)`);
  console.log(`Q2b campaign_asset full:${q2b.ok ? q2b.rows.length : "FAIL"} rows on campaign ${TARGET_CAMPAIGN_ID}`);
  console.log(`Q5 ad_group_ad_asset_v: ${q5.ok ? q5.rows.length : "FAIL"} image links on target campaign`);
  console.log(`Q6 RSA harvest:         ${q6.ok ? q6.rows.length : "FAIL"} RSA ads on target`);
  console.log(`Q6b RSA.images SELECT:  ${q6b.ok ? "OK" : "FAIL"} ${q6b.ok ? `(rows=${q6b.rows.length})` : `(${q6b.error})`}`);
  console.log(`Q7 customer_asset:      ${q7.ok ? q7.rows.length : "FAIL"} account-level image links`);
  console.log(`Q8 ad.type distinct:    ${q8.ok ? q8.rows.length : "FAIL"} ads on target campaign`);
  console.log(`Q9 ENABLED suffix-walk: ${q9.ok ? q9.rows.length : "FAIL"} rows (authoritative labels via resource_name)`);
  console.log(`Q10 Search-wide inventory:${q10.ok ? q10.rows.length : "FAIL"} rows across all SEARCH campaigns`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
