import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Single chokepoint for reading a user's refresh token from
 * platform_credentials (the canonical store per ADR-010 + ADR-017).
 *
 * Callers MUST pass an admin (service-role) client. RLS on
 * platform_credentials blocks user-scoped reads of credential rows.
 *
 * Returns null when no credential row exists — caller decides whether
 * to throw or surface a typed "no_oauth_token" response.
 */
export async function getRefreshTokenForUser(
  adminClient: SupabaseClient<Database>,
  userId: string,
  platform: "google" | "meta" | "tiktok"
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("platform_credentials")
    .select("refresh_token")
    .eq("user_id", userId)
    .eq("platform", platform)
    .maybeSingle();

  if (error || !data?.refresh_token) return null;
  return data.refresh_token;
}
