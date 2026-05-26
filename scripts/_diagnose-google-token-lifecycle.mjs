/**
 * Read-only diagnostic — Google Ads token lifecycle audit (M-hardening recon)
 * ===========================================================================
 *
 * Probes the imaa user's Google Ads OAuth state to inform Issue #4 (production-
 * grade refresh token handling) + Issue #1 (re-sync dropped accounts).
 *
 * Questions:
 *   Q1 — auth.users row for alkhateib94@gmail.com (user_id reference)
 *   Q2 — platform_credentials row: refresh_token presence, created_at,
 *        updated_at, expires_at, scopes
 *   Q3 — connections rows for platform=google: count + which are 'active',
 *        and CRITICALLY — does connections.access_token match
 *        platform_credentials.refresh_token? (ADR-010 drift indicator)
 *   Q4 — live test: try listAccessibleCustomers() with the stored token.
 *        Outcome: success (token valid) vs invalid_grant (revoked/expired
 *        refresh — requires re-OAuth)
 *
 * READ-ONLY. No DB writes. Service-role used because platform_credentials
 * RLS would block cross-user reads from a normal session.
 *
 * Usage:
 *   node scripts/_diagnose-google-token-lifecycle.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { GoogleAdsApi } from "google-ads-api";
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

function section(title) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(title);
  console.log("=".repeat(70));
}

function maskToken(t) {
  if (!t) return "(null)";
  return `${t.slice(0, 8)}...${t.slice(-6)} (len=${t.length})`;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ===================================================================
  // Q1 — auth.users state
  // ===================================================================
  section(`Q1 — auth.users for ${TARGET_EMAIL}`);
  const { data: authData, error: authErr } = await sb.auth.admin.listUsers();
  if (authErr) {
    console.error("  listUsers failed:", authErr.message);
    process.exit(1);
  }
  const targetUser = authData.users.find((u) => u.email === TARGET_EMAIL);
  if (!targetUser) {
    console.log(`  No auth.users row found for ${TARGET_EMAIL}`);
    process.exit(0);
  }
  console.log(`  user_id:    ${targetUser.id}`);
  console.log(`  created_at: ${targetUser.created_at}`);
  console.log(`  last_sign_in_at: ${targetUser.last_sign_in_at ?? "(never)"}`);
  const userId = targetUser.id;

  // ===================================================================
  // Q2 — platform_credentials row for this user/google
  // ===================================================================
  section("Q2 — platform_credentials row (google)");
  const { data: cred, error: credErr } = await sb
    .from("platform_credentials")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "google")
    .maybeSingle();
  if (credErr) {
    console.error("  query failed:", credErr.message);
  } else if (!cred) {
    console.log("  NO ROW — user never completed Google OAuth");
  } else {
    console.log(`  id:            ${cred.id}`);
    console.log(`  refresh_token: ${maskToken(cred.refresh_token)}`);
    console.log(`  scopes:        ${JSON.stringify(cred.scopes)}`);
    console.log(`  expires_at:    ${cred.expires_at ?? "(null)"}`);
    console.log(`  created_at:    ${cred.created_at}`);
    console.log(`  updated_at:    ${cred.updated_at ?? "(same as created)"}`);
    if (cred.expires_at) {
      const expiresMs = new Date(cred.expires_at).getTime() - Date.now();
      const hours = Math.round(expiresMs / 3_600_000);
      console.log(`  access_token expires in: ${hours}h (note: this is the access_token TTL, refresh_token has no DB-tracked expiry)`);
    }
  }

  // ===================================================================
  // Q3 — connections rows: count + ADR-010 drift check
  // ===================================================================
  section("Q3 — connections rows for platform=google + ADR-010 drift check");
  const { data: conns, error: connErr } = await sb
    .from("connections")
    .select("id, account_id, account_name, status, access_token, connected_at, workspace_id, metadata")
    .eq("user_id", userId)
    .eq("platform", "google")
    .order("connected_at", { ascending: true });
  if (connErr) {
    console.error("  query failed:", connErr.message);
  } else if (!conns || conns.length === 0) {
    console.log("  NO CONNECTIONS — user has never selected any Google accounts");
  } else {
    console.log(`  total rows: ${conns.length}`);
    const byStatus = {};
    for (const c of conns) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    }
    console.log(`  by status:  ${JSON.stringify(byStatus)}`);
    console.log("");
    console.log("  per-connection drift check (cred.refresh_token vs conn.access_token):");
    for (const c of conns) {
      const matches = cred && c.access_token === cred.refresh_token;
      const driftFlag = matches ? "✓ MATCH" : "✗ DRIFT";
      console.log(`    [${c.status.padEnd(8)}] ${c.account_id} ${c.account_name ?? "(no name)"}`);
      console.log(`        access_token: ${maskToken(c.access_token)}`);
      console.log(`        ${driftFlag}  connected_at=${c.connected_at}`);
      const md = c.metadata || {};
      console.log(`        metadata: currency=${md.currency ?? "(missing)"} tz=${md.timezone_name ?? "(missing)"} is_manager=${md.is_manager} manager_id=${md.manager_customer_id ?? "(none)"}`);
    }
  }

  // ===================================================================
  // Q4 — live test: listAccessibleCustomers with stored token
  // ===================================================================
  section("Q4 — live test: listAccessibleCustomers(stored refresh_token)");
  if (!cred?.refresh_token) {
    console.log("  SKIP — no credential to test");
  } else {
    const api = new GoogleAdsApi({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      developer_token: env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });
    try {
      const t0 = Date.now();
      const response = await api.listAccessibleCustomers(cred.refresh_token);
      const dt = Date.now() - t0;
      const names = response.resource_names ?? [];
      console.log(`  ✓ SUCCESS — token is valid (latency=${dt}ms)`);
      console.log(`  accessible customer count: ${names.length}`);
      console.log(`  resource_names:`);
      for (const n of names) console.log(`    - ${n}`);
    } catch (err) {
      const msg = err?.message ?? "unknown";
      console.log(`  ✗ FAILED — ${msg}`);
      const errStr = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
      if (errStr.length < 2000) console.log(`  full error:\n${errStr}`);
    }
  }

  // ===================================================================
  // Q5 — Issue #1 scope: how many accessible accounts vs how many active?
  // ===================================================================
  section("Q5 — Issue #1 scope: accessible vs persisted (re-sync gap)");
  if (!cred?.refresh_token) {
    console.log("  SKIP — no credential");
  } else {
    try {
      const api = new GoogleAdsApi({
        client_id: env.GOOGLE_ADS_CLIENT_ID,
        client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
        developer_token: env.GOOGLE_ADS_DEVELOPER_TOKEN,
      });
      const response = await api.listAccessibleCustomers(cred.refresh_token);
      const accessibleIds = (response.resource_names ?? [])
        .map((n) => n.replace(/^customers\//, ""))
        .filter((id) => /^\d{10}$/.test(id));
      const persistedIds = new Set((conns ?? []).map((c) => c.account_id));
      const activeIds = new Set(
        (conns ?? []).filter((c) => c.status === "active").map((c) => c.account_id)
      );
      console.log(`  accessible via OAuth: ${accessibleIds.length}`);
      console.log(`  persisted in connections (any status): ${persistedIds.size}`);
      console.log(`  active in connections: ${activeIds.size}`);
      const missing = accessibleIds.filter((id) => !persistedIds.has(id));
      console.log(`  accessible-but-not-persisted: ${missing.length}`);
      if (missing.length > 0) {
        console.log(`  missing IDs (candidates for Issue #1 re-sync):`);
        for (const id of missing) console.log(`    - ${id}`);
      }
    } catch (err) {
      console.log(`  SKIP — listAccessibleCustomers failed: ${err?.message ?? "unknown"}`);
    }
  }

  console.log("\n=== DONE ===\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
