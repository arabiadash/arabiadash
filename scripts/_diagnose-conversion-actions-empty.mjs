/**
 * Diagnose google_conversion_actions empty state for imaa
 * ========================================================
 *
 * M9 recon flagged the cache as "empty" — but the recon probe queried
 * the WRONG table name (`conversion_actions` vs actual `google_conversion_actions`).
 * This probe corrects the table name and adds:
 *   Q1 — Actual row count in google_conversion_actions for imaa user
 *   Q2 — Orphan rows (rows tied to deleted user_ids) — auth.users churn check
 *   Q3 — Last sync timestamp on imaa connection
 *   Q4 — All user_ids that have any google_conversion_actions row
 *        (cross-reference to current auth.users → identifies orphans)
 *
 * READ-ONLY. No writes. Service-role used.
 *
 * Usage:
 *   node scripts/_diagnose-conversion-actions-empty.mjs
 */

import { createClient } from "@supabase/supabase-js";
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
const TARGET_CUSTOMER = "5473228670";

function section(t) {
  console.log(`\n${"=".repeat(74)}\n${t}\n${"=".repeat(74)}`);
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData } = await sb.auth.admin.listUsers();
  const user = authData.users.find((u) => u.email === TARGET_EMAIL);
  if (!user) {
    console.error("no user");
    process.exit(1);
  }
  console.log(`Current imaa user_id: ${user.id}`);
  console.log(`Created: ${user.created_at}`);
  console.log(`Last sign-in: ${user.last_sign_in_at ?? "(never)"}`);

  // ===================================================================
  // Q1 — google_conversion_actions for the CURRENT user
  // ===================================================================
  section(`Q1 — google_conversion_actions WHERE user_id = ${user.id} AND customer_id = ${TARGET_CUSTOMER}`);
  const { data: rows, error: rowErr } = await sb
    .from("google_conversion_actions")
    .select("*")
    .eq("user_id", user.id)
    .eq("customer_id", TARGET_CUSTOMER);
  if (rowErr) {
    console.error("query failed:", rowErr.message);
  } else {
    console.log(`Row count: ${rows.length}`);
    if (rows.length > 0) {
      console.log("Sample (first 3):");
      for (const r of rows.slice(0, 3)) {
        console.log(`  id=${r.conversion_action_id} name="${r.name}" category=${r.category} counts_as_purchase=${r.counts_as_purchase} user_override=${r.user_override} synced_at=${r.synced_at ?? r.updated_at ?? r.created_at}`);
      }
      const purchaseCount = rows.filter((r) =>
        r.user_override === true || (r.user_override !== false && r.counts_as_purchase === true)
      ).length;
      console.log(`Rows counting as PURCHASE (per factory.ts logic): ${purchaseCount}`);
    }
  }

  // ===================================================================
  // Q2 — All google_conversion_actions rows for THIS account_id across ALL user_ids
  // (catches orphans from past auth.users churn)
  // ===================================================================
  section(`Q2 — google_conversion_actions WHERE customer_id = ${TARGET_CUSTOMER} (any user_id)`);
  const { data: allByAcct } = await sb
    .from("google_conversion_actions")
    .select("user_id, conversion_action_id, name, category, synced_at, updated_at, created_at")
    .eq("customer_id", TARGET_CUSTOMER);
  console.log(`Total rows across all user_ids: ${allByAcct?.length ?? 0}`);
  if (allByAcct && allByAcct.length > 0) {
    const byUid = new Map();
    for (const r of allByAcct) {
      if (!byUid.has(r.user_id)) byUid.set(r.user_id, 0);
      byUid.set(r.user_id, byUid.get(r.user_id) + 1);
    }
    console.log("Per user_id distribution:");
    for (const [uid, n] of byUid.entries()) {
      const isCurrent = uid === user.id;
      const inAuth = authData.users.find((u) => u.id === uid);
      const flag = isCurrent ? "✓ CURRENT USER" : inAuth ? "(other live user)" : "🚨 ORPHAN (user deleted)";
      console.log(`  ${uid}: ${n} rows  ${flag}`);
    }
  }

  // ===================================================================
  // Q3 — connections row sync state
  // ===================================================================
  section(`Q3 — connections row for imaa (current user)`);
  const { data: conn } = await sb
    .from("connections")
    .select("id, account_id, account_name, status, connected_at, last_synced_at, metadata, access_token")
    .eq("user_id", user.id)
    .eq("platform", "google")
    .eq("customer_id", TARGET_CUSTOMER)
    .maybeSingle();
  if (!conn) {
    console.log("(no connection row)");
  } else {
    console.log(`id: ${conn.id}`);
    console.log(`status: ${conn.status}`);
    console.log(`connected_at: ${conn.connected_at}`);
    console.log(`last_synced_at: ${conn.last_synced_at ?? "(never)"}`);
    console.log(`access_token: ${conn.access_token === null ? "(NULL — ADR-017 applied)" : conn.access_token ? "(NON-NULL — ADR-017 migration NOT applied?)" : "(empty)"}`);
    console.log(`metadata.currency: ${conn.metadata?.currency}`);
    console.log(`metadata.timezone_name: ${conn.metadata?.timezone_name}`);
    console.log(`metadata.is_manager: ${conn.metadata?.is_manager}`);
    console.log(`metadata.manager_customer_id: ${conn.metadata?.manager_customer_id}`);
  }

  // ===================================================================
  // Q4 — All auth.users + their google_conversion_actions count
  // ===================================================================
  section(`Q4 — auth.users with stored Google credentials (orphan check)`);
  const { data: allCreds } = await sb
    .from("platform_credentials")
    .select("user_id, created_at, updated_at")
    .eq("platform", "google");
  console.log(`Total platform_credentials rows for platform=google: ${allCreds?.length ?? 0}`);
  if (allCreds) {
    for (const c of allCreds) {
      const u = authData.users.find((au) => au.id === c.user_id);
      const flag = u ? `LIVE (${u.email})` : "🚨 ORPHAN";
      console.log(`  ${c.user_id}: created=${c.created_at}, updated=${c.updated_at}, ${flag}`);
    }
  }

  console.log("\n=== DONE ===\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
