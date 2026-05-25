/**
 * Confirmation probe — uses SDK v23 canonical field name `full_size.url`
 * (NOT the deprecated `full_size_image_url` that M5 inherited).
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
  ...(conn.metadata?.manager_customer_id ? { login_customer_id: conn.metadata.manager_customer_id } : {}),
});

const RN1 = "customers/5473228670/assets/323690114690";
const RN2 = "customers/5473228670/assets/323690136074";

async function probe(label, selectClause) {
  console.log(`\n─── ${label} ───`);
  const q = `SELECT asset.resource_name, ${selectClause} FROM asset WHERE asset.resource_name IN ('${RN1}', '${RN2}')`;
  try {
    const rows = await customer.query(q);
    console.log(`✓ ${rows.length} rows — SELECT ${selectClause}`);
    if (rows.length > 0) console.log(JSON.stringify(rows[0].asset, null, 2));
    return true;
  } catch (e) {
    const msg = e?.errors?.map((x) => `${x.message} [${JSON.stringify(x.error_code)}]`).join("; ") ?? e?.message;
    console.log(`✗ ${msg} — SELECT ${selectClause}`);
    return false;
  }
}

await probe("V23 canonical: full_size.url", "asset.image_asset.full_size.url");
await probe(
  "V23 + dimensions (the M8 target shape)",
  "asset.id, asset.image_asset.full_size.url, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels"
);
