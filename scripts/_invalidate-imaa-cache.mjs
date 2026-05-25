/**
 * Targeted cache invalidation harness — scripts/_invalidate-imaa-cache.mjs
 * ========================================================================
 *
 * PURPOSE
 * -------
 * One-off deletion of `creatives_cache` rows for a specific
 * (provider, account_id) combo. Lets us invalidate a single customer's
 * cache without touching the global `CACHE_SCHEMA_VERSION` (which would
 * nuke every account's cache and trigger an upstream-API refetch
 * stampede). Sized for debugging-a-single-account scenarios — not for
 * routine ops.
 *
 * STATUS: BLOCKED AT RUNTIME (as of 2026-05-24)
 * ---------------------------------------------
 * The Supabase service-role key lacks explicit SELECT/DELETE GRANTs on
 * the `creatives_cache` table. Running this script today produces:
 *
 *     Inspect query failed: permission denied for table creatives_cache
 *
 * Same root cause as the M5 ~1hr GRANT-debugging session documented in
 * project memory (`creatives_cache` was created with overly tight
 * default privileges — service_role is missing from its grantees list).
 *
 * Tech-debt to unblock: GRANT SELECT, DELETE ON public.creatives_cache
 * TO service_role; (plus sequence USAGE if a serial PK exists). See the
 * existing schema GRANT review tech-debt #30 — bundle into the same
 * migration.
 *
 * WHY KEEP THE SCRIPT THEN
 * ------------------------
 * Re-runnable artifact for the day the GRANT lands. Saves re-authoring
 * the env-loading + CLI-arg-parsing scaffolding (mirrors
 * `_pmax-recon.mjs`). When debugging a single customer's stale cache,
 * the alternative (CACHE_SCHEMA_VERSION bump) is a heavy hammer that
 * forces every account to refetch — fine for shape-change fixes,
 * wasteful for one-customer debugging.
 *
 * USAGE (once the GRANT is fixed)
 * -------------------------------
 *     node scripts/_invalidate-imaa-cache.mjs --provider=google --account=5473228670
 *
 * Arguments:
 *   --provider   "meta" | "google" | "tiktok" | "snapchat" (required)
 *   --account    string — the account_id used in creatives_cache rows (required)
 *
 * Env vars (read from .env.local — same loader as _pmax-recon.mjs):
 *   NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     — service-role JWT
 *
 * Expected output:
 *   1. Lists every cache row matching (provider, account_id) — user_id,
 *      date_range (post-versionedKey suffix), fetched_at timestamp.
 *   2. DELETEs them in one transaction.
 *   3. Prints the exact rowcount deleted.
 *
 * On success the next request from that account misses cache and
 * refetches with the current adapter code. Other accounts' caches are
 * untouched.
 *
 * SAFETY
 * ------
 * Read-then-delete pattern: dumps what it's about to remove BEFORE the
 * DELETE so an operator can sanity-check. No --dry-run flag yet (one
 * was considered but the inspect-print serves the same purpose; the
 * GRANT block makes accidental destructive runs impossible anyway
 * until the GRANT lands).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// =================================================================
// env loader — copied from _pmax-recon.mjs
// =================================================================
function loadEnv() {
  const env = {};
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("="))
        continue;
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

// =================================================================
// CLI arg parser — minimal, no deps. Accepts --key=value form.
// =================================================================
function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) {
      out[arg.slice(2)] = true;
      continue;
    }
    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);
    out[key] = value;
  }
  return out;
}

const VALID_PROVIDERS = new Set(["meta", "google", "tiktok", "snapchat"]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = args.provider;
  const accountId = args.account;

  if (!provider || !accountId) {
    console.error(
      "Usage: node scripts/_invalidate-imaa-cache.mjs --provider=<meta|google|tiktok|snapchat> --account=<account_id>"
    );
    process.exit(1);
  }
  if (!VALID_PROVIDERS.has(provider)) {
    console.error(
      `Invalid --provider value "${provider}". Must be one of: ${[...VALID_PROVIDERS].join(", ")}`
    );
    process.exit(1);
  }

  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }

  const sb = createClient(supabaseUrl, serviceRole);

  console.log(
    `→ Invalidating creatives_cache for provider=${provider} account_id=${accountId}`
  );

  // Inspect first — show what we'd delete + the date_range values
  // (most useful diagnostic — confirms cache-key shape on the actual row).
  const { data: existing, error: selectErr } = await sb
    .from("creatives_cache")
    .select("user_id, account_id, date_range, fetched_at, stale_until")
    .eq("provider", provider)
    .eq("account_id", accountId);

  if (selectErr) {
    console.error("Inspect query failed:", selectErr.message);
    console.error(
      "If this is 'permission denied for table creatives_cache' — the service_role GRANT is still missing. See script header for context."
    );
    process.exit(1);
  }

  console.log(
    `Found ${existing?.length ?? 0} cache row(s) for provider=${provider} account_id=${accountId}:`
  );
  for (const row of existing ?? []) {
    console.log(
      `  user_id=${row.user_id} date_range=${row.date_range} fetched_at=${row.fetched_at}`
    );
  }

  if ((existing?.length ?? 0) === 0) {
    console.log("\nNothing to delete. Exiting.");
    return;
  }

  const { error: deleteErr, count } = await sb
    .from("creatives_cache")
    .delete({ count: "exact" })
    .eq("provider", provider)
    .eq("account_id", accountId);

  if (deleteErr) {
    console.error("Delete failed:", deleteErr.message);
    process.exit(1);
  }

  console.log(`\n✓ Deleted ${count} row(s).`);
  console.log(
    `Next request from provider=${provider} account_id=${accountId} will miss cache and refetch.`
  );
}

main().catch((err) => {
  console.error("Unexpected fatal error:", err);
  process.exit(1);
});
