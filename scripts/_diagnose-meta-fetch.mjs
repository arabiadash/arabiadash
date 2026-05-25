/**
 * READ-ONLY Meta API diagnostic — proves the act_-prefix bug.
 *
 * Pulls the stored Meta connection + token, then hits Graph API:
 *   1. /me/permissions   — what scopes does the token actually have?
 *   2. /me/adaccounts    — does the token work for basic queries?
 *   3. /{bare_id}/insights — should fail with #100 (reproduces prod bug)
 *   4. /act_{bare_id}/insights — should succeed (confirms the fix)
 *
 * Token is read from platform_credentials.refresh_token but never printed.
 * Only granted permissions + response codes + first error message printed.
 *
 * Usage:
 *   node scripts/_diagnose-meta-fetch.mjs
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

const META_API_VERSION = "v21.0";
const TARGET_EMAIL = "alkhateib94@gmail.com";

function section(t) {
  console.log(`\n${"=".repeat(70)}\n${t}\n${"=".repeat(70)}`);
}

async function main() {
  const env = loadEnv();
  const sb = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // ─ Resolve user id from auth.users by email
  section(`Q1 — auth.users lookup for ${TARGET_EMAIL}`);
  const { data: lu } = await sb.auth.admin.listUsers({ perPage: 200 });
  const u = (lu?.users ?? []).find(
    (x) => (x.email ?? "").toLowerCase() === TARGET_EMAIL.toLowerCase()
  );
  if (!u) {
    console.error("✗ user not found");
    process.exit(1);
  }
  console.log(`✓ user_id=${u.id}  created=${u.created_at}`);

  // ─ Pull platform_credentials
  section("Q2 — platform_credentials (token + scopes + expiry)");
  const { data: cred } = await sb
    .from("platform_credentials")
    .select("refresh_token, scopes, expires_at, updated_at")
    .eq("user_id", u.id)
    .eq("platform", "meta")
    .maybeSingle();
  if (!cred?.refresh_token) {
    console.error("✗ no Meta credential row");
    process.exit(1);
  }
  const token = cred.refresh_token;
  console.log(
    `✓ found row  scopes_stored=${JSON.stringify(cred.scopes)}  expires_at=${cred.expires_at ?? "(none)"}  updated_at=${cred.updated_at}`
  );
  console.log(`  token length=${token.length}  (value redacted)`);

  // ─ Pull connections rows for Meta
  section("Q3 — connections rows for Meta");
  const { data: conns } = await sb
    .from("connections")
    .select("id, account_id, account_name, status, metadata, last_synced_at")
    .eq("user_id", u.id)
    .eq("platform", "meta");
  console.log(`Found ${conns?.length ?? 0} Meta connection row(s):`);
  for (const c of conns ?? []) {
    const hasActPrefix = c.account_id.startsWith("act_");
    console.log(
      `  id=${c.id}  account_id="${c.account_id}"  has_act_prefix=${hasActPrefix}  name="${c.account_name}"  status=${c.status}`
    );
  }
  const bareId = conns?.[0]?.account_id;
  if (!bareId) {
    console.error("✗ no Meta connection to probe with");
    process.exit(1);
  }

  // ─ Q4 — /me/permissions: what did the token actually get?
  section("Q4 — /me/permissions (granted scopes per Facebook)");
  {
    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/me/permissions?access_token=${encodeURIComponent(token)}`
    );
    const body = await r.json();
    console.log(`HTTP ${r.status}`);
    if (Array.isArray(body.data)) {
      for (const p of body.data) {
        console.log(`  ${p.permission.padEnd(28)} → ${p.status}`);
      }
    } else {
      console.log(JSON.stringify(body, null, 2));
    }
  }

  // ─ Q5 — /me/adaccounts: can the token list accounts at all?
  section("Q5 — /me/adaccounts (does basic token query work?)");
  {
    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts?fields=id,name,currency&access_token=${encodeURIComponent(token)}`
    );
    const body = await r.json();
    console.log(`HTTP ${r.status}`);
    if (Array.isArray(body.data)) {
      console.log(`✓ ${body.data.length} ad account(s) accessible:`);
      for (const a of body.data) {
        const matches = a.id === `act_${bareId}` || a.id === bareId;
        console.log(
          `  id="${a.id}"  name="${a.name}"  currency=${a.currency}${matches ? "  ← matches stored connection" : ""}`
        );
      }
    } else {
      console.log(JSON.stringify(body, null, 2));
    }
  }

  // ─ Q6 — Reproduce the prod bug: /{bare_id}/insights
  section(`Q6 — /${bareId}/insights (reproduces prod bug — bare id)`);
  {
    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${bareId}/insights?fields=spend,impressions&date_preset=last_7d&access_token=${encodeURIComponent(token)}`
    );
    const body = await r.json();
    console.log(`HTTP ${r.status}`);
    console.log(JSON.stringify(body, null, 2));
  }

  // ─ Q7 — Confirm the fix: /act_{bare_id}/insights
  section(`Q7 — /act_${bareId}/insights (confirms fix — prefixed id)`);
  {
    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/act_${bareId}/insights?fields=spend,impressions&date_preset=last_7d&access_token=${encodeURIComponent(token)}`
    );
    const body = await r.json();
    console.log(`HTTP ${r.status}`);
    console.log(JSON.stringify(body, null, 2));
  }

  section("DONE — diagnostic complete, no writes performed");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
