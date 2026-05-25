/**
 * Emergency read-only diagnostic — auth user re-signup orphan state
 * ================================================================
 *
 * Production /dashboard returns 500 for alkhateib94@gmail.com after the
 * user deleted their auth.users row directly, re-signed up via Google
 * OAuth, and got a fresh user_id (e865198f-643d-4440-bb93-0ce2dfdcde85).
 * Vercel logs show:
 *
 *   [resolveActiveWorkspace] User e865198f-... has zero workspaces.
 *   [workspaces/createDefaultWorkspace] Failed: duplicate key value
 *     violates unique constraint "workspaces_one_default_per_user"
 *
 * This script READS the DB state to understand:
 *   1. auth.users state for the email (deleted? re-created? both?)
 *   2. workspaces table contents — specifically: any rows with the NEW
 *      user_id OR any orphaned rows pointing to a now-missing user_id
 *   3. Orphan counts in dependent tables (connections, platform_credentials,
 *      creatives_cache, insights_cache)
 *   4. The actual definition of the workspaces_one_default_per_user
 *      constraint — to understand why the INSERT collides
 *
 * READ-ONLY. No DELETE, INSERT, UPDATE. Service-role used because
 * standard auth doesn't reach auth.users or cross-user rows.
 *
 * Usage:
 *   node scripts/_diagnose-auth-emergency.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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

const TARGET_EMAIL = "alkhateib94@gmail.com";
const NEW_UID_FROM_LOGS = "e865198f-643d-4440-bb93-0ce2dfdcde85";

function section(title) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(title);
  console.log("=".repeat(70));
}

async function main() {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const sb = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // -----------------------------------------------------------------
  // Q1 — auth.users state for the email
  // -----------------------------------------------------------------
  section("Q1 — auth.users state for " + TARGET_EMAIL);

  // listUsers paginates; we need to find ALL matching rows (in case of
  // multiple stale entries). filter via the API where possible.
  try {
    const { data, error } = await sb.auth.admin.listUsers({
      perPage: 200,
    });
    if (error) {
      console.error("✗ listUsers failed:", error.message);
    } else {
      const matches = (data.users ?? []).filter(
        (u) => (u.email ?? "").toLowerCase() === TARGET_EMAIL.toLowerCase()
      );
      console.log(`Found ${matches.length} auth.users row(s) for ${TARGET_EMAIL}:`);
      for (const u of matches) {
        console.log(`  id=${u.id}  created_at=${u.created_at}  last_sign_in=${u.last_sign_in_at ?? "(never)"}`);
      }
      if (matches.length === 0) {
        console.log("  (no rows — user is fully deleted, OAuth callback hasn't completed yet?)");
      }
    }
  } catch (e) {
    console.error("✗ listUsers threw:", e.message);
  }

  // -----------------------------------------------------------------
  // Q2 — workspaces.* state for NEW_UID + scan for orphans
  // -----------------------------------------------------------------
  section("Q2 — workspaces rows for NEW_UID " + NEW_UID_FROM_LOGS);
  try {
    const { data, error } = await sb
      .from("workspaces")
      .select("id, user_id, name, is_default, archived_at, created_at")
      .eq("user_id", NEW_UID_FROM_LOGS);
    if (error) {
      console.error("✗ Query failed:", error.message);
    } else {
      console.log(`Found ${data?.length ?? 0} workspaces row(s) for the NEW user_id:`);
      for (const w of data ?? []) {
        console.log(
          `  id=${w.id} name="${w.name}" is_default=${w.is_default} archived_at=${w.archived_at ?? "null"} created_at=${w.created_at}`
        );
      }
    }
  } catch (e) {
    console.error("✗ Query threw:", e.message);
  }

  section("Q2b — ALL workspaces rows (to find orphans + see global state)");
  try {
    const { data, error } = await sb
      .from("workspaces")
      .select("id, user_id, name, is_default, archived_at, created_at")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("✗ Query failed:", error.message);
    } else {
      console.log(`Total workspaces rows in DB: ${data?.length ?? 0}`);
      // Group by user_id to find orphans (user_id not in auth.users)
      const { data: allUsers } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const liveUids = new Set((allUsers?.users ?? []).map((u) => u.id));
      const byUid = new Map();
      for (const w of data ?? []) {
        const list = byUid.get(w.user_id) ?? [];
        list.push(w);
        byUid.set(w.user_id, list);
      }
      for (const [uid, rows] of byUid.entries()) {
        const orphan = !liveUids.has(uid);
        const defaults = rows.filter((r) => r.is_default).length;
        const activeDefaults = rows.filter(
          (r) => r.is_default && !r.archived_at
        ).length;
        console.log(
          `  user_id=${uid}  rows=${rows.length}  is_default=${defaults}  active_is_default=${activeDefaults}${orphan ? "  ← ORPHAN (no auth.users row)" : ""}`
        );
        for (const r of rows) {
          console.log(
            `    └─ id=${r.id} name="${r.name}" is_default=${r.is_default} archived_at=${r.archived_at ?? "null"}`
          );
        }
      }
    }
  } catch (e) {
    console.error("✗ Query threw:", e.message);
  }

  // -----------------------------------------------------------------
  // Q3 — orphan counts in dependent tables
  // -----------------------------------------------------------------
  section("Q3 — orphan counts in dependent tables");

  const dependentTables = [
    "connections",
    "platform_credentials",
    "creatives_cache",
    "insights_cache",
  ];

  // First get the live user-id set so we can identify orphans.
  const { data: allUsersAgain } = await sb.auth.admin.listUsers({
    perPage: 1000,
  });
  const liveUids = new Set((allUsersAgain?.users ?? []).map((u) => u.id));

  for (const table of dependentTables) {
    try {
      const { data, error } = await sb.from(table).select("user_id");
      if (error) {
        console.log(`  ${table}: ✗ ${error.message}`);
        continue;
      }
      const totalRows = data?.length ?? 0;
      const byUid = new Map();
      for (const row of data ?? []) {
        byUid.set(row.user_id, (byUid.get(row.user_id) ?? 0) + 1);
      }
      const orphanUids = [...byUid.entries()].filter(
        ([uid]) => !liveUids.has(uid)
      );
      const orphanTotalRows = orphanUids.reduce((acc, [, n]) => acc + n, 0);
      console.log(
        `  ${table}: total=${totalRows} orphan_user_ids=${orphanUids.length} orphan_rows=${orphanTotalRows}`
      );
      for (const [uid, n] of orphanUids) {
        console.log(`    ORPHAN user_id=${uid} → ${n} row(s)`);
      }
    } catch (e) {
      console.log(`  ${table}: ✗ ${e.message}`);
    }
  }

  // -----------------------------------------------------------------
  // Q4 — the unique constraint definition
  // -----------------------------------------------------------------
  section("Q4 — workspaces_one_default_per_user constraint definition");
  try {
    // pg_indexes view is in pg_catalog; supabase service_role can read it.
    const { data, error } = await sb.rpc("__noop__").select();
    // Fallback — direct PostgREST queries don't reach pg_catalog by default.
    // Use the simpler approach: just attempt the schema introspection via
    // information_schema (which IS exposed) or skip if not available.
    if (error) {
      // expected — __noop__ doesn't exist. Use information_schema instead.
    }
  } catch {
    /* noop */
  }

  try {
    const { data, error } = await sb
      .from("workspaces")
      .select("*", { count: "exact", head: true })
      .limit(0);
    if (error) {
      console.log(`✗ Can't introspect workspaces: ${error.message}`);
    } else {
      console.log(`workspaces table accessible. (Constraint definition lives in pg_catalog — not directly queryable via PostgREST without a custom RPC. See Supabase Studio → Database → Indexes for the partial-index condition.)`);
      console.log(
        `Constraint name from the prod error: workspaces_one_default_per_user`
      );
      console.log(
        `Hypothesis: the index is defined as either (a) UNIQUE(user_id) WHERE is_default — which should NOT conflict with a fresh user_id, OR (b) something different (UNIQUE(is_default) WHERE is_default, or includes a 3rd column) that the name doesn't capture cleanly.`
      );
      console.log(
        `Cross-check the Q2/Q2b output above — if rows already exist for ${NEW_UID_FROM_LOGS} with is_default=true (possibly archived_at set), that's the conflict source.`
      );
    }
  } catch (e) {
    console.log(`✗ Workspaces introspection threw: ${e.message}`);
  }

  section("DONE — diagnostic complete (no writes performed)");
}

main().catch((err) => {
  console.error("Unexpected fatal error:", err);
  process.exit(1);
});
